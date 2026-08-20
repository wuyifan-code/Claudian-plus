/**
 * @jest-environment jsdom
 */
import { TabBlobIndicator } from '@/features/chat/tabs/TabBlobIndicator';

describe('TabBlobIndicator', () => {
  it('per-tab state isolated', () => {
    const ind = new TabBlobIndicator();
    const h1 = document.createElement('div');
    const h2 = document.createElement('div');
    document.body.appendChild(h1);
    document.body.appendChild(h2);
    ind.createForTab('a', h1);
    ind.createForTab('b', h2);
    ind.setThinking('a');
    expect(h1.classList.contains('claudian-plus-hidden')).toBe(false);
    expect(h2.classList.contains('claudian-plus-hidden')).toBe(true);
    ind.destroy();
    h1.remove();
    h2.remove();
  });

  it('remove disposes engine', () => {
    const ind = new TabBlobIndicator();
    const h = document.createElement('div');
    document.body.appendChild(h);
    ind.createForTab('a', h);
    ind.removeForTab('a');
    expect(h.classList.contains('claudian-plus-tab-blob')).toBe(false);
    ind.destroy();
    h.remove();
  });
});
