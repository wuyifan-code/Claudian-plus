import { createBlobEngine } from '@/shared/blob/BlobEngine';
import type { BlobState } from '@/shared/blob/types';

export class TabBlobIndicator {
  private engines = new Map<string, ReturnType<typeof createBlobEngine>>();
  private hosts = new Map<string, HTMLElement>();

  createForTab(tabId: string, host: HTMLElement): void {
    host.classList.add('claudian-plus-tab-blob');
    host.classList.add('claudian-plus-blob--small');
    const engine = createBlobEngine(host, { size: 'small', initialState: 'idle' });
    this.engines.set(tabId, engine);
    this.hosts.set(tabId, host);
    this.setIdle(tabId);
  }

  setState(tabId: string, state: BlobState): void {
    this.engines.get(tabId)?.setState(state);
    const host = this.hosts.get(tabId);
    if (!host) return;
    if (state === 'idle') host.classList.add('claudian-plus-hidden');
    else host.classList.remove('claudian-plus-hidden');
  }

  setIdle(tabId: string): void {
    this.setState(tabId, 'idle');
  }

  setThinking(tabId: string): void {
    this.setState(tabId, 'thinking');
  }

  setWriting(tabId: string): void {
    this.setState(tabId, 'writing');
  }

  removeForTab(tabId: string): void {
    this.engines.get(tabId)?.destroy();
    this.engines.delete(tabId);
    const host = this.hosts.get(tabId);
    if (host) {
      host.classList.remove('claudian-plus-tab-blob');
      host.innerHTML = '';
      this.hosts.delete(tabId);
    }
  }

  destroy(): void {
    for (const id of [...this.engines.keys()]) this.removeForTab(id);
  }
}
