/** @jest-environment jsdom */

import {
  getObsidianTheme,
  observeObsidianTheme,
} from '@/features/chat/ui/obsidianTheme';

describe('ConstellationCubeWelcome theme detection', () => {
  beforeEach(() => {
    document.body.className = '';
  });

  it('detects Obsidian light and dark themes', () => {
    document.body.classList.add('theme-light');
    expect(getObsidianTheme(document)).toBe('light');

    document.body.classList.replace('theme-light', 'theme-dark');
    expect(getObsidianTheme(document)).toBe('dark');
  });

  it('notifies when Obsidian changes theme and stops after cleanup', async () => {
    document.body.classList.add('theme-light');
    const onChange = jest.fn();
    const stopObserving = observeObsidianTheme(document, onChange);

    document.body.classList.replace('theme-light', 'theme-dark');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onChange).toHaveBeenLastCalledWith('dark');

    stopObserving();
    document.body.classList.replace('theme-dark', 'theme-light');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
