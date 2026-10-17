import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

export function bundleNodeWebSocket() {
  return {
    name: 'bundle-node-websocket',
    setup(build) {
      // Obsidian's renderer supports Node sockets; ws/browser.js is only a throwing stub.
      build.onResolve({ filter: /^ws$/ }, () => ({ path: nodeRequire.resolve('ws') }));
    },
  };
}
