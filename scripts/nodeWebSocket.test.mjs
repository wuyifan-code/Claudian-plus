import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { clearImmediate, clearTimeout, setImmediate, setTimeout } from 'node:timers';
import { URL } from 'node:url';
import vm from 'node:vm';

import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { WebSocketServer } from 'ws';

import { bundleNodeWebSocket } from './nodeWebSocket.mjs';

test('the renderer bundle authenticates native HTTP and WebSocket requests using the Node ws implementation', async () => {
  const result = await build({
    stdin: {
      contents: "export { DshRemoteClient } from './src/providers/dsh/remote/DshRemoteClient';",
      resolveDir: process.cwd(), loader: 'ts',
    },
    bundle: true, format: 'cjs', target: 'es2018', minify: true, write: false, metafile: true,
    external: [...builtinModules, ...builtinModules.map(name => `node:${name}`)],
    plugins: [bundleNodeWebSocket()],
  });
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, require: createRequire(import.meta.url),
    Buffer, URL, process, setTimeout, clearTimeout, setImmediate, clearImmediate,
    window: { setTimeout, clearTimeout },
  });
  vm.runInContext(result.outputFiles[0].text, context);
  const { DshRemoteClient } = module.exports;
  const headers = [];
  const server = createServer((request, response) => {
    headers.push(request.headers.cookie);
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const { rpcId } = JSON.parse(body);
      response.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value: 'catalog' } }));
    });
  });
  const sockets = new WebSocketServer({ server, path: '/api/remote.mux' });
  sockets.on('connection', (socket, request) => {
    headers.push(request.headers.cookie);
    socket.on('message', raw => {
      const frame = JSON.parse(raw.toString());
      if (frame.type === 'open') socket.send(JSON.stringify({ type: 'item', streamId: frame.streamId, value: 'renderer response' }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new DshRemoteClient(`http://127.0.0.1:${server.address().port}`, 'native=test', { requestTimeoutMs: 1000 });
  try {
    await client.connect();
    const value = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Renderer bundle did not deliver a native stream item')), 1500);
      client.subscribe('session/follow', { args: {} }, value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
    assert.equal(value, 'renderer response');
    assert.equal(await client.call('session/modelCatalog'), 'catalog');
    assert.deepEqual(headers, ['native=test', 'native=test']);
    const inputs = Object.keys(result.metafile.inputs).map(file => file.split(path.sep).join('/'));
    assert.ok(inputs.some(file => file.endsWith('node_modules/ws/index.js')));
    assert.ok(!inputs.some(file => file.endsWith('node_modules/ws/browser.js')));
  } finally {
    try { client.dispose(); } catch { /* A broken bundle must still release the test server. */ }
    for (const socket of sockets.clients) socket.terminate();
    server.closeAllConnections();
    await new Promise(resolve => sockets.close(() => server.close(resolve)));
  }
});
