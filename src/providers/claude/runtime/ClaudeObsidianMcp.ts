import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { App } from 'obsidian';
import type * as ZodModule from 'zod';

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

const MAX_RESULT_CHARS = 60_000;
const MAX_WRITE_OPERATIONS = 100;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonText(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value, null, 2);
  } catch {
    serialized = String(value);
  }
  return serialized.length <= MAX_RESULT_CHARS
    ? serialized
    : `${serialized.slice(0, MAX_RESULT_CHARS)}\n... [result truncated]`;
}

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: jsonText(value) }] };
}

function errorResult(error: unknown) {
  return {
    content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

function requiredPath(value: unknown, field = 'path'): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  const raw = value.trim().replace(/\\/g, '/');
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
    if (!Array.isArray(value.delete) || !value.delete.every(item => typeof item === 'string')) {
      throw new Error('delete must be an array of property names.');
    }
    operation.delete = value.delete;
  }
  if (!operation.set && !operation.delete) {
    throw new Error('Provide at least one property to set or delete.');
  }
  return operation;
}

function isTemplatePath(path: string): boolean {
  return path.split('/').some(segment => segment.toLowerCase() === 'templates');
}

async function approveWrite(
  approval: ApprovalCallback | null,
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

function buildLinks(app: App, path: string) {
  const resolved = app.metadataCache.resolvedLinks ?? {};
  const unresolved = app.metadataCache.unresolvedLinks ?? {};
  const outgoing = Object.entries(resolved[path] ?? {})
    .map(([target, linkCount]) => ({ target, linkCount }))
    .sort((a, b) => b.linkCount - a.linkCount || a.target.localeCompare(b.target));
  const incoming = Object.entries(resolved)
    .flatMap(([source, targets]) => {
      const linkCount = targets[path];
      return typeof linkCount === 'number' && linkCount > 0 ? [{ source, linkCount }] : [];
    })
    .sort((a, b) => b.linkCount - a.linkCount || a.source.localeCompare(b.source));
  return { outgoing, incoming, unresolved: Object.keys(unresolved[path] ?? {}).sort() };
}

function buildGraphNeighbors(app: App, startPath: string, requestedDepth: unknown) {
  const depth = Math.max(1, Math.min(3, typeof requestedDepth === 'number' ? Math.floor(requestedDepth) : 1));
  const resolved = app.metadataCache.resolvedLinks ?? {};
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
  const queue = [startPath];
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

/**
 * Creates an in-process MCP server for Claude Agent SDK queries.
 *
 * The SDK and zod are loaded lazily so enabling Claude does not add their
 * module evaluation cost to plugin startup when the provider is unused.
 */
export async function createClaudeObsidianMcpServer(
  app: App,
  getApproval: () => ApprovalCallback | null,
): Promise<McpSdkServerConfigWithInstance> {
  // The Claude SDK bundles the same Zod implementation it uses for its own
  // tool schemas and exposes it at runtime. Reusing it avoids shipping a
  // second copy of Zod in the Obsidian plugin bundle.
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const { createSdkMcpServer, tool } = sdk;
  const { z } = sdk as typeof sdk & { z: typeof ZodModule.z };

  const canvasRead = tool(
    'canvas_read',
    'Read a vault-relative .canvas file as structured nodes and edges.',
    { path: z.string().min(1) },
    async ({ path }) => {
      try {
        return result((await readCanvas(app.vault, requiredPath(path))).data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  const canvasWritePreview = tool(
    'canvas_write_preview',
    'Validate and preview a .canvas diff without writing it.',
    {
      path: z.string().min(1),
      plan: z.object({ nodeOps: z.array(z.unknown()).default([]), edgeOps: z.array(z.unknown()).default([]) }),
    },
    async ({ path, plan }) => {
      try {
        const safePath = requiredPath(path);
        const parsedPlan = parseCanvasPlan(plan);
        const current = (await readCanvas(app.vault, safePath)).data;
        const updated = applyCanvasWritePlan(current, parsedPlan);
        return result({
          path: safePath,
          preview: true,
          diff: diffCanvasWritePlan(current, parsedPlan),
          nodeCountBefore: current.nodes.length,
          nodeCountAfter: updated.nodes.length,
          edgeCountBefore: current.edges.length,
          edgeCountAfter: updated.edges.length,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  const canvasWrite = tool(
    'canvas_write',
    'Propose and apply a .canvas diff after explicit user approval.',
    {
      path: z.string().min(1),
      plan: z.object({ nodeOps: z.array(z.unknown()).default([]), edgeOps: z.array(z.unknown()).default([]) }),
    },
    async ({ path, plan }) => {
      try {
        const safePath = requiredPath(path);
        const parsedPlan = parseCanvasPlan(plan);
        const current = (await readCanvas(app.vault, safePath)).data;
        const diff = diffCanvasWritePlan(current, parsedPlan);
        const decision = await approveWrite(getApproval(), 'obsidian.canvas_write', { path: safePath, plan }, diff);
        if (decision !== 'allow' && decision !== 'allow-always') return errorResult('Canvas write was not approved.');
        applyCanvasWritePlan(current, parsedPlan);
        await commitCanvasWritePlan(app, safePath, parsedPlan, current);
        return result({ path: safePath, applied: true, diff });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  const propertiesGet = tool(
    'properties_get',
    'Read frontmatter properties from a vault-relative Markdown file.',
    { path: z.string().min(1) },
    async ({ path }) => {
      try {
        return result(readProperties(app, requiredPath(path)));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  const propertiesSet = tool(
    'properties_set',
    'Set or delete Markdown frontmatter properties after explicit user approval.',
    {
      path: z.string().min(1),
      set: z.record(z.string(), z.unknown()).optional(),
      delete: z.array(z.string()).optional(),
    },
    async ({ path, set, delete: deleteKeys }) => {
      try {
        const safePath = requiredPath(path);
        if (isTemplatePath(safePath)) return errorResult('Properties writes are disabled inside templates/.');
        const operation = parsePropertiesOperation({ set, delete: deleteKeys });
        const current = readProperties(app, safePath);
        const diff = diffPropertiesWrite(safePath, current.frontmatter, operation);
        const decision = await approveWrite(getApproval(), 'obsidian.properties_set', { path: safePath, set, delete: deleteKeys }, diff);
        if (decision !== 'allow' && decision !== 'allow-always') return errorResult('Properties write was not approved.');
        await writeProperties(app, safePath, operation);
        return result({ path: safePath, applied: true, diff });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  const linksGet = tool(
    'links_get',
    'Return outgoing, incoming, and unresolved wiki-link relationships for a file.',
    { path: z.string().min(1) },
    async ({ path }) => {
      try {
        const safePath = requiredPath(path);
        if (!app.vault.getAbstractFileByPath(safePath)) throw new Error(`File not found in vault: ${safePath}`);
        return result({ path: safePath, ...buildLinks(app, safePath) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  const graphNeighbors = tool(
    'graph_neighbors',
    'Find linked vault neighbors with a depth cap of 3.',
    { path: z.string().min(1), depth: z.number().int().min(1).max(3).optional() },
    async ({ path, depth }) => {
      try {
        const safePath = requiredPath(path);
        if (!app.vault.getAbstractFileByPath(safePath)) throw new Error(`File not found in vault: ${safePath}`);
        return result({ path: safePath, neighbors: buildGraphNeighbors(app, safePath, depth) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  const dataviewQuery = tool(
    'dataview_query',
    'Run a read-only Dataview DQL query when Dataview is installed.',
    { query: z.string().min(1) },
    async ({ query }) => {
      try {
        const dataview = (app as App & { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.('dataview') as {
          api?: { query?: (dql: string) => Promise<unknown> };
        } | null;
        if (!dataview?.api?.query) return errorResult('Dataview is not installed or its API is unavailable.');
        return result(await dataview.api.query(query.trim()));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  const canvasUndo = tool(
    'canvas_undo',
    'Undo the most recent Claudian Plus Canvas write for a file. Fails safely if the canvas changed after the write.',
    { path: z.string().min(1) },
    async ({ path }) => {
      try {
        const safePath = requiredPath(path);
        const undoResult = await undoLastCanvasWrite(app.vault, safePath);
        return result(undoResult);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return createSdkMcpServer({
    name: 'obsidian',
    version: '1.0.0',
    instructions: 'Vault-scoped Obsidian tools. All paths are relative to the current vault; write operations require user approval.',
    tools: [canvasRead, canvasWritePreview, canvasWrite, canvasUndo, propertiesGet, propertiesSet, linksGet, graphNeighbors, dataviewQuery],
  });
}
