#!/usr/bin/env node
/**
 * Syncs built plugin artifacts into the vault's .obsidian plugins folder.
 *
 * The dev checkout lives at <vault>/.dev/claudian-enhanced, so the default
 * target is <vault>/.obsidian/plugins/claudian-plus (two levels up). Outside
 * this layout (e.g. CI) the script exits 0 without touching anything, so it
 * is safe to chain after `npm run build`.
 *
 * Only build products are synced (main.js, styles.css, manifest.json).
 * data.json holds user settings and is never touched.
 */

const { copyFileSync, existsSync, mkdirSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');

const ROOT = resolve(__dirname, '..');
const ARTIFACTS = ['main.js', 'styles.css', 'manifest.json'];

function defaultTarget(root = ROOT) {
  return join(root, '..', '..', '.obsidian', 'plugins', 'claudian-plus');
}

/**
 * Copies build artifacts from `root` into `target`.
 * @param {{root?: string, target?: string, backup?: boolean}} [options]
 * @returns {{dest: string, synced: string[], skipped: boolean}}
 */
function syncVault({ root = ROOT, target, backup = false } = {}) {
  const dest = resolve(target ?? defaultTarget(root));
  if (!existsSync(dest)) {
    // No vault install at the default location: a CI checkout, not an error.
    if (target === undefined) return { dest, synced: [], skipped: true };
    mkdirSync(dest, { recursive: true });
  }

  const synced = [];
  for (const name of ARTIFACTS) {
    const source = join(root, name);
    const destination = join(dest, name);
    if (!existsSync(source)) continue;
    if (backup && existsSync(destination)) {
      copyFileSync(destination, `${destination}.bak`);
    }
    copyFileSync(source, destination);
    synced.push(name);
  }
  return { dest, synced, skipped: false };
}

function main() {
  const args = process.argv.slice(2);
  const explicitTarget = args.includes('--target')
    ? args[args.indexOf('--target') + 1]
    : process.env.CLAUDIAN_SYNC_TARGET;
  const { dest, synced, skipped } = syncVault({
    target: explicitTarget,
    backup: args.includes('--backup'),
  });
  if (skipped) {
    console.log(`sync-vault: no vault install at ${dest}; nothing to do`);
    return;
  }
  for (const name of synced) {
    const bytes = statSync(join(dest, name)).size;
    console.log(`sync-vault: ${name} -> ${dest} (${bytes} bytes)`);
  }
  if (synced.length === 0) console.log('sync-vault: no build artifacts found; run npm run build first');
}

module.exports = { ARTIFACTS, defaultTarget, syncVault };

if (require.main === module) {
  main();
}
