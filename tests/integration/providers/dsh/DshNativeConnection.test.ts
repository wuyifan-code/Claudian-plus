/** @jest-environment node */
import { createServer, type Server } from 'node:http';

import { authenticateDshEndpoint } from '@/providers/dsh/runtime/DshNativeConnection';

describe('native DSH bootstrap', () => {
  let server: Server;
  let origin: string;
  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url === '/?token=test') {
        res.writeHead(303, { 'Set-Cookie': 'native=secret; HttpOnly; SameSite=Strict', Location: '/' });
      } else res.writeHead(403);
      res.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  it('uses the native bootstrap cookie without following redirects', async () => {
    expect(await authenticateDshEndpoint(`${origin}/?token=test`)).toEqual({ origin, cookie: 'native=secret' });
  });
  it('rejects non-loopback endpoints and refuses unsuccessful authentication', async () => {
    await expect(authenticateDshEndpoint('https://example.com/?token=secret')).rejects.toThrow('loopback');
    await expect(authenticateDshEndpoint(`${origin}/?token=wrong`)).rejects.toThrow('authentication');
  });
  it('honors an already cancelled bootstrap', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(authenticateDshEndpoint(`${origin}/?token=test`, controller.signal)).rejects.toThrow('cancelled');
  });
});
