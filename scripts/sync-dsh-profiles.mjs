#!/usr/bin/env node
/**
 * Synchronize model-provider configuration between two DeepSeek Harness profiles.
 *
 * The Obsidian Claudian Plus provider boots the npm CLI with `--profile web`, while
 * the Desktop app boots its own `desktop` profile. Each profile owns its provider
 * declarations, so a route configured in one is invisible to the other until the
 * other profile declares it too. This script copies the `llm-pi-ai` providers and
 * the `agent-default-model` selection from one profile patch into another.
 *
 * Scope: `llm-pi-ai.config.providers` and `agent-default-model.config` only.
 * Credentials are shared through $DSH_HOME/.credentials.yaml and are never touched.
 *
 * Usage:
 *   node scripts/sync-dsh-profiles.mjs [options]
 *
 * Options:
 *   --dsh-home <path>       DSH home (default: $DSH_HOME or ~/.dsh)
 *   --from <profile>        source profile (default: desktop)
 *   --to <profile>          target profile (default: web)
 *   --dsh-cli <path>        npm dsh CLI path or its lib/bin.js entry
 *   --replace-providers     drop target-only providers instead of merging
 *   --keep-default          leave the target's agent-default-model unchanged
 *   --dry-run               print the plan without writing
 *   --no-verify             skip dsh --dump-config validation
 *   --self-test             run built-in merge assertions and exit
 *   --help                  show this help
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROVIDER_PLUGIN_ID = 'llm-pi-ai';
const DEFAULT_MODEL_ID = 'agent-default-model';
const SCRIPT_NAME = 'scripts/sync-dsh-profiles.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    dshHome: process.env.DSH_HOME?.trim() || path.join(process.env.USERPROFILE || os.homedir(), '.dsh'),
    from: 'desktop',
    to: 'web',
    dshCli: process.env.DSH_CLI?.trim() || '',
    replaceProviders: false,
    keepDefault: false,
    dryRun: false,
    verify: true,
    selfTest: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) fail(`Missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case '--dsh-home': options.dshHome = next(); break;
      case '--from': options.from = next(); break;
      case '--to': options.to = next(); break;
      case '--dsh-cli': options.dshCli = next(); break;
      case '--replace-providers': options.replaceProviders = true; break;
      case '--keep-default': options.keepDefault = true; break;
      case '--dry-run': options.dryRun = true; break;
      case '--no-verify': options.verify = false; break;
      case '--self-test': options.selfTest = true; break;
      case '--help': case '-h': options.help = true; break;
      default: fail(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  const text = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const body = text.slice(text.indexOf('/**') + 3, text.indexOf('*/'));
  console.log(body.split('\n').map(line => line.replace(/^\s*\* ?/, '')).join('\n').trim());
}

function resolveDshEntry(cliPath) {
  const trimmed = cliPath.trim();
  if (!trimmed) return '';
  const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
  const resolved = path.resolve(expanded);
  if (/\.(cmd|ps1)$/i.test(resolved)) {
    return path.join(path.dirname(resolved), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  }
  if (/\.[cm]?js$/i.test(resolved)) return resolved;
  if (/\.exe$/i.test(resolved)) {
    fail('The Desktop executable is not a supported CLI entry. Point --dsh-cli at the npm dsh.cmd or lib/bin.js.');
  }
  // Extensionless npm shims: resolve the sibling package entry.
  const sibling = path.join(path.dirname(resolved), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  return fs.existsSync(sibling) ? sibling : resolved;
}

function findDshCli(dshHome, explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'dsh.cmd'));
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const base = dir.replace(/^"|"$/g, '');
    if (process.platform === 'win32') {
      candidates.push(path.join(base, 'dsh.cmd'));
      candidates.push(path.join(base, 'dsh.exe'));
    } else {
      candidates.push(path.join(base, 'dsh'));
    }
  }
  for (const candidate of candidates) {
    const entry = resolveDshEntry(candidate);
    if (entry && fs.existsSync(entry)) return entry;
  }
  fail('Could not find the npm DeepSeek Harness CLI. Pass --dsh-cli <dsh.cmd | lib/bin.js>.');
}

function loadYaml(entry) {
  const require = createRequire(entry);
  try {
    return require('yaml');
  } catch {
    return fail('Could not load the `yaml` package from the DeepSeek Harness installation.');
  }
}

function readPatch(file) {
  if (!fs.existsSync(file)) fail(`Patch file not found: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  let doc;
  try {
    doc = YAML.parse(text);
  } catch (error) {
    fail(`Invalid YAML in ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(doc)) fail(`Expected a top-level YAML array in ${file}`);
  return { text, doc, newline: text.includes('\r\n') ? '\r\n' : '\n' };
}

function findEntry(doc, id) {
  return doc.find(entry => isRecord(entry) && entry.id === id);
}

function providersOf(doc, label) {
  const entry = findEntry(doc, PROVIDER_PLUGIN_ID);
  if (!entry) fail(`The ${label} patch has no "${PROVIDER_PLUGIN_ID}" entry.`);
  if (!isRecord(entry.config) || !isRecord(entry.config.providers)) {
    fail(`The ${label} patch has no "${PROVIDER_PLUGIN_ID}.config.providers" map.`);
  }
  return entry.config.providers;
}

function mergeProviders(sourceProviders, targetProviders, replaceProviders) {
  if (replaceProviders) {
    return {
      merged: clone(sourceProviders),
      added: Object.keys(sourceProviders),
      updated: [],
      unchanged: [],
      keptOnly: [],
      removed: Object.keys(targetProviders).filter(id => !(id in sourceProviders)),
    };
  }
  const merged = clone(targetProviders);
  const added = [];
  const updated = [];
  const unchanged = [];
  for (const [id, config] of Object.entries(sourceProviders)) {
    if (!(id in merged)) {
      merged[id] = clone(config);
      added.push(id);
    } else if (stable(merged[id]) !== stable(config)) {
      merged[id] = clone(config);
      updated.push(id);
    } else {
      unchanged.push(id);
    }
  }
  return {
    merged,
    added,
    updated,
    unchanged,
    keptOnly: Object.keys(targetProviders).filter(id => !(id in sourceProviders)),
    removed: [],
  };
}

function planSync({ sourceDoc, targetDoc, replaceProviders, syncDefault }) {
  const sourceProviders = providersOf(sourceDoc, 'source');
  const targetProviders = providersOf(targetDoc, 'target');
  const providerPlan = mergeProviders(sourceProviders, targetProviders, replaceProviders);

  const sourceDefault = findEntry(sourceDoc, DEFAULT_MODEL_ID)?.config;
  const targetDefault = findEntry(targetDoc, DEFAULT_MODEL_ID)?.config;
  let defaultPlan;
  if (!syncDefault) {
    defaultPlan = { sync: false, source: sourceDefault, target: targetDefault, warning: undefined };
  } else if (!isRecord(sourceDefault)) {
    defaultPlan = { sync: false, source: undefined, target: targetDefault, warning: 'Source profile has no agent-default-model entry; left the target unchanged.' };
  } else {
    const provider = sourceDefault.provider;
    const warning = typeof provider === 'string' && provider in providerPlan.merged
      ? undefined
      : `Default provider "${String(provider)}" is not declared under llm-pi-ai in the merged target; it must come from a bundled plugin.`;
    defaultPlan = { sync: true, source: sourceDefault, target: targetDefault, warning };
  }

  return { providerPlan, defaultPlan };
}

function applyPlan({ sourceDoc, targetDoc, providerPlan, defaultPlan }) {
  const next = clone(targetDoc);
  const providerEntry = findEntry(next, PROVIDER_PLUGIN_ID);
  providerEntry.config.providers = clone(providerPlan.merged);
  if (defaultPlan.sync) {
    const defaultEntry = findEntry(next, DEFAULT_MODEL_ID);
    if (defaultEntry) {
      defaultEntry.config = clone(defaultPlan.source);
    } else {
      next.push({ id: DEFAULT_MODEL_ID, config: clone(defaultPlan.source) });
    }
  }
  return next;
}

function leadingComments(text) {
  const lines = text.split(/\r?\n/);
  const comments = [];
  for (const line of lines) {
    if (/^\s*#/.test(line)) {
      comments.push(line);
      continue;
    }
    break;
  }
  return comments;
}

function renderPatch({ originalText, nextDoc, from, to, newline }) {
  const comments = leadingComments(originalText);
  const stamp = new Date().toISOString();
  const header = [
    ...comments,
    '',
    `# Model-provider configuration synced from the "${from}" profile by ${SCRIPT_NAME}.`,
    `# Last sync: ${stamp}. Providers are copied from llm-pi-ai.config.providers;`,
    `# credentials stay in $DSH_HOME/.credentials.yaml and are not duplicated here.`,
  ];
  const body = YAML.stringify(nextDoc, { lineWidth: 0 }).replace(/\n/g, newline);
  return `${header.join(newline)}${newline}${body}`;
}

function backupFile(file) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  const backup = `${file}.bak-${stamp}`;
  fs.copyFileSync(file, backup);
  return backup;
}

function writePatch(file, content, newline) {
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, content.replace(/\r?\n/g, newline), 'utf8');
  fs.renameSync(temporary, file);
}

function summarize({ options, providerPlan, defaultPlan, sourceFile, targetFile }) {
  const lines = [];
  lines.push(`Source: ${sourceFile}`);
  lines.push(`Target: ${targetFile}`);
  lines.push(`Mode:   ${options.replaceProviders ? 'replace providers' : 'merge providers'}${defaultPlan.sync ? ', sync default model' : ', keep default model'}`);
  lines.push('');
  lines.push(`Providers added:   ${providerPlan.added.length ? providerPlan.added.join(', ') : '(none)'}`);
  lines.push(`Providers updated: ${providerPlan.updated.length ? providerPlan.updated.join(', ') : '(none)'}`);
  if (!options.replaceProviders) {
    lines.push(`Target-only kept:  ${providerPlan.keptOnly.length ? providerPlan.keptOnly.join(', ') : '(none)'}`);
  } else {
    lines.push(`Target-only dropped: ${providerPlan.removed.length ? providerPlan.removed.join(', ') : '(none)'}`);
  }
  lines.push(`Providers unchanged: ${providerPlan.unchanged.length ? providerPlan.unchanged.join(', ') : '(none)'}`);
  if (defaultPlan.sync) {
    const before = defaultPlan.target;
    const after = defaultPlan.source;
    lines.push(`Default model: ${isRecord(before) ? `${before.provider}/${before.model}` : '(none)'} -> ${after.provider}/${after.model}${after.reasoningEffort ? ` (${after.reasoningEffort})` : ''}`);
  } else {
    lines.push('Default model: unchanged');
  }
  if (defaultPlan.warning) lines.push(`Warning: ${defaultPlan.warning}`);
  return lines.join('\n');
}

function verifyProfile({ entry, dshHome, to }) {
  const result = spawnSync(process.execPath, [entry, '--profile', to, '--dump-config'], {
    cwd: dshHome,
    encoding: 'utf8',
    timeout: 180_000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) return `verify skipped: ${result.error.message}`;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().slice(-2000);
    return `verify FAILED (exit ${result.status}): ${detail}`;
  }
  return 'verify OK: dsh --dump-config composed the target profile';
}

function selfTest() {
  const source = [
    { id: PROVIDER_PLUGIN_ID, config: { providers: { alpha: { apiKeyEnv: 'A' }, shared: { apiKeyEnv: 'S2' } } } },
    { id: DEFAULT_MODEL_ID, config: { provider: 'shared', model: 'new' } },
  ];
  const target = [{ id: PROVIDER_PLUGIN_ID, config: { providers: { shared: { apiKeyEnv: 'S1' }, local: { apiKeyEnv: 'L' } } } }, { id: DEFAULT_MODEL_ID, config: { provider: 'shared', model: 'old' } }];

  const merge = planSync({ sourceDoc: source, targetDoc: target, replaceProviders: false, syncDefault: true });
  assert.deepEqual(merge.providerPlan.added, ['alpha']);
  assert.deepEqual(merge.providerPlan.updated, ['shared']);
  assert.deepEqual(merge.providerPlan.keptOnly, ['local']);
  assert.equal(merge.providerPlan.merged.shared.apiKeyEnv, 'S2');
  assert.equal(merge.providerPlan.merged.local.apiKeyEnv, 'L');
  const mergeNext = applyPlan({ sourceDoc: source, targetDoc: target, providerPlan: merge.providerPlan, defaultPlan: merge.defaultPlan });
  assert.equal(findEntry(mergeNext, DEFAULT_MODEL_ID).config.provider, 'shared');

  const replace = planSync({ sourceDoc: source, targetDoc: target, replaceProviders: true, syncDefault: false });
  assert.deepEqual(Object.keys(replace.providerPlan.merged), ['alpha', 'shared']);
  assert.deepEqual(replace.providerPlan.removed, ['local']);
  assert.equal(replace.defaultPlan.sync, false);

  const missingDefault = planSync({ sourceDoc: [{ id: PROVIDER_PLUGIN_ID, config: { providers: {} } }], targetDoc: target, replaceProviders: false, syncDefault: true });
  assert.equal(missingDefault.defaultPlan.sync, false);
  assert.match(missingDefault.defaultPlan.warning, /no agent-default-model/);

  const text = leadingComments('# one\r\n# two\r\n\r\n- id: x\r\n');
  assert.deepEqual(text, ['# one', '# two']);
  console.log('self-test passed');
}

let YAML;

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  if (options.selfTest) return selfTest();

  options.dshHome = path.resolve(options.dshHome);
  if (!fs.existsSync(options.dshHome)) fail(`DSH home not found: ${options.dshHome}`);
  const sourceFile = path.join(options.dshHome, 'profiles', options.from, 'cordis.patch.yml');
  const targetFile = path.join(options.dshHome, 'profiles', options.to, 'cordis.patch.yml');
  if (!fs.existsSync(sourceFile)) fail(`Source profile patch not found: ${sourceFile}`);
  if (!fs.existsSync(targetFile)) fail(`Target profile patch not found: ${targetFile}`);

  const entry = findDshCli(options.dshHome, options.dshCli);
  YAML = loadYaml(entry);

  const source = readPatch(sourceFile);
  const target = readPatch(targetFile);
  const plan = planSync({
    sourceDoc: source.doc,
    targetDoc: target.doc,
    replaceProviders: options.replaceProviders,
    syncDefault: !options.keepDefault,
  });

  console.log(summarize({
    options,
    providerPlan: plan.providerPlan,
    defaultPlan: plan.defaultPlan,
    sourceFile,
    targetFile,
  }));

  if (options.dryRun) {
    console.log('\nDry run: no files written. Re-run without --dry-run to apply.');
    return;
  }

  const nextDoc = applyPlan({ sourceDoc: source.doc, targetDoc: target.doc, providerPlan: plan.providerPlan, defaultPlan: plan.defaultPlan });
  const content = renderPatch({ originalText: target.text, nextDoc, from: options.from, to: options.to, newline: target.newline });
  const backup = backupFile(targetFile, target.newline);
  writePatch(targetFile, content, target.newline);
  console.log(`\nWrote ${targetFile}`);
  console.log(`Backup: ${backup}`);

  if (options.verify) {
    console.log(verifyProfile({ entry, dshHome: options.dshHome, to: options.to }));
  }
  console.log('\nNext step: Claudian Plus settings -> DeepSeek Harness -> Refresh models, then reopen the model menu.');
}

try {
  main();
} catch (error) {
  console.error(`sync-dsh-profiles: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
