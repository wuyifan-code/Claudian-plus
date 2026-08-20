/**
 * @jest-environment jsdom
 */
import { ComposerBlobIndicator } from '@/features/chat/ui/ComposerBlobIndicator';

describe('ComposerBlobIndicator', () => {
  it('shows listening when input focused', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ind = new ComposerBlobIndicator();
    ind.mount(host);
    ind.setListening();
    expect(host.classList.contains('claudian-plus-hidden')).toBe(false);
    ind.destroy();
    host.remove();
  });

  it('shows thinking when stream starts', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ind = new ComposerBlobIndicator();
    ind.mount(host);
    ind.setThinking();
    expect(host.classList.contains('claudian-plus-hidden')).toBe(false);
    ind.destroy();
    host.remove();
  });

  it('hides when idle', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ind = new ComposerBlobIndicator();
    ind.mount(host);
    ind.setThinking();
    ind.setIdle();
    expect(host.classList.contains('claudian-plus-hidden')).toBe(true);
    ind.destroy();
    host.remove();
  });
});
