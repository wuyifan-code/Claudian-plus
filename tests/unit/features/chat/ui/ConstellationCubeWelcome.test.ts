/** @jest-environment jsdom */

import {
  getObsidianTheme,
  observeObsidianTheme,
} from '@/features/chat/ui/obsidianTheme';

describe('ConstellationCubeWelcome theme detection', () => {
  beforeEach(() => {
    document.body.className = '';
    document.documentElement.className = '';
    delete document.body.dataset.theme;
    delete document.documentElement.dataset.theme;
    document.body.style.removeProperty('--background-primary');
  });

  it('detects Obsidian light and dark themes on the body', () => {
    document.body.classList.add('theme-light');
    expect(getObsidianTheme(document)).toBe('light');

    document.body.classList.replace('theme-light', 'theme-dark');
    expect(getObsidianTheme(document)).toBe('dark');
  });

  it('detects theme classes and data attributes on the document root', () => {
    document.documentElement.classList.add('theme-light');
    expect(getObsidianTheme(document)).toBe('light');

    document.documentElement.className = '';
    document.documentElement.dataset.theme = 'dark';
    expect(getObsidianTheme(document)).toBe('dark');
  });

  it('uses the rendered Obsidian background when theme markers disagree', () => {
    document.body.classList.add('theme-light');
    document.body.style.setProperty('--background-primary', '#181818');
    expect(getObsidianTheme(document)).toBe('dark');

    document.body.classList.replace('theme-light', 'theme-dark');
    document.body.style.setProperty('--background-primary', 'rgb(245, 246, 248)');
    expect(getObsidianTheme(document)).toBe('light');
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

  it('notifies when the document root changes theme', async () => {
    document.documentElement.classList.add('theme-dark');
    const onChange = jest.fn();
    const stopObserving = observeObsidianTheme(document, onChange);

    document.documentElement.classList.replace('theme-dark', 'theme-light');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onChange).toHaveBeenLastCalledWith('light');

    stopObserving();
  });
});
