import { randomBytes } from 'node:crypto';
import * as http from 'node:http';

import type { App } from 'obsidian';

import { commitCanvasWrite, undoLastCanvasWrite } from './CanvasWriteHistory';
import { buildObsidianGraphNeighbors, buildObsidianLinks } from './links';
import {
  applyCanvasWritePlan,
  type CanvasWritePlan,
  diffCanvasWritePlan,
  type PropertiesSetOperation,
  readCanvas,
  readProperties,
  writeProperties,
} from './ObsidianContextService';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_WRITE_OPERATIONS = 100;

export interface ObsidianToolBridgeHandle {
  url: string;
  token: string;
}

export interface ObsidianToolBridgeRequest {
  name: string;
  arguments?: Record<string, unknown>;
  approved?: boolean;
}

export interface ObsidianToolBridgeSuccess {
  ok: true;
  result: unknown;
  source: 'native';
}

export interface ObsidianToolBridgeError {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type ObsidianToolBridgeResponse = ObsidianToolBridgeSuccess | ObsidianToolBridgeError;

class NativeToolUnavailableError extends Error {
  readonly code = 'NATIVE_UNAVAILABLE';
}

/**
 * Loopback-only bridge for providers that run outside Obsidian's JS process.
 *
 * The bridge is intentionally short-lived and token protected. It is started
 * lazily by the plugin and is only advertised to a provider subprocess for
 * the duration of that runtime. The provider keeps the existing file-backed
 * implementation as a fallback when the bridge is unavailable.
 */
export class ObsidianToolBridge {
  private server: http.Server | null = null;
  private handle: ObsidianToolBridgeHandle | null = null;
  private startPromise: Promise<ObsidianToolBridgeHandle> | null = null;

  constructor(private readonly app: App) {}

  async start(): Promise<ObsidianToolBridgeHandle> {
    if (this.handle && this.server) return this.handle;
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise<ObsidianToolBridgeHandle>((resolve, reject) => {
      const token = randomBytes(32).toString('hex');
      const server = http.createServer((request, response) => {
        void this.handleRequest(request, response);
      });
      const fail = (error: Error) => {
        server.removeAllListeners();
        reject(error);
      };
      server.once('error', fail);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          fail(new Error('Obsidian tool bridge failed to acquire a loopback port.'));
          return;
        }
        this.server = server;
        this.handle = { url: `http://127.0.0.1:${address.port}`, token };
        server.removeListener('error', fail);
        resolve(this.handle);
      });
    }).finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.handle = null;
    this.startPromise = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (request.method !== 'POST' || request.url !== '/tools/call') {
      this.writeResponse(response, 404, {
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Obsidian tool bridge endpoint not found.' },
      });
      return;
    }
    if (!this.isAuthorized(request)) {
      this.writeResponse(response, 401, {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid Obsidian tool bridge token.' },
      });
      return;
    }

    try {
      const body = await readRequestBody(request);
      const parsed = JSON.parse(body) as unknown;
      const result = await this.dispatch(parseBridgeRequest(parsed));
      this.writeResponse(response, 200, { ok: true, result, source: 'native' });
    } catch (error) {
      const bridgeError = toBridgeError(error);
      this.writeResponse(response, bridgeError.code === 'NATIVE_UNAVAILABLE' ? 501 : 400, {
        ok: false,
        error: bridgeError,
      });
    }
  }

  private isAuthorized(request: http.IncomingMessage): boolean {
    const token = this.handle?.token;
    if (!token) return false;
    const authorization = request.headers.authorization;
    return authorization === `Bearer ${token}` || request.headers['x-claudian-plus-token'] === token;
  }

  private async dispatch(request: ObsidianToolBridgeRequest): Promise<unknown> {
    const input = request.arguments ?? {};
    switch (request.name) {
      case 'canvas_read': {
        const filePath = vaultRelativePath(input.path);
        return (await readCanvas(this.app.vault, filePath)).data;
      }
      case 'canvas_write_preview': {
        const filePath = vaultRelativePath(input.path);
        const plan = parseCanvasWritePlan(input.plan);
        const current = (await readCanvas(this.app.vault, filePath)).data;
        const updated = applyCanvasWritePlan(current, plan);
        return {
          path: filePath,
          preview: true,
          diff: diffCanvasWritePlan(current, plan),
          nodeCountBefore: current.nodes.length,
          nodeCountAfter: updated.nodes.length,
          edgeCountBefore: current.edges.length,
          edgeCountAfter: updated.edges.length,
        };
      }
      case 'canvas_write': {
        requireApproved(request);
        const filePath = vaultRelativePath(input.path);
        const plan = parseCanvasWritePlan(input.plan);
        const current = (await readCanvas(this.app.vault, filePath)).data;
        return commitCanvasWrite(this.app.vault, filePath, plan, current);
      }
      case 'properties_get': {
        return readProperties(this.app, vaultRelativePath(input.path));
      }
      case 'properties_set': {
        requireApproved(request);
        const filePath = vaultRelativePath(input.path);
        if (isTemplatePath(filePath)) throw new Error('Properties writes are disabled inside templates/.');
        const operation = parsePropertiesOperation(input);
        await writeProperties(this.app, filePath, operation);
        return { path: filePath, applied: true };
      }
      case 'links_get': {
        const filePath = vaultRelativePath(input.path);
        if (!this.app.vault.getAbstractFileByPath(filePath)) throw new Error(`File not found in vault: ${filePath}`);
        return { path: filePath, ...buildObsidianLinks(this.app, filePath) };
      }
      case 'graph_neighbors': {
        const filePath = vaultRelativePath(input.path);
        if (!this.app.vault.getAbstractFileByPath(filePath)) throw new Error(`File not found in vault: ${filePath}`);
        return { path: filePath, neighbors: buildObsidianGraphNeighbors(this.app, filePath, input.depth) };
      }
      case 'dataview_query': {
        const query = requiredString(input.query, 'query');
        const pluginManager = (this.app as App & { plugins?: { getPlugin?: (id: string) => unknown } }).plugins;
        const dataview = pluginManager?.getPlugin?.('dataview') as {
          api?: { query?: (dql: string) => Promise<unknown> };
        } | null;
        if (!dataview?.api?.query) {
          throw new NativeToolUnavailableError('Dataview is not installed or its API is unavailable.');
        }
        return dataview.api.query(query);
      }
      case 'canvas_undo': {
        const filePath = vaultRelativePath(input.path);
        return undoLastCanvasWrite(this.app.vault, filePath);
      }
      default:
        throw new Error(`Unknown Obsidian tool: ${request.name}`);
    }
  }

  private writeResponse(response: http.ServerResponse, statusCode: number, body: ObsidianToolBridgeResponse): void {
    response.statusCode = statusCode;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(body));
  }
}

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: string[] = [];
  for await (const chunk of request) {
    const text = typeof chunk === 'string'
      ? chunk
      : Buffer.from(chunk as Uint8Array).toString('utf8');
    size += Buffer.byteLength(text, 'utf8');
    if (size > MAX_BODY_BYTES) throw new Error('Obsidian tool bridge request is too large.');
    chunks.push(text);
  }
  return chunks.join('');
}

function parseBridgeRequest(value: unknown): ObsidianToolBridgeRequest {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error('Bridge request requires a tool name.');
  }
  if (value.arguments !== undefined && !isRecord(value.arguments)) {
    throw new Error('Bridge request arguments must be an object.');
  }
  return {
    name: value.name.trim(),
    arguments: value.arguments,
    approved: value.approved === true,
  };
}

function vaultRelativePath(value: unknown): string {
  const raw = requiredString(value, 'path').replace(/\\/g, '/');
  if (
    raw.startsWith('/')
    || /^[A-Za-z]:\//.test(raw)
    || raw.startsWith('\\')
    || raw.split('/').some(segment => segment === '..')
    || raw.includes('\0')
  ) {
    throw new Error('path must be relative to the current vault.');
  }
  const normalized = raw.replace(/^\.\//, '').replace(/\/{2,}/g, '/');
  if (!normalized) throw new Error('path must not be empty.');
  return normalized;
}

function parseCanvasWritePlan(value: unknown): CanvasWritePlan {
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

function isCanvasNodeOperation(value: unknown): value is CanvasWritePlan['nodeOps'][number] {
  return isRecord(value)
    && (value.action === 'add' || value.action === 'update' || value.action === 'delete')
    && isRecord(value.node)
    && typeof value.node.id === 'string';
}

function isCanvasEdgeOperation(value: unknown): value is CanvasWritePlan['edgeOps'][number] {
  return isRecord(value)
    && (value.action === 'add' || value.action === 'delete')
    && isRecord(value.edge)
    && typeof value.edge.id === 'string'
    && typeof value.edge.fromNode === 'string'
    && typeof value.edge.toNode === 'string';
}

function parsePropertiesOperation(value: Record<string, unknown>): PropertiesSetOperation {
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
  if (!operation.set && !operation.delete) throw new Error('Provide at least one property to set or delete.');
  return operation;
}

function requireApproved(request: ObsidianToolBridgeRequest): void {
  if (request.approved !== true) {
    throw new Error('Write operation requires explicit provider approval.');
  }
}

function isTemplatePath(filePath: string): boolean {
  return filePath.split('/').some(segment => segment.toLowerCase() === 'templates');
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toBridgeError(error: unknown): { code: string; message: string } {
  if (error instanceof NativeToolUnavailableError) return { code: error.code, message: error.message };
  return { code: 'TOOL_ERROR', message: error instanceof Error ? error.message : String(error) };
}
