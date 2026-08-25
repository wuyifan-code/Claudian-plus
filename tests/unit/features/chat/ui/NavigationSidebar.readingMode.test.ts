import { createMockEl } from '@test/helpers/mockElement';

import { NavigationSidebar } from '@/features/chat/ui/NavigationSidebar';

describe('NavigationSidebar reading mode linkage', () => {
  let parentEl: any;
  let messagesEl: any;
  let sidebar: NavigationSidebar;

  beforeEach(() => {
    parentEl = createMockEl();
    messagesEl = createMockEl();
    parentEl.appendChild(messagesEl);
  });

  afterEach(() => {
    sidebar?.destroy();
  });

  it('initializes with prompt enabled by default', () => {
    sidebar = new NavigationSidebar(parentEl, messagesEl);
    const kinds = sidebar.getEffectiveEnabledKinds();
    expect(kinds.has('prompt')).toBe(true);
    expect(kinds.has('heading')).toBe(false);
    expect(kinds.has('tool')).toBe(false);
    expect(kinds.has('thinking')).toBe(false);
  });

  it('maintains prompt navigation when reading mode is toggled', () => {
    sidebar = new NavigationSidebar(parentEl, messagesEl);
    sidebar.setReadingModeActive(true);

    const kinds = sidebar.getEffectiveEnabledKinds();
    expect(kinds.has('prompt')).toBe(true);
    expect(kinds.has('heading')).toBe(false);
    expect(kinds.has('tool')).toBe(false);
    expect(kinds.has('thinking')).toBe(false);

    // Turn reading mode off
    sidebar.setReadingModeActive(false);
    const restoredKinds = sidebar.getEffectiveEnabledKinds();
    expect(restoredKinds.has('prompt')).toBe(true);
    expect(restoredKinds.has('heading')).toBe(false);
  });
});
