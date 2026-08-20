import { createBlobEngine } from '@/shared/blob/BlobEngine';

export class ComposerBlobIndicator {
  private engine: ReturnType<typeof createBlobEngine> | null = null;
  private host: HTMLElement | null = null;

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('claudian-plus-composer-blob');
    host.classList.add('claudian-plus-blob--small');
    this.engine = createBlobEngine(host, { size: 'small', initialState: 'idle' });
    this.hide();
  }

  show(): void {
    this.host?.classList.remove('claudian-plus-hidden');
  }

  hide(): void {
    this.host?.classList.add('claudian-plus-hidden');
  }

  setListening(): void {
    this.show();
    this.engine?.setState('listening');
  }

  setThinking(): void {
    this.show();
    this.engine?.setState('thinking');
  }

  setWriting(): void {
    this.show();
    this.engine?.setState('writing');
  }

  setIdle(): void {
    this.hide();
    this.engine?.setState('idle');
  }

  setError(): void {
    this.show();
    this.engine?.setState('error');
  }

  setCelebrate(): void {
    this.show();
    this.engine?.setState('celebrate');
  }

  destroy(): void {
    this.engine?.destroy();
    this.engine = null;
    if (this.host) {
      this.host.classList.remove('claudian-plus-composer-blob');
      this.host.empty?.();
      // Fallback for jsdom
      if (!this.host.empty) this.host.innerHTML = '';
      this.host = null;
    }
  }
}
