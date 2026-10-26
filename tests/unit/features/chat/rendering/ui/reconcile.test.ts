/**
 * @jest-environment jsdom
 */

import {
  UI_INTERACTIVE_ATTR,
  UI_KEY_ATTR,
  UI_KIND_ATTR,
} from '@/features/chat/rendering/ui/reconcile';
import { UiStateStore } from '@/features/chat/rendering/ui/stateStore';
import { pruneDetachedUiBlocks, renderUiBlock } from '@/features/chat/rendering/UiBlockRenderer';

function createContainer(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

function program(lines: string[]): string {
  return lines.join('\n');
}

function interactiveProgram(title: string): string {
  return program([
    'root = Col([title, progress, action])',
    `title = Title("${title}")`,
    'progress = Progress(50, 100, "half")',
    'action = Button("Go", @ToAssistant("go"))',
  ]);
}

describe('UiBlockRenderer tree adoption', () => {
  afterEach(() => {
    document.body.replaceChildren();
    pruneDetachedUiBlocks();
  });

  it('keeps non-interactive nodes and rebuilds listener-holding controls', () => {
    const container = createContainer();
    renderUiBlock(container, interactiveProgram('first'), { blockKey: 'adopt:1' });

    const col = container.querySelector('.claudian-plus-ui-col') as HTMLElement;
    const title = container.querySelector('.claudian-plus-ui-title') as HTMLElement;
    const progress = container.querySelector('.claudian-plus-ui-progress') as HTMLElement;
    const button = container.querySelector('.claudian-plus-ui-button') as HTMLElement;

    expect(button.getAttribute(UI_INTERACTIVE_ATTR)).toBe('host');
    expect(title.getAttribute(UI_INTERACTIVE_ATTR)).toBeNull();
    expect(col.getAttribute(UI_INTERACTIVE_ATTR)).toBe('subtree');

    renderUiBlock(container, interactiveProgram('second'), { blockKey: 'adopt:1' });

    expect(container.querySelector('.claudian-plus-ui-col')).toBe(col);
    expect(container.querySelector('.claudian-plus-ui-title')).toBe(title);
    expect(container.querySelector('.claudian-plus-ui-progress')).toBe(progress);
    expect(container.querySelector('.claudian-plus-ui-button')).not.toBe(button);
    expect(button.isConnected).toBe(false);
    expect(title.textContent).toBe('second');
  });

  it('assigns structural keys from the finished tree, counting siblings by kind', () => {
    const container = createContainer();
    renderUiBlock(container, program([
      'root = Col([row])',
      'row = Row([a, b])',
      'a = Progress(10)',
      'b = Progress(20)',
    ]), { blockKey: 'keys:1' });

    const col = container.querySelector('.claudian-plus-ui-col') as HTMLElement;
    const row = container.querySelector('.claudian-plus-ui-row') as HTMLElement;
    const bars = row.querySelectorAll('.claudian-plus-ui-progress');

    expect(col.getAttribute(UI_KIND_ATTR)).toBe('Col');
    expect(col.getAttribute(UI_KEY_ATTR)).toBe('r');
    expect(row.getAttribute(UI_KEY_ATTR)).toBe('r/Row#0');
    expect(bars[0]?.getAttribute(UI_KEY_ATTR)).toBe('r/Row#0/Progress#0');
    expect(bars[1]?.getAttribute(UI_KEY_ATTR)).toBe('r/Row#0/Progress#1');
  });

  it('patches a progress fill in place so its transition survives', () => {
    const container = createContainer();
    const bar = (value: number): string => program([
      'root = Col([bar])',
      `bar = Progress(${String(value)})`,
    ]);

    renderUiBlock(container, bar(50), { blockKey: 'progress:1' });
    const fill = container.querySelector('.claudian-plus-ui-progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('50%');

    renderUiBlock(container, bar(80), { blockKey: 'progress:1' });

    expect(container.querySelector('.claudian-plus-ui-progress-fill')).toBe(fill);
    expect(fill.style.width).toBe('80%');
    expect(container.querySelector('.claudian-plus-ui-progress-value')?.textContent).toBe('80%');
  });

  it('rebuilds a slot whose widget kind changed and leaves no stale nodes', () => {
    const container = createContainer();
    const tabs = (second: string): string => program([
      'root = Col([tabs])',
      '$tab = 1',
      `tabs = Tabs($tab, [{label: "One", content: Text("first")}, {label: "Two", content: ${second}}])`,
    ]);

    renderUiBlock(container, tabs('Text("second")'), { blockKey: 'struct:1' });
    const panels = container.querySelectorAll('.claudian-plus-ui-tab-panel');
    expect(panels).toHaveLength(2);
    expect(panels[1]?.querySelector('.claudian-plus-ui-text')).not.toBeNull();

    renderUiBlock(container, tabs('Badge("second")'), { blockKey: 'struct:1' });

    const after = container.querySelectorAll('.claudian-plus-ui-tab-panel');
    expect(after).toHaveLength(2);
    expect(after[1]?.querySelector('.claudian-plus-ui-text')).toBeNull();
    expect(after[1]?.querySelectorAll('.claudian-plus-ui-badge')).toHaveLength(1);
    expect(after[1]?.childElementCount).toBe(1);
  });

  it('inserts and removes child slots without shuffling sibling keys', () => {
    const container = createContainer();
    renderUiBlock(container, program([
      'root = Col([a, b])',
      'a = Title("A")',
      'b = Text("B")',
    ]), { blockKey: 'shift:1' });

    const col = container.querySelector('.claudian-plus-ui-col') as HTMLElement;
    const firstTitle = container.querySelector('.claudian-plus-ui-title') as HTMLElement;

    renderUiBlock(container, program([
      'root = Col([c, a, b])',
      'c = Title("C")',
      'a = Title("A")',
      'b = Text("B")',
    ]), { blockKey: 'shift:1' });

    const titles = Array.from(col.querySelectorAll('.claudian-plus-ui-title'));
    expect(titles.map((node) => node.textContent)).toEqual(['C', 'A']);
    expect(titles[0]).toBe(firstTitle);
    expect(col.querySelector('.claudian-plus-ui-text')?.textContent).toBe('B');

    renderUiBlock(container, program([
      'root = Col([a])',
      'a = Title("A")',
    ]), { blockKey: 'shift:1' });

    expect(col.childElementCount).toBe(1);
    expect(col.querySelector('.claudian-plus-ui-text')).toBeNull();
    expect(col.querySelector('.claudian-plus-ui-title')?.textContent).toBe('A');
  });

  it('keeps the same root instance when only a descendant control changes state', () => {
    const store = new UiStateStore();
    const container = createContainer();
    const source = program([
      'root = Col([picker, output])',
      '$mode = "slow"',
      'picker = SegmentedControl($mode, ["slow", "fast"])',
      'output = Text("mode=" + $mode)',
    ]);

    renderUiBlock(container, source, { blockKey: 'root:1', store });
    const col = container.querySelector('.claudian-plus-ui-col') as HTMLElement;
    const output = container.querySelector('.claudian-plus-ui-text') as HTMLElement;

    renderUiBlock(container, source, { blockKey: 'root:1', store });

    expect(container.querySelector('.claudian-plus-ui-col')).toBe(col);
    expect(container.querySelector('.claudian-plus-ui-text')).toBe(output);
  });
});
