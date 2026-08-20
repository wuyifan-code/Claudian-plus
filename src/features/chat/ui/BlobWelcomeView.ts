import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ConversationLike } from '@/features/chat/services/WelcomeService';
import type { WelcomeService } from '@/features/chat/services/WelcomeService';
import { createBlobEngine } from '@/shared/blob/BlobEngine';
import { createProviderIconSvg } from '@/shared/icons';

export interface BlobWelcomeViewDeps {
  welcomeService: WelcomeService;
  getRecentConversations: () => ConversationLike[];
  onOpenConversation: (id: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
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

    // Recents
    const recents = this.deps.getRecentConversations();
    const service = this.deps.welcomeService;
    // Use service for slicing (already done) but ensure we use it
    void service;
    const recentsEl = container.createDiv({ cls: 'claudian-plus-welcome__recents' });
    if (recents.length === 0) {
      recentsEl.createDiv({ cls: 'claudian-plus-welcome__empty', text: 'No recent conversations yet' });
    } else {
      for (const c of recents) {
        const row = recentsEl.createDiv({ cls: 'claudian-plus-welcome__recent-row' });
        row.addEventListener('click', () => this.deps.onOpenConversation(c.id));
        const iconEl = row.createDiv({ cls: 'claudian-plus-welcome__recent-icon' });
        if (c.providerId) {
          const icon = ProviderRegistry.getChatUIConfig(c.providerId).getProviderIcon?.();
          if (icon) createProviderIconSvg(icon, { parent: iconEl, width: 14, height: 14 });
        }
        const textEl = row.createDiv({ cls: 'claudian-plus-welcome__recent-text' });
        textEl.createDiv({ cls: 'claudian-plus-welcome__recent-title', text: c.title || 'Untitled' });
        if (c.preview) textEl.createDiv({ cls: 'claudian-plus-welcome__recent-preview', text: c.preview });
      }
    }

    // Quick actions
    const actions = container.createDiv({ cls: 'claudian-plus-welcome__actions' });
    const newBtn = actions.createEl('button', { cls: 'claudian-plus-welcome__action', text: 'New session' });
    newBtn.addEventListener('click', () => this.deps.onNewSession());
    const settingsBtn = actions.createEl('button', { cls: 'claudian-plus-welcome__action', text: 'Open settings' });
    settingsBtn.addEventListener('click', () => this.deps.onOpenSettings());
    const onboardingBtn = actions.createEl('button', { cls: 'claudian-plus-welcome__action', text: 'Show onboarding again' });
    onboardingBtn.addEventListener('click', () => this.playOnboarding());
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
