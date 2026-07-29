import type { App } from 'obsidian';

import type {
  CanvasEdgeOperation,
  CanvasNodeOperation,
  CanvasWritePlan,
  PropertiesSetOperation,
} from '../../../core/obsidian';
import {
  applyCanvasWritePlan,
  commitCanvasWritePlan,
  diffCanvasWritePlan,
  diffPropertiesWrite,
  readCanvas,
  readProperties,
  undoLastCanvasWrite,
  writeProperties,
} from '../../../core/obsidian';
import type { ApprovalCallback, ApprovalDecision } from '../../../core/runtime/types';
import type { CodexDynamicToolRegistration } from './CodexDynamicToolRegistry';

export const CODEX_OBSIDIAN_TOOL_NAMESPACE = 'obsidian';
export const CODEX_OBSIDIAN_TOOL_VERSION = 1;

const NAMESPACE_DESCRIPTION =
  'Safe, vault-scoped tools for reading and updating native Obsidian structures.';
const MAX_RESULT_CHARS = 60_000;
const MAX_WRITE_OPERATIONS = 100;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectArguments(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw new Error('Tool arguments must be a JSON object.');
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

/** Reject host paths and traversal before calling any Obsidian vault API. */
function vaultPath(value: unknown, field = 'path'): string {
  const raw = requiredString(value, field).replace(/\\/g, '/');
  if (
    raw.startsWith('/')
    || /^[A-Za-z]:\//.test(raw)
    || raw.startsWith('\\')
    || raw.split('/').some(segment => segment === '..')
    || raw.includes('\0')
  ) {
    throw new Error(`${field} must be a relative path inside the current vault.`);
  }
  const normalized = raw.replace(/^\.\//, '').replace(/\/+/g, '/');
  if (!normalized) throw new Error(`${field} must not be empty.`);
  return normalized;
}

function jsonText(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value, null, 2);
  } catch {
    serialized = String(value);
  }
  if (serialized.length <= MAX_RESULT_CHARS) return serialized;
  return `${serialized.slice(0, MAX_RESULT_CHARS)}\n... [result truncated]`;
}

function success(value: unknown) {
  return {
    success: true,
    contentItems: [{ type: 'inputText' as const, text: jsonText(value) }],
  };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    contentItems: [{ type: 'inputText' as const, text: message }],
  };
}

function registration(
  name: string,
  description: string,
  inputSchema: unknown,
  handler: CodexDynamicToolRegistration['handler'],
): CodexDynamicToolRegistration {
  return {
    includeInThreadStart: true,
    namespace: {
      name: CODEX_OBSIDIAN_TOOL_NAMESPACE,
      description: NAMESPACE_DESCRIPTION,
    },
    tool: {
      type: 'function',
      name,
      description,
      inputSchema,
    },
    handler,
  };
}

function parseCanvasPlan(value: unknown): CanvasWritePlan {
  if (!isRecord(value)) throw new Error('plan must be an object.');
  const nodeOps = value.nodeOps ?? [];
  const edgeOps = value.edgeOps ?? [];
  if (!Array.isArray(nodeOps) || !nodeOps.every(isCanvasNodeOperation)) {
    throw new Error('nodeOps must be an array of valid Canvas node operations.');
  }
  if (!Array.isArray(edgeOps) || !edgeOps.every(isCanvasEdgeOperation)) {
    throw new Error('edgeOps must be an array of valid Canvas edge operations.');
  }
  if (nodeOps.length + edgeOps.length > MAX_WRITE_OPERATIONS) {
    throw new Error(`Canvas write is limited to ${MAX_WRITE_OPERATIONS} operations per call.`);
  }
  return { nodeOps, edgeOps };
}

function isCanvasNodeOperation(value: unknown): value is CanvasNodeOperation {
  return isRecord(value)
    && (value.action === 'add' || value.action === 'update' || value.action === 'delete')
    && isRecord(value.node)
    && typeof value.node.id === 'string';
}

function isCanvasEdgeOperation(value: unknown): value is CanvasEdgeOperation {
  return isRecord(value)
    && (value.action === 'add' || value.action === 'delete')
    && isRecord(value.edge)
    && typeof value.edge.id === 'string'
    && typeof value.edge.fromNode === 'string'
    && typeof value.edge.toNode === 'string';
}

function parsePropertiesOperation(value: JsonRecord): PropertiesSetOperation {
  const operation: PropertiesSetOperation = {};
  if (value.set !== undefined) {
    if (!isRecord(value.set)) throw new Error('set must be an object.');
    operation.set = value.set;
  }
  if (value.delete !== undefined) {
    const keys = value.delete;
    if (!Array.isArray(keys) || !keys.every((item): item is string => typeof item === 'string')) {
      throw new Error('delete must be an array of property names.');
    }
    operation.delete = keys;
  }
  if (!operation.set && !operation.delete) {
    throw new Error('Provide at least one property to set or delete.');
  }
  return operation;
}

function inTemplates(path: string): boolean {
  return path.split('/').some(segment => segment.toLowerCase() === 'templates');
}

async function approveWrite(
  approval: ApprovalCallback | undefined,
  toolName: string,
  input: JsonRecord,
  description: string,
): Promise<ApprovalDecision> {
  if (!approval) return 'deny';
  return approval(toolName, input, description, {
    decisionOptions: [
      { label: 'Allow once', value: 'allow-once', decision: 'allow' },
      { label: 'Always allow', value: 'allow-always', decision: 'allow-always' },
      { label: 'Deny', value: 'deny', decision: 'deny' },
    ],
  });
}

function buildLinks(app: App, path: string): {
  outgoing: Array<{ target: string; linkCount: number }>;
  incoming: Array<{ source: string; linkCount: number }>;
  unresolved: string[];
} {
  const resolved = (app.metadataCache.resolvedLinks ?? {});
  const unresolved = (app.metadataCache.unresolvedLinks ?? {});
  const outgoing = Object.entries(resolved[path] ?? {})
    .map(([target, linkCount]) => ({ target, linkCount }))
    .sort((a, b) => b.linkCount - a.linkCount || a.target.localeCompare(b.target));
  const incoming = Object.entries(resolved)
    .flatMap(([source, targets]) => {
      const linkCount = targets[path];
      return typeof linkCount === 'number' && linkCount > 0 ? [{ source, linkCount }] : [];
    })
    .sort((a, b) => b.linkCount - a.linkCount || a.source.localeCompare(b.source));
  const unresolvedTargets = Object.keys(unresolved[path] ?? {}).sort();
  return { outgoing, incoming, unresolved: unresolvedTargets };
}

function buildGraphNeighbors(app: App, startPath: string, requestedDepth: unknown) {
  const depth = Math.max(1, Math.min(3, typeof requestedDepth === 'number' ? Math.floor(requestedDepth) : 1));
  const resolved = (app.metadataCache.resolvedLinks ?? {});
  const adjacency = new Map<string, Map<string, number>>();
  const addEdge = (from: string, to: string, count: number): void => {
    const targets = adjacency.get(from) ?? new Map<string, number>();
    targets.set(to, (targets.get(to) ?? 0) + count);
    adjacency.set(from, targets);
  };
  for (const [source, targets] of Object.entries(resolved)) {
    for (const [target, count] of Object.entries(targets)) {
      if (typeof count !== 'number' || count <= 0) continue;
      addEdge(source, target, count);
      addEdge(target, source, count);
    }
  }

  const visited = new Map<string, { distance: number; linkCount: number }>([[startPath, { distance: 0, linkCount: 0 }]]);
  const queue: string[] = [startPath];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDistance = visited.get(current)!.distance;
    if (currentDistance >= depth) continue;
    for (const [neighbor, count] of adjacency.get(current) ?? []) {
      if (neighbor === startPath) continue;
      const nextDistance = currentDistance + 1;
      const previous = visited.get(neighbor);
      if (!previous || nextDistance < previous.distance) {
        visited.set(neighbor, { distance: nextDistance, linkCount: count });
        queue.push(neighbor);
      } else if (nextDistance === previous.distance) {
        previous.linkCount += count;
      }
    }
  }

  return [...visited.entries()]
    .filter(([path]) => path !== startPath)
    .map(([path, value]) => ({ path, ...value }))
    .sort((a, b) => a.distance - b.distance || b.linkCount - a.linkCount || a.path.localeCompare(b.path));
}

/** Creates the Codex client-hosted Obsidian tools for a single vault. */
export function createCodexObsidianTools(
  app: App,
  getApproval: () => ApprovalCallback | null,
): CodexDynamicToolRegistration[] {
  const canvasRead = registration(
    'canvas_read',
    'Read a .canvas file as structured JSON nodes and edges. Paths are vault-relative.',
    {
      type: 'object',
      properties: { path: { type: 'string', description: 'Vault-relative .canvas path.' } },
      required: ['path'],
      additionalProperties: false,
    },
    async (params) => {
      try {
        const args = objectArguments(params.arguments);
        const path = vaultPath(args.path);
        return success((await readCanvas(app.vault, path)).data);
      } catch (error) {
        return failure(error);
      }
    },
  );

  const canvasWritePreview = registration(
    'canvas_write_preview',
    'Validate and preview a .canvas node/edge plan without writing it.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative .canvas path.' },
        plan: {
          type: 'object',
          properties: { nodeOps: { type: 'array' }, edgeOps: { type: 'array' } },
          additionalProperties: false,
        },
      },
      required: ['path', 'plan'],
      additionalProperties: false,
    },
    async (params) => {
      try {
        const args = objectArguments(params.arguments);
        const path = vaultPath(args.path);
        const plan = parseCanvasPlan(args.plan);
        const current = (await readCanvas(app.vault, path)).data;
        const updated = applyCanvasWritePlan(current, plan);
        return success({
          path,
          preview: true,
          diff: diffCanvasWritePlan(current, plan),
          nodeCountBefore: current.nodes.length,
          nodeCountAfter: updated.nodes.length,
          edgeCountBefore: current.edges.length,
          edgeCountAfter: updated.edges.length,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  const canvasWrite = registration(
    'canvas_write',
    'Propose changes to a .canvas file. The user must approve a diff before anything is written.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative .canvas path.' },
        plan: {
          type: 'object',
          properties: { nodeOps: { type: 'array' }, edgeOps: { type: 'array' } },
          additionalProperties: false,
        },
      },
      required: ['path', 'plan'],
      additionalProperties: false,
    },
    async (params) => {
      try {
        const args = objectArguments(params.arguments);
        const path = vaultPath(args.path);
        const plan = parseCanvasPlan(args.plan);
        const current = (await readCanvas(app.vault, path)).data;
        const diff = diffCanvasWritePlan(current, plan);
        const decision = await approveWrite(
          getApproval() ?? undefined,
          'obsidian.canvas_write',
          args,
          diff,
        );
        if (decision !== 'allow' && decision !== 'allow-always') {
          return failure('Canvas write was not approved.');
        }
        // Validate the complete plan before writing, including node/edge references.
        applyCanvasWritePlan(current, plan);
        await commitCanvasWritePlan(app, path, plan, current);
        return success({ path, applied: true, diff });
      } catch (error) {
        return failure(error);
      }
    },
  );

  const propertiesGet = registration(
    'properties_get',
    'Read frontmatter properties from one markdown file. Paths are vault-relative.',
    {
      type: 'object',
      properties: { path: { type: 'string', description: 'Vault-relative markdown path.' } },
      required: ['path'],
      additionalProperties: false,
    },
    async (params) => {
      try {
        const args = objectArguments(params.arguments);
        return success(readProperties(app, vaultPath(args.path)));
      } catch (error) {
        return failure(error);
      }
    },
  );

  const propertiesSet = registration(
    'properties_set',
    'Set or delete markdown frontmatter properties. The user must approve the proposed diff.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative markdown path.' },
        set: { type: 'object', description: 'Properties to set or update.' },
        delete: { type: 'array', items: { type: 'string' }, description: 'Property names to delete.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async (params) => {
      try {
        const args = objectArguments(params.arguments);
        const path = vaultPath(args.path);
        if (inTemplates(path)) return failure('Properties writes are disabled inside templates/.');
        const operation = parsePropertiesOperation(args);
        const current = readProperties(app, path);
        const diff = diffPropertiesWrite(path, current.frontmatter, operation);
        const decision = await approveWrite(
          getApproval() ?? undefined,
          'obsidian.properties_set',
          args,
          diff,
        );
        if (decision !== 'allow' && decision !== 'allow-always') {
          return failure('Properties write was not approved.');
        }
        await writeProperties(app, path, operation);
        return success({ path, applied: true, diff });
      } catch (error) {
        return failure(error);
      }
    },
  );

  const linksGet = registration(
    'links_get',
    'Return outgoing, incoming, and unresolved wiki-link relationships for a vault file.',
    {
      type: 'object',
      properties: { path: { type: 'string', description: 'Vault-relative file path.' } },
      required: ['path'],
      additionalProperties: false,
    },
    async (params) => {
      try {
        const args = objectArguments(params.arguments);
        const path = vaultPath(args.path);
        if (!app.vault.getAbstractFileByPath(path)) throw new Error(`File not found in vault: ${path}`);
        return success({ path, ...buildLinks(app, path) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  const graphNeighbors = registration(
    'graph_neighbors',
    'Find linked vault neighbors using metadataCache. Depth is capped at 3 to avoid scanning the whole vault.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative file path.' },
        depth: { type: 'integer', minimum: 1, maximum: 3, default: 1 },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async (params) => {
      try {
        const args = objectArguments(params.arguments);
        const path = vaultPath(args.path);
        if (!app.vault.getAbstractFileByPath(path)) throw new Error(`File not found in vault: ${path}`);
        return success({ path, neighbors: buildGraphNeighbors(app, path, args.depth) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  const dataviewQuery = registration(
    'dataview_query',
    'Run a read-only Dataview DQL query when the Dataview plugin is installed.',
    {
      type: 'object',
      properties: { query: { type: 'string', description: 'Dataview DQL query.' } },
      required: ['query'],
      additionalProperties: false,
    },
    async (params) => {
      try {
        const args = objectArguments(params.arguments);
        const query = requiredString(args.query, 'query');
        const pluginManager = (app as App & {
          plugins?: { getPlugin?: (id: string) => unknown };
        }).plugins;
        const dataview = pluginManager?.getPlugin?.('dataview') as {
          api?: { query?: (dql: string) => Promise<unknown> };
        } | null;
        if (!dataview?.api?.query) {
          return failure('Dataview is not installed or its API is unavailable.');
        }
        return success(await dataview.api.query(query));
      } catch (error) {
        return failure(error);
      }
    },
  );

  const canvasUndo = registration(
    'canvas_undo',
    'Undo the most recent Claudian Plus Canvas write for a file. Fails safely if the canvas changed after the write.',
    {
      type: 'object',
      properties: { path: { type: 'string', description: 'Vault-relative .canvas path.' } },
      required: ['path'],
      additionalProperties: false,
    },
    async (params) => {
      try {
        const args = objectArguments(params.arguments);
        const path = vaultPath(args.path);
        const undoResult = await undoLastCanvasWrite(app.vault, path);
        return success(undoResult);
      } catch (error) {
        return failure(error);
      }
    },
  );

  return [canvasRead, canvasWritePreview, canvasWrite, canvasUndo, propertiesGet, propertiesSet, linksGet, graphNeighbors, dataviewQuery];
}
