/**
 * Portable Obsidian tool runtime used by providers that cannot host an
 * in-process Obsidian API (OpenCode ACP and Pi RPC). The OpenCode sidecar is
 * dependency-free; the Pi extension reuses the TypeBox package shipped by Pi
 * so its tool schemas are validated by the host runtime.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const PORTABLE_OPERATIONS_SOURCE = String.raw`
const MAX_RESULT_CHARS = 60000;
const MAX_WRITE_OPERATIONS = 100;
const IGNORED_DIRS = new Set(['.obsidian', '.claudian-plus', '.claudian', '.git', 'node_modules']);
const nativeBridgeUrl = typeof process !== 'undefined'
  ? (process.env.CLAUDIAN_PLUS_OBSIDIAN_BRIDGE_URL || process.env.CLAUDIAN_OBSIDIAN_BRIDGE_URL)
  : '';
const nativeBridgeToken = typeof process !== 'undefined'
  ? (process.env.CLAUDIAN_PLUS_OBSIDIAN_BRIDGE_TOKEN || process.env.CLAUDIAN_OBSIDIAN_BRIDGE_TOKEN)
  : '';

async function tryNativeBridge(name, input, approved) {
  if (!nativeBridgeUrl || !nativeBridgeToken || typeof fetch !== 'function') return { handled: false };
  try {
    const response = await fetch(nativeBridgeUrl.replace(/\/$/, '') + '/tools/call', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + nativeBridgeToken, 'content-type': 'application/json' },
      body: JSON.stringify({ name, arguments: input, approved: approved === true }),
    });
    const payload = await response.json();
    if (payload && payload.ok === true) return { handled: true, value: payload.result };
    if (payload && payload.error && payload.error.code === 'NATIVE_UNAVAILABLE') return { handled: false };
    const bridgeError = new Error(payload && payload.error && payload.error.message || 'Native Obsidian bridge request failed.');
    bridgeError.nativeBridge = true;
    throw bridgeError;
  } catch (error) {
    if (error && error.nativeBridge === true) throw error;
    return { handled: false };
  }
}

function jsonText(value) {
  let serialized;
  try { serialized = JSON.stringify(value, null, 2); } catch { serialized = String(value); }
  return serialized.length <= MAX_RESULT_CHARS
    ? serialized
    : serialized.slice(0, MAX_RESULT_CHARS) + '\\n... [result truncated]';
}

function safeRelative(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('path must be a non-empty string.');
  const value = raw.trim().replace(/\\/g, '/');
  if (value.startsWith('/') || /^[A-Za-z]:\//.test(value) || value.startsWith('\\')
    || value.split('/').some((part) => part === '..') || value.includes('\0')) {
    throw new Error('path must be relative to the current vault.');
  }
  const normalized = value.replace(/^\.\//, '').replace(/\/{2,}/g, '/');
  if (!normalized) throw new Error('path must not be empty.');
  return normalized;
}

function absolute(root, raw) {
  const relative = safeRelative(raw);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) throw new Error('path escapes the vault.');
  return { relative, absolute: resolved };
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function readText(root, rawPath) {
  const target = absolute(root, rawPath);
  return { ...target, text: await fs.readFile(target.absolute, 'utf8') };
}

async function walk(root, current = '') {
  const directory = path.join(root, current);
  let entries = [];
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return []; }
  const result = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue;
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const relative = current ? path.posix.join(current.replace(/\\/g, '/'), entry.name) : entry.name;
    if (entry.isDirectory()) result.push(...await walk(root, relative));
    else result.push(relative.replace(/\\/g, '/'));
  }
  return result;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(',').map((item) => parseScalar(item)).filter((item) => item !== '');
  }
  return trimmed;
}

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { values: {}, start: -1, end: -1 };
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return { values: {}, start: -1, end: -1 };
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---' || lines[index].trim() === '...') { end = index; break; }
  }
  if (end < 0) return { values: {}, start: -1, end: -1 };
  const values = {};
  let currentListKey = null;
  for (const line of lines.slice(1, end)) {
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && currentListKey) {
      const existing = Array.isArray(values[currentListKey]) ? values[currentListKey] : [];
      existing.push(parseScalar(listItem[1]));
      values[currentListKey] = existing;
      continue;
    }
    const match = line.match(/^([^:#][^:]*):\s*(.*)$/);
    if (!match) { currentListKey = null; continue; }
    const key = match[1].trim();
    const rawValue = match[2];
    values[key] = rawValue ? parseScalar(rawValue) : [];
    currentListKey = rawValue ? null : key;
  }
  return { values, start: 0, end, lines };
}

function yamlValue(value) {
  if (Array.isArray(value)) return value.length === 0 ? '[]' : JSON.stringify(value);
  if (value === null) return 'null';
  if (typeof value === 'string' && /^[A-Za-z0-9_./-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function rewriteFrontmatter(text, operation) {
  const parsed = parseFrontmatter(text);
  const values = { ...parsed.values };
  for (const [key, value] of Object.entries(operation.set || {})) values[key] = value;
  for (const key of operation.delete || []) delete values[key];
  const lines = ['---'];
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')) {
      lines.push(key + ':');
      for (const item of value) lines.push('  - ' + yamlValue(item));
    } else {
      lines.push(key + ': ' + yamlValue(value));
    }
  }
  lines.push('---');
  if (parsed.start < 0) return lines.join('\\n') + '\\n' + text;
  const body = parsed.lines.slice(parsed.end + 1).join('\\n').replace(/^\\n+/, '');
  return lines.join('\\n') + '\\n' + (body ? '\\n' + body : '');
}

function extractWikiLinks(text) {
  const links = [];
  const pattern = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    let target = match[1].trim().replace(/\\/g, '/');
    if (!target) continue;
    if (!target.toLowerCase().endsWith('.md')) target += '.md';
    links.push(target);
  }
  return [...new Set(links)];
}

async function markdownFiles(root) {
  return (await walk(root)).filter((file) => file.toLowerCase().endsWith('.md'));
}

async function buildLinkIndex(root) {
  const files = await markdownFiles(root);
  const outgoing = {};
  for (const file of files) {
    const { text } = await readText(root, file);
    outgoing[file] = extractWikiLinks(text);
  }
  const incoming = {};
  for (const [source, targets] of Object.entries(outgoing)) {
    for (const target of targets) {
      if (!incoming[target]) incoming[target] = [];
      incoming[target].push(source);
    }
  }
  return { outgoing, incoming };
}

function graphNeighbors(index, startPath, depth) {
  const maxDepth = Math.max(1, Math.min(3, Number.isFinite(depth) ? Math.floor(depth) : 1));
  const adjacency = new Map();
  const add = (from, to) => {
    const values = adjacency.get(from) || new Set();
    values.add(to); adjacency.set(from, values);
  };
  for (const [source, targets] of Object.entries(index.outgoing)) {
    for (const target of targets) { add(source, target); add(target, source); }
  }
  const visited = new Map([[startPath, 0]]);
  const queue = [startPath];
  while (queue.length > 0) {
    const current = queue.shift();
    const distance = visited.get(current);
    if (distance >= maxDepth) continue;
    for (const neighbor of adjacency.get(current) || []) {
      if (!visited.has(neighbor)) { visited.set(neighbor, distance + 1); queue.push(neighbor); }
    }
  }
  return [...visited.entries()]
    .filter(([file]) => file !== startPath)
    .map(([file, distance]) => ({ path: file, distance }));
}

function validateCanvas(data, canvasPath) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error('Invalid Canvas file: ' + canvasPath);
  }
  return data;
}

async function canvasRead(root, input) {
  const target = absolute(root, input.path);
  if (!target.relative.toLowerCase().endsWith('.canvas')) throw new Error('Canvas path must end with .canvas.');
  const data = validateCanvas(JSON.parse(await fs.readFile(target.absolute, 'utf8')), target.relative);
  return { path: target.relative, data };
}

function applyCanvasPlan(current, plan) {
  const nodeOps = Array.isArray(plan.nodeOps) ? plan.nodeOps : [];
  const edgeOps = Array.isArray(plan.edgeOps) ? plan.edgeOps : [];
  if (nodeOps.length + edgeOps.length > MAX_WRITE_OPERATIONS) throw new Error('Canvas write operation limit exceeded.');
  const next = { nodes: [...current.nodes], edges: [...current.edges] };
  for (const op of nodeOps) {
    if (!op || !op.node || typeof op.node.id !== 'string') throw new Error('Invalid Canvas node operation.');
    const index = next.nodes.findIndex((node) => node.id === op.node.id);
    if (op.action === 'add') {
      if (index >= 0) throw new Error('Canvas node already exists: ' + op.node.id);
      next.nodes.push({ type: 'text', x: 0, y: 0, width: 300, height: 100, ...op.node });
    } else if (op.action === 'update') {
      if (index < 0) throw new Error('Canvas node not found: ' + op.node.id);
      next.nodes[index] = { ...next.nodes[index], ...op.node };
    } else if (op.action === 'delete') {
      if (index < 0) throw new Error('Canvas node not found: ' + op.node.id);
      next.nodes.splice(index, 1);
      next.edges = next.edges.filter((edge) => edge.fromNode !== op.node.id && edge.toNode !== op.node.id);
    } else throw new Error('Unsupported Canvas node action.');
  }
  for (const op of edgeOps) {
    if (!op || !op.edge || typeof op.edge.id !== 'string') throw new Error('Invalid Canvas edge operation.');
    const index = next.edges.findIndex((edge) => edge.id === op.edge.id);
    if (op.action === 'add') {
      if (index >= 0) throw new Error('Canvas edge already exists: ' + op.edge.id);
      if (!next.nodes.some((node) => node.id === op.edge.fromNode) || !next.nodes.some((node) => node.id === op.edge.toNode)) {
        throw new Error('Canvas edge endpoints must exist.');
      }
      next.edges.push(op.edge);
    } else if (op.action === 'delete') {
      if (index < 0) throw new Error('Canvas edge not found: ' + op.edge.id);
      next.edges.splice(index, 1);
    } else throw new Error('Unsupported Canvas edge action.');
  }
  return next;
}

async function canvasWritePreview(root, input) {
  const target = absolute(root, input.path);
  if (!target.relative.toLowerCase().endsWith('.canvas')) throw new Error('Canvas path must end with .canvas.');
  const current = validateCanvas(JSON.parse(await fs.readFile(target.absolute, 'utf8')), target.relative);
  const plan = input.plan || {};
  const next = applyCanvasPlan(current, plan);
  return {
    path: target.relative,
    preview: true,
    nodeCountBefore: current.nodes.length,
    nodeCountAfter: next.nodes.length,
    edgeCountBefore: current.edges.length,
    edgeCountAfter: next.edges.length,
    operations: {
      nodeOps: Array.isArray(plan.nodeOps) ? plan.nodeOps.length : 0,
      edgeOps: Array.isArray(plan.edgeOps) ? plan.edgeOps.length : 0,
    },
  };
}

async function canvasWrite(root, input) {
  const target = absolute(root, input.path);
  if (!target.relative.toLowerCase().endsWith('.canvas')) throw new Error('Canvas path must end with .canvas.');
  const current = validateCanvas(JSON.parse(await fs.readFile(target.absolute, 'utf8')), target.relative);
  const next = applyCanvasPlan(current, input.plan || {});
  await fs.writeFile(target.absolute, JSON.stringify(next, null, '\\t') + '\\n', 'utf8');
  return { path: target.relative, applied: true, nodeCount: next.nodes.length, edgeCount: next.edges.length };
}

async function propertiesGet(root, input) {
  const target = await readText(root, input.path);
  if (!target.relative.toLowerCase().endsWith('.md')) throw new Error('Properties require a Markdown file.');
  const parsed = parseFrontmatter(target.text);
  return { path: target.relative, frontmatter: parsed.values };
}

async function propertiesSet(root, input) {
  const target = await readText(root, input.path);
  if (!target.relative.toLowerCase().endsWith('.md')) throw new Error('Properties require a Markdown file.');
  if (target.relative.split('/').some((part) => part.toLowerCase() === 'templates')) throw new Error('Properties writes are disabled inside templates/.');
  const next = rewriteFrontmatter(target.text, { set: input.set || {}, delete: input.delete || [] });
  await fs.writeFile(target.absolute, next, 'utf8');
  return { path: target.relative, applied: true };
}

async function linksGet(root, input) {
  const target = absolute(root, input.path);
  if (!(await exists(target.absolute))) throw new Error('File not found: ' + target.relative);
  const index = await buildLinkIndex(root);
  return {
    path: target.relative,
    outgoing: (index.outgoing[target.relative] || []).map((path) => ({ target: path, linkCount: 1 })),
    incoming: (index.incoming[target.relative] || []).map((path) => ({ source: path, linkCount: 1 })),
    unresolved: (index.outgoing[target.relative] || []).filter((path) => !index.outgoing[path]),
  };
}

async function dataviewQuery(root, input) {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) throw new Error('query must be a non-empty string.');
  const fromMatch = query.match(/\bFROM\s+["']([^"']+)["']/i);
  const folder = fromMatch ? fromMatch[1].replace(/\\/g, '/').replace(/^\//, '') : '';
  const files = (await markdownFiles(root)).filter((file) => !folder || file.startsWith(folder + '/') || file === folder);
  const rows = [];
  for (const file of files.slice(0, 500)) {
    const { text } = await readText(root, file);
    const parsed = parseFrontmatter(text);
    rows.push({ path: file, name: path.basename(file, path.extname(file)), ...parsed.values });
  }
  return { query, rows };
}

async function dispatchTool(root, name, input, approved = false) {
  const native = await tryNativeBridge(name, input, approved);
  if (native.handled) return native.value;
  switch (name) {
    case 'canvas_read': return canvasRead(root, input);
    case 'canvas_write_preview': return canvasWritePreview(root, input);
    case 'canvas_write': return canvasWrite(root, input);
    case 'properties_get': return propertiesGet(root, input);
    case 'properties_set': return propertiesSet(root, input);
    case 'links_get': return linksGet(root, input);
    case 'graph_neighbors': {
      const target = absolute(root, input.path);
      const index = await buildLinkIndex(root);
      return { path: target.relative, neighbors: graphNeighbors(index, target.relative, input.depth) };
    }
    case 'dataview_query': return dataviewQuery(root, input);
    default: throw new Error('Unknown Obsidian tool: ' + name);
  }
}
`;

const TOOL_DEFINITIONS = [
  {
    name: 'canvas_read',
    description: 'Read a vault-relative .canvas file as structured nodes and edges.',
    schema: { type: 'object', properties: { path: { type: 'string', minLength: 1 } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'canvas_write_preview',
    description: 'Preview and validate a Canvas node/edge plan without writing it.',
    schema: { type: 'object', properties: { path: { type: 'string', minLength: 1 }, plan: { type: 'object' } }, required: ['path', 'plan'], additionalProperties: false },
  },
  {
    name: 'canvas_write',
    description: 'Apply a Canvas node/edge plan. The host must approve this write before execution.',
    schema: { type: 'object', properties: { path: { type: 'string', minLength: 1 }, plan: { type: 'object' } }, required: ['path', 'plan'], additionalProperties: false },
  },
  {
    name: 'properties_get',
    description: 'Read frontmatter properties from a vault-relative Markdown file.',
    schema: { type: 'object', properties: { path: { type: 'string', minLength: 1 } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'properties_set',
    description: 'Set or delete Markdown frontmatter properties. The host must approve this write before execution.',
    schema: { type: 'object', properties: { path: { type: 'string', minLength: 1 }, set: { type: 'object' }, delete: { type: 'array', items: { type: 'string' } } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'links_get',
    description: 'Return outgoing, incoming, and unresolved wiki-link relationships for a file.',
    schema: { type: 'object', properties: { path: { type: 'string', minLength: 1 } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'graph_neighbors',
    description: 'Find linked vault neighbors with a depth cap of three.',
    schema: { type: 'object', properties: { path: { type: 'string', minLength: 1 }, depth: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'dataview_query',
    description: 'Run a read-only, frontmatter-backed Dataview-compatible query over Markdown files.',
    schema: { type: 'object', properties: { query: { type: 'string', minLength: 1 } }, required: ['query'], additionalProperties: false },
  },
];

export function buildPortableObsidianMcpScript(): string {
  const definitions = JSON.stringify(TOOL_DEFINITIONS.map(({ name, description, schema }) => ({
    name,
    description,
    inputSchema: schema,
  })));
  return `#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const root = path.resolve(
  process.env.CLAUDIAN_PLUS_VAULT_ROOT
    || process.env.CLAUDIAN_VAULT_ROOT
    || process.argv[2]
    || process.cwd(),
);
const tools = ${definitions};
${PORTABLE_OPERATIONS_SOURCE}
function write(message) { process.stdout.write(JSON.stringify(message) + '\\n'); }
function textResult(value, isError) { return { content: [{ type: 'text', text: jsonText(value) }], ...(isError ? { isError: true } : {}) }; }
async function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || message.id === undefined) return;
  try {
    if (message.method === 'initialize') {
      const requestedVersion = message.params && message.params.protocolVersion;
      const supportedVersions = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);
      const protocolVersion = supportedVersions.has(requestedVersion) ? requestedVersion : '2024-11-05';
      write({ jsonrpc: '2.0', id: message.id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'claudian-plus-obsidian', version: '1.0.0' } } });
      return;
    }
    if (message.method === 'tools/list') { write({ jsonrpc: '2.0', id: message.id, result: { tools } }); return; }
    if (message.method === 'tools/call') {
      const name = message.params && message.params.name;
      const input = message.params && message.params.arguments || {};
      const value = await dispatchTool(root, name, input, true);
      write({ jsonrpc: '2.0', id: message.id, result: textResult(value, false) });
      return;
    }
    write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found: ' + message.method } });
  } catch (error) {
    write({ jsonrpc: '2.0', id: message.id, result: textResult(error instanceof Error ? error.message : String(error), true) });
  }
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => { try { void handle(JSON.parse(line)); } catch (error) { process.stderr.write(String(error) + '\\n'); } });
`;
}

export function buildPortablePiExtensionScript(): string {
  const definitions = JSON.stringify(TOOL_DEFINITIONS);
  return `import { promises as fs } from 'node:fs';
import path from 'node:path';
const { Type } = await import('typebox').catch(async () => import('@sinclair/typebox'));

const tools = ${definitions};
${PORTABLE_OPERATIONS_SOURCE}
const schemas = {
  canvas_read: Type.Object({ path: Type.String({ minLength: 1 }) }),
  canvas_write_preview: Type.Object({ path: Type.String({ minLength: 1 }), plan: Type.Record(Type.String(), Type.Unknown()) }),
  canvas_write: Type.Object({ path: Type.String({ minLength: 1 }), plan: Type.Record(Type.String(), Type.Unknown()) }),
  properties_get: Type.Object({ path: Type.String({ minLength: 1 }) }),
  properties_set: Type.Object({
    path: Type.String({ minLength: 1 }),
    set: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    delete: Type.Optional(Type.Array(Type.String())),
  }),
  links_get: Type.Object({ path: Type.String({ minLength: 1 }) }),
  graph_neighbors: Type.Object({
    path: Type.String({ minLength: 1 }),
    depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
  }),
  dataview_query: Type.Object({ query: Type.String({ minLength: 1 }) }),
};
function schemaFor(name) { return schemas[name] || Type.Object({}); }
function result(value, details = {}) { return { content: [{ type: 'text', text: jsonText(value) }], details }; }
async function approve(ctx, name, input) {
  if (!ctx.hasUI) throw new Error(name + ' requires confirmation, but the host has no UI.');
  const title = name === 'canvas_write' ? 'Confirm Canvas write' : 'Confirm Properties write';
  const summary = name === 'canvas_write' ? 'Apply the proposed Canvas changes?' : 'Apply the proposed frontmatter changes?';
  return ctx.ui.confirm(title, summary + '\\n\\n' + JSON.stringify(input, null, 2));
}
export default function registerObsidianTools(pi) {
  for (const definition of tools) {
    pi.registerTool({
      name: 'obsidian_' + definition.name,
      label: 'Obsidian: ' + definition.name,
      description: definition.description,
      parameters: schemaFor(definition.name),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        if (definition.name === 'canvas_write' || definition.name === 'properties_set') {
          if (!await approve(ctx, definition.name, params)) return result({ cancelled: true }, { cancelled: true });
        }
        return result(await dispatchTool(ctx.cwd, definition.name, params, true));
      },
    });
  }
}
`;
}

/** Materialize the Pi extension before the subprocess is spawned. */
export function ensurePortablePiExtension(extensionPath: string): string {
  fs.mkdirSync(path.dirname(extensionPath), { recursive: true });
  const source = buildPortablePiExtensionScript();
  try {
    if (fs.readFileSync(extensionPath, 'utf8') === source) return extensionPath;
  } catch {
    // Missing or unreadable file; rewrite it below.
  }
  fs.writeFileSync(extensionPath, source, 'utf8');
  return extensionPath;
}

export const PORTABLE_OBSIDIAN_TOOL_NAMES = TOOL_DEFINITIONS.map((tool) => tool.name);
