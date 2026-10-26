/**
 * @jest-environment jsdom
 */
import { uiStateStore } from '@/features/chat/rendering/ui/stateStore';
import {
  pruneDetachedUiBlocks,
  renderUiBlock,
} from '@/features/chat/rendering/UiBlockRenderer';

import { flushFrame, installManualFrames } from './frame';

let blockCounter = 0;

let frames: ReturnType<typeof installManualFrames>;

function renderProgram(source: string): { container: HTMLElement; blockKey: string } {
  blockCounter += 1;
  const blockKey = `structure:${blockCounter}`;
  const container = document.createElement('div');
  document.body.appendChild(container);
  renderUiBlock(container, source, { blockKey });
  return { container, blockKey };
}

describe('structure widgets', () => {
  beforeEach(() => {
    frames = installManualFrames();
  });

  afterEach(() => {
    frames.restore();
  });

  afterEach(() => {
    document.body.replaceChildren();
    pruneDetachedUiBlocks();
  });

  it('renders tabs, shows one panel and writes the selected index', () => {
    const { container, blockKey } = renderProgram([
      'root = Col([tabs], 3)',
      '$tab = 0',
      'tabs = Tabs($tab, [{label: "One", content: Text("first")}, {label: "Two", content: Text("second")}])',
    ].join('\n'));

    const buttons = container.querySelectorAll<HTMLButtonElement>('.claudian-plus-ui-tab');
    const panels = container.querySelectorAll<HTMLElement>('.claudian-plus-ui-tab-panel');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute('aria-selected')).toBe('true');
    expect(panels[0]?.hasAttribute('hidden')).toBe(false);
    expect(panels[1]?.hasAttribute('hidden')).toBe(true);
    expect(container.textContent).toContain('first');

    buttons[1]!.click();
    flushFrame();

    expect(uiStateStore.get(blockKey, 'tab')).toBe(1);
    const after = container.querySelectorAll<HTMLElement>('.claudian-plus-ui-tab-panel');
    expect(after[0]?.hasAttribute('hidden')).toBe(true);
    expect(after[1]?.hasAttribute('hidden')).toBe(false);
  });

  it('accepts a tab label as the active value', () => {
    const { container } = renderProgram([
      'root = Tabs($tab, [{label: "原理", content: Text("why")}, {label: "公式", content: Text("formula")}])',
      '$tab = "公式"',
    ].join('\n'));

    const buttons = container.querySelectorAll<HTMLElement>('.claudian-plus-ui-tab');
    expect(buttons[1]?.classList.contains('is-active')).toBe(true);
    expect(container.textContent).toContain('formula');
  });

  it('opens one accordion panel at a time unless multiple is set', () => {
    const { container, blockKey } = renderProgram([
      'root = Col([acc], 3)',
      '$open = -1',
      'acc = Accordion([{title: "A", content: Text("a")}, {title: "B", content: Text("b")}], $open)',
    ].join('\n'));

    const headers = container.querySelectorAll<HTMLButtonElement>('.claudian-plus-ui-accordion-header');
    const bodies = container.querySelectorAll<HTMLElement>('.claudian-plus-ui-accordion-body');
    expect(bodies[0]?.hasAttribute('hidden')).toBe(true);

    headers[0]!.click();
    flushFrame();
    expect(uiStateStore.get(blockKey, 'open')).toBe(0);
    expect(container.querySelectorAll<HTMLElement>('.claudian-plus-ui-accordion-body')[0]?.hasAttribute('hidden'))
      .toBe(false);

    container.querySelectorAll<HTMLButtonElement>('.claudian-plus-ui-accordion-header')[1]!.click();
    flushFrame();
    expect(uiStateStore.get(blockKey, 'open')).toBe(1);
    const reopened = container.querySelectorAll<HTMLElement>('.claudian-plus-ui-accordion-body');
    expect(reopened[0]?.hasAttribute('hidden')).toBe(true);
    expect(reopened[1]?.hasAttribute('hidden')).toBe(false);
  });

  it('keeps several accordion panels open in multiple mode', () => {
    const { container, blockKey } = renderProgram([
      'root = Col([acc], 3)',
      '$open = []',
      'acc = Accordion([{title: "A", content: Text("a")}, {title: "B", content: Text("b")}], $open, true)',
    ].join('\n'));

    container.querySelectorAll<HTMLButtonElement>('.claudian-plus-ui-accordion-header')[0]!.click();
    flushFrame();
    container.querySelectorAll<HTMLButtonElement>('.claudian-plus-ui-accordion-header')[1]!.click();
    flushFrame();

    expect(uiStateStore.get(blockKey, 'open')).toEqual([0, 1]);
    const bodies = container.querySelectorAll<HTMLElement>('.claudian-plus-ui-accordion-body');
    expect(bodies[0]?.hasAttribute('hidden')).toBe(false);
    expect(bodies[1]?.hasAttribute('hidden')).toBe(false);
  });

  it('writes the clicked step index and marks steps done/active', () => {
    const { container, blockKey } = renderProgram([
      'root = Col([steps, echo], 3)',
      '$step = 0',
      'steps = Steps(["One", "Two", "Three"], $step)',
      'echo = Text("current=" + $step)',
    ].join('\n'));

    const steps = container.querySelectorAll<HTMLElement>('.claudian-plus-ui-step');
    expect(steps[0]?.classList.contains('is-active')).toBe(true);
    expect(steps[1]?.classList.contains('is-done')).toBe(false);

    steps[2]!.click();
    flushFrame();

    expect(uiStateStore.get(blockKey, 'step')).toBe(2);
    expect(container.textContent).toContain('current=2');
    const after = container.querySelectorAll<HTMLElement>('.claudian-plus-ui-step');
    expect(after[2]?.classList.contains('is-active')).toBe(true);
    expect(after[0]?.classList.contains('is-done')).toBe(true);
  });

  it('renders a timeline with tone and time labels', () => {
    const { container } = renderProgram([
      'root = Timeline([{time: "2024", title: "Start", description: "begin", tone: "success"}])',
    ].join('\n'));

    const item = container.querySelector<HTMLElement>('.claudian-plus-ui-timeline-item');
    expect(item?.dataset.tone).toBe('success');
    expect(container.textContent).toContain('2024');
    expect(container.textContent).toContain('Start');
    expect(container.textContent).toContain('begin');
  });

  it('marks rows without a time so the grid collapses to two tracks', () => {
    const { container } = renderProgram([
      'root = Timeline([{title: "Transformer"}, {time: "2020", title: "GPT-3"}])',
    ].join('\n'));

    const items = container.querySelectorAll<HTMLElement>('.claudian-plus-ui-timeline-item');
    expect(items[0]?.dataset.hasTime).toBe('false');
    expect(items[1]?.dataset.hasTime).toBe('true');
    // An empty cell in the auto time track would push the dot and the body one
    // track over, which is how a timeline ends up one glyph wide.
    expect(items[0]?.querySelector('.claudian-plus-ui-timeline-time')).toBeNull();
  });

  it('draws the timeline connector on a stretching rail, not on the dot', () => {
    const { container } = renderProgram('root = Timeline([{title: "a"}, {title: "b"}])');

    const items = container.querySelectorAll<HTMLElement>('.claudian-plus-ui-timeline-item');
    const rail = items[0]?.querySelector<HTMLElement>('.claudian-plus-ui-timeline-rail');
    expect(rail).not.toBeNull();
    expect(rail?.querySelector('.claudian-plus-ui-timeline-dot')).not.toBeNull();
    expect(rail?.querySelector('.claudian-plus-ui-timeline-line')).not.toBeNull();
  });

  it('renders a callout tone and title', () => {
    const { container } = renderProgram('root = Callout([Text("body")], "warning", "Heads up")');

    const callout = container.querySelector<HTMLElement>('.claudian-plus-ui-callout');
    expect(callout?.dataset.tone).toBe('warning');
    expect(container.querySelector('.claudian-plus-ui-callout-title')?.textContent).toBe('Heads up');
    expect(container.textContent).toContain('body');
  });

  it('signs Stat deltas and marks direction', () => {
    const { container } = renderProgram('root = Row([Stat("Revenue", "$1.2M", 12), Stat("Cost", "$800k", -3)])');

    const deltas = container.querySelectorAll<HTMLElement>('.claudian-plus-ui-stat-delta');
    expect(deltas[0]?.textContent).toBe('+12');
    expect(deltas[0]?.classList.contains('is-up')).toBe(true);
    expect(deltas[1]?.textContent).toBe('-3');
    expect(deltas[1]?.classList.contains('is-down')).toBe(true);
  });

  it('reveals content on click and keeps it open across re-renders', () => {
    const source = 'root = Col([Reveal("Answer", [Text("42")])])';
    const { container, blockKey } = renderProgram(source);

    const body = (): HTMLElement => container.querySelector<HTMLElement>('.claudian-plus-ui-reveal-body')!;
    expect(body().hasAttribute('hidden')).toBe(true);

    container.querySelector<HTMLButtonElement>('.claudian-plus-ui-reveal-toggle')!.click();
    flushFrame();
    expect(uiStateStore.get(blockKey, 'reveal#0')).toBe(true);
    expect(body().hasAttribute('hidden')).toBe(false);

    renderUiBlock(container, source, { blockKey });
    expect(body().hasAttribute('hidden')).toBe(false);
  });
});
