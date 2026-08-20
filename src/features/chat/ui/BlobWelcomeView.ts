import { createBlobEngine } from '@/shared/blob/BlobEngine';

export interface BlobWelcomeViewDeps {
  vaultName?: string;
}

export class BlobWelcomeView {
  private container: HTMLElement | null = null;
  private blobHost: HTMLElement | null = null;
  private engine: ReturnType<typeof createBlobEngine> | null = null;

  constructor(private readonly deps: BlobWelcomeViewDeps) {}

  mount(container: HTMLElement): void {
    this.container = container;
    container.empty();
    container.addClass('claudian-plus-welcome');
    container.addClass('claudian-plus-blob-welcome');

    // Blob
    this.blobHost = container.createDiv({ cls: 'claudian-plus-welcome__blob' });
    this.engine = createBlobEngine(this.blobHost, { size: 'large', initialState: 'idle' });

    // Greeting
    const hour = new Date().getHours();
    const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    const vault = this.deps.vaultName ?? 'vault';
    const greeting = container.createDiv({ cls: 'claudian-plus-welcome__greeting' });
    greeting.setText(`Good ${part}, ${vault}`);


  }

  playOnboarding(): void {
    if (!this.engine) return;
    // Simple: cycle through onboarding states quickly for preview
    const states: Array<'curious' | 'happy' | 'playful' | 'excited' | 'listening' | 'proud' | 'laughing' | 'shy'> = [
      'curious',
      'happy',
      'playful',
      'excited',
      'listening',
      'proud',
      'laughing',
      'shy',
    ];
    let n = 1;
    const interval = window.setInterval(() => {
      const mood = n % 2 === 0 ? 'idle' : states[Math.floor((n - 1) / 2) % states.length];
      // Map mood to blob state where possible, fallback to idle
      const map: Record<string, 'idle' | 'listening' | 'thinking' | 'writing' | 'celebrate'> = {
        curious: 'thinking',
        happy: 'celebrate',
        playful: 'celebrate',
        excited: 'celebrate',
        listening: 'listening',
        proud: 'celebrate',
        laughing: 'celebrate',
        shy: 'idle',
      };
      const blobState = (map[mood] ?? 'idle') as unknown as Parameters<typeof this.engine.setState>[0];
      this.engine?.setState(blobState);
      n += 1;
      if (n > 16) window.clearInterval(interval);
    }, 1200);
  }

  unmount(): void {
    this.engine?.destroy();
    this.engine = null;
    this.blobHost = null;
    if (this.container) {
      this.container.empty();
      this.container.removeClass('claudian-plus-welcome');
      this.container.removeClass('claudian-plus-blob-welcome');
    }
    this.container = null;
  }
}
