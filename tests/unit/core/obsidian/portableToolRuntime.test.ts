import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildPortableObsidianMcpScript,
  buildPortablePiExtensionScript,
  ensurePortablePiExtension,
  PORTABLE_OBSIDIAN_TOOL_NAMES,
} from '../../../../src/core/obsidian/portableToolRuntime';

describe('portable Obsidian tool runtime', () => {
  it('keeps the MCP and Pi artifacts dependency-free and tool-complete', () => {
    const mcp = buildPortableObsidianMcpScript();
    const pi = buildPortablePiExtensionScript();

    expect(PORTABLE_OBSIDIAN_TOOL_NAMES).toEqual([
      'canvas_read',
      'canvas_write_preview',
      'canvas_write',
      'properties_get',
      'properties_set',
      'links_get',
      'graph_neighbors',
      'dataview_query',
    ]);
    for (const name of PORTABLE_OBSIDIAN_TOOL_NAMES) {
      expect(mcp).toContain(`"name":"${name}"`);
      expect(pi).toContain(name);
    }
    expect(mcp).toContain("require('node:fs/promises')");
    expect(pi).toContain("from 'node:fs'");
    expect(pi).toContain("import('typebox')");
    expect(pi).toContain('ctx.ui.confirm');
  });

  it('serves initialize, tools/list, and a real vault-backed tool call', async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-plus-portable-tools-'));
    await fs.writeFile(path.join(vault, 'A.md'), '# A\n\nSee [[B]]\n', 'utf8');
    await fs.writeFile(path.join(vault, 'B.md'), '# B\n', 'utf8');
    const scriptPath = path.join(vault, 'mcp.cjs');
    await fs.writeFile(scriptPath, buildPortableObsidianMcpScript(), 'utf8');

    const responses = await new Promise<Record<string, any>[]>((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath], {
        env: { ...process.env, CLAUDIAN_PLUS_VAULT_ROOT: vault },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const lines: Record<string, any>[] = [];
      let buffer = '';
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.kill();
        if (error) reject(error);
        else resolve(lines);
      };
      const timeout = setTimeout(() => finish(new Error('portable MCP smoke test timed out')), 5000);
      child.on('error', (error) => finish(error));
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const chunks = buffer.split(/\r?\n/);
        buffer = chunks.pop() ?? '';
        for (const line of chunks) {
          if (!line.trim()) continue;
          try { lines.push(JSON.parse(line) as Record<string, any>); } catch (error) { finish(error as Error); return; }
          if (lines.length === 3) finish();
        }
      });
      child.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26' },
      }) + '\n');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
      child.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'links_get', arguments: { path: 'A.md' } },
      }) + '\n');
    });

    expect(responses[0].result.serverInfo.name).toBe('claudian-plus-obsidian');
    expect(responses[0].result.protocolVersion).toBe('2025-03-26');
    expect(responses[1].result.tools.map((tool: { name: string }) => tool.name)).toEqual(PORTABLE_OBSIDIAN_TOOL_NAMES);
    expect(responses[1].result.tools[0].inputSchema).toMatchObject({ type: 'object' });
    const links = JSON.parse(responses[2].result.content[0].text) as { outgoing: { target: string }[] };
    expect(links.outgoing).toEqual([{ target: 'B.md', linkCount: 1 }]);
  });

  it('materializes the Pi extension idempotently', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-plus-pi-extension-'));
    const extensionPath = path.join(root, '.claudian-plus', 'pi', 'obsidian-tools.mjs');
    expect(ensurePortablePiExtension(extensionPath)).toBe(extensionPath);
    const first = await fs.readFile(extensionPath, 'utf8');
    expect(ensurePortablePiExtension(extensionPath)).toBe(extensionPath);
    expect(await fs.readFile(extensionPath, 'utf8')).toBe(first);
  });

  it('routes the generated MCP server through a configured native bridge', async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-plus-portable-bridge-'));
    const scriptPath = path.join(vault, 'mcp.cjs');
    await fs.writeFile(scriptPath, buildPortableObsidianMcpScript(), 'utf8');
    const bridgeServer = createServer((request, response) => {
      request.resume();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        ok: true,
        source: 'native',
        result: { path: 'A.md', native: true },
      }));
    });
    await new Promise<void>((resolve) => bridgeServer.listen(0, '127.0.0.1', () => resolve()));
    const address = bridgeServer.address();
    if (!address || typeof address === 'string') throw new Error('Bridge test server did not bind.');

    try {
      const responses = await new Promise<Record<string, any>[]>((resolve, reject) => {
        const child = spawn(process.execPath, [scriptPath], {
          env: {
            ...process.env,
            CLAUDIAN_PLUS_OBSIDIAN_BRIDGE_TOKEN: 'bridge-test-token',
            CLAUDIAN_PLUS_OBSIDIAN_BRIDGE_URL: `http://127.0.0.1:${address.port}`,
            CLAUDIAN_PLUS_VAULT_ROOT: vault,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const responses: Record<string, any>[] = [];
        let buffer = '';
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          child.kill();
          if (error) reject(error);
          else resolve(responses);
        };
        const timeout = setTimeout(() => finish(new Error('native bridge MCP smoke test timed out')), 5000);
        child.on('error', finish);
        child.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try { responses.push(JSON.parse(line) as Record<string, any>); } catch (error) { finish(error as Error); return; }
            if (responses.length === 3) finish();
          }
        });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) + '\n');
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
        child.stdin.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'links_get', arguments: { path: 'A.md' } },
        }) + '\n');
      });

      expect(JSON.parse(responses[2].result.content[0].text)).toEqual({ path: 'A.md', native: true });
    } finally {
      await new Promise<void>((resolve) => bridgeServer.close(() => resolve()));
    }
  });
});
