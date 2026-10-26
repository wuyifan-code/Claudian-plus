/**
 * @jest-environment jsdom
 */
import * as uiParser from '@/features/chat/rendering/ui/parser';
import { UiStateStore } from '@/features/chat/rendering/ui/stateStore';
import {
  captureUiFocus,
  disposeUiBlocksUnder,
  flushUiRender,
  hashUiBlockSource,
  pruneDetachedUiBlocks,
  renderUiBlock,
  restoreUiFocus,
  uiBlockKey,
  uiBlockSubscriptionCount,
  uiContentBlockKey,
} from '@/features/chat/rendering/UiBlockRenderer';

import { flushFrame, installManualFrames, pendingFrames } from './widgets/frame';

let frames: ReturnType<typeof installManualFrames>;

function createContainer(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

const SIMPLE_PROGRAM = [
  'root = Col([heading, body])',
  'heading = Title("Rehber")',
  'body = Text("Pick a day")',
].join('\n');

describe('renderUiBlock', () => {
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

  it('claims the block scope for the conversation that owns it', () => {
    const store = new UiStateStore();
    const container = createContainer();

    renderUiBlock(container, SIMPLE_PROGRAM, { blockKey: 'm-own:0', ownerId: 'conv-9', store });

    expect(store.scopesOf('conv-9')).toContain('m-own:0');
  });

  it('claims unowned blocks as live', () => {
    const store = new UiStateStore();
    const container = createContainer();

    renderUiBlock(container, SIMPLE_PROGRAM, { blockKey: 'm-live:0', store });

    expect(store.scopesOf('live')).toContain('m-live:0');
  });

  it('renders a program as native DOM', () => {
    const container = createContainer();
    const rendered = renderUiBlock(
      container,
      ['root = Col([heading, body])', 'heading = Title("Rehber")', 'body = Text("Pick a day")'].join('\n'),
      { blockKey: 'm1:0' },
    );

    expect(rendered).toBe(true);
    expect(container.querySelector('.claudian-plus-ui-col')).not.toBeNull();
    expect(container.textContent).toContain('Rehber');
    expect(container.textContent).toContain('Pick a day');
  });

  it('evaluates expressions and lists instead of trusting literal text', () => {
    const container = createContainer();
    renderUiBlock(
      container,
      [
        'root = Col([rows, total])',
        'items = [2, 3, 4]',
        'rows = Text("count=" + @Count(items))',
        'total = Text("sum=" + @Sum(items))',
      ].join('\n'),
      { blockKey: 'm2:0' },
    );

    expect(container.textContent).toContain('count=3');
    expect(container.textContent).toContain('sum=9');
  });

  it('keeps widget state across re-renders and reacts to a control', () => {
    const container = createContainer();
    const source = [
      'root = Col([picker, output])',
      '$mode = "slow"',
      'picker = SegmentedControl($mode, ["slow", "fast"])',
      'output = Text("mode=" + $mode)',
    ].join('\n');

    renderUiBlock(container, source, { blockKey: 'm3:0' });
    expect(container.textContent).toContain('mode=slow');

    const segments = container.querySelectorAll('.claudian-plus-ui-segment');
    (segments[1] as HTMLElement).click();
    flushFrame();

    expect(container.textContent).toContain('mode=fast');

    // Re-rendering the same block keeps the chosen value (streaming frames).
    renderUiBlock(container, source, { blockKey: 'm3:0' });
    expect(container.textContent).toContain('mode=fast');
  });

  it('keeps focus and the caret in a bound Input across keystroke re-renders', () => {
    const container = createContainer();
    const source = [
      'root = Col([field, echo])',
      '$name = ""',
      'field = Input($name, "Name")',
      'echo = Text("typed=" + $name)',
    ].join('\n');

    renderUiBlock(container, source, { blockKey: 'm9:0' });
    const firstInput = container.querySelector('.claudian-plus-ui-input') as HTMLInputElement;
    firstInput.focus();
    expect(document.activeElement).toBe(firstInput);

    firstInput.value = 'a';
    firstInput.setSelectionRange(1, 1);
    firstInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushFrame();

    const afterFirstKey = document.activeElement as HTMLInputElement;
    expect(afterFirstKey.tagName).toBe('INPUT');
    expect(afterFirstKey.dataset.uiBinding).toBe('name');
    expect(afterFirstKey.value).toBe('a');
    expect(afterFirstKey.selectionStart).toBe(1);
    expect(afterFirstKey.selectionEnd).toBe(1);
    expect(container.textContent).toContain('typed=a');

    afterFirstKey.value = 'ab';
    afterFirstKey.setSelectionRange(2, 2);
    afterFirstKey.dispatchEvent(new Event('input', { bubbles: true }));
    flushFrame();

    const afterSecondKey = document.activeElement as HTMLInputElement;
    expect(afterSecondKey.tagName).toBe('INPUT');
    expect(afterSecondKey.dataset.uiBinding).toBe('name');
    expect(afterSecondKey.value).toBe('ab');
    expect(afterSecondKey.selectionStart).toBe(2);
    expect(afterSecondKey.selectionEnd).toBe(2);
    expect(container.textContent).toContain('typed=ab');
  });

  it('restores focus to a bound Select after its change re-renders the block', () => {
    const container = createContainer();
    const source = [
      'root = Col([picker, output])',
      '$mode = "slow"',
      'picker = Select($mode, ["slow", "fast"], "Mode")',
      'output = Text("mode=" + $mode)',
    ].join('\n');

    renderUiBlock(container, source, { blockKey: 'm10:0' });
    const select = container.querySelector('select') as HTMLSelectElement;
    select.focus();
    expect(document.activeElement).toBe(select);

    select.value = 'fast';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushFrame();

    const after = document.activeElement as HTMLSelectElement;
    expect(after.tagName).toBe('SELECT');
    expect(after.dataset.uiBinding).toBe('mode');
    expect(after.value).toBe('fast');
    expect(container.textContent).toContain('mode=fast');
  });

  it('keys widget state per conversation so replayed index message ids cannot collide', () => {
    expect(uiBlockKey('conv-a', 'codex-msg-0', 0)).toBe('conv-a:codex-msg-0:0');
    expect(uiBlockKey('conv-b', 'codex-msg-0', 0)).toBe('conv-b:codex-msg-0:0');
    expect(uiBlockKey(undefined, 'm1', 2)).toBe('live:m1:2');
  });

  it('keys settled widget state by message content instead of message id', () => {
    const source = 'root = Col([])';
    const first = uiContentBlockKey('conv', hashUiBlockSource(source), 0);
    const again = uiContentBlockKey('conv', hashUiBlockSource(source), 0);
    const changed = uiContentBlockKey('conv', hashUiBlockSource('root = Col([Title("x")])'), 0);

    expect(first).toBe(again);
    expect(first).not.toBe(changed);
    expect(first).toContain(':c');
    expect(uiContentBlockKey('conv', hashUiBlockSource(source), 1)).not.toBe(first);
  });

  it('migrates streaming state into the content-keyed scope', () => {
    const store = new UiStateStore();
    const source = [
      'root = Col([picker, output])',
      '$mode = "slow"',
      'picker = SegmentedControl($mode, ["slow", "fast"])',
      'output = Text("mode=" + $mode)',
    ].join('\n');
    const legacyKey = 'conv:msg-1:0';
    const contentKey = uiContentBlockKey('conv', hashUiBlockSource(source), 0);
    const container = createContainer();

    renderUiBlock(container, source, { blockKey: legacyKey, ownerId: 'conv', store });
    (container.querySelectorAll('.claudian-plus-ui-segment')[1] as HTMLElement).click();
    flushFrame();
    expect(store.get(legacyKey, 'mode')).toBe('fast');

    renderUiBlock(container, source, {
      blockKey: contentKey,
      ownerId: 'conv',
      store,
      migrateFromKeys: [legacyKey],
    });

    expect(store.get(contentKey, 'mode')).toBe('fast');
    expect(store.get(legacyKey, 'mode')).toBeUndefined();
    expect(container.textContent).toContain('mode=fast');
    expect(uiBlockSubscriptionCount()).toBe(1);
  });

  it('restores content-keyed state on replay with a different message id', () => {
    const source = [
      'root = Col([picker, output])',
      '$mode = "slow"',
      'picker = SegmentedControl($mode, ["slow", "fast"])',
      'output = Text("mode=" + $mode)',
    ].join('\n');
    const contentKey = uiContentBlockKey('conv', hashUiBlockSource(source), 0);
    const store = new UiStateStore();
    store.set(contentKey, 'mode', 'fast');
    const container = createContainer();

    renderUiBlock(container, source, {
      blockKey: contentKey,
      ownerId: 'conv',
      store,
    });

    expect(container.textContent).toContain('mode=fast');
  });

  it('isolates widget state between conversations sharing the same message id', () => {
    const source = [
      'root = Col([picker, output])',
      '$mode = "slow"',
      'picker = SegmentedControl($mode, ["slow", "fast"])',
      'output = Text("mode=" + $mode)',
    ].join('\n');
    const containerA = createContainer();
    const containerB = createContainer();
    renderUiBlock(containerA, source, {
      blockKey: uiBlockKey('conv-a', 'codex-msg-0', 0),
      ownerId: 'conv-a',
    });
    renderUiBlock(containerB, source, {
      blockKey: uiBlockKey('conv-b', 'codex-msg-0', 0),
      ownerId: 'conv-b',
    });
    expect(uiBlockSubscriptionCount()).toBe(2);

    (containerA.querySelectorAll('.claudian-plus-ui-segment')[1] as HTMLElement).click();
    flushFrame();

    expect(containerA.textContent).toContain('mode=fast');
    expect(containerB.textContent).toContain('mode=slow');

    (containerB.querySelectorAll('.claudian-plus-ui-segment')[1] as HTMLElement).click();
    flushFrame();
    expect(containerB.textContent).toContain('mode=fast');
  });

  it('carries focus and caret into a fresh container across streaming frames', () => {
    const container = createContainer();
    const source = [
      'root = Col([field, echo])',
      '$name = ""',
      'field = Input($name, "Name")',
      'echo = Text("typed=" + $name)',
    ].join('\n');
    renderUiBlock(container, source, { blockKey: 'm12:0' });
    const input = container.querySelector('.claudian-plus-ui-input') as HTMLInputElement;
    input.focus();
    input.value = 'ab';
    input.setSelectionRange(2, 2);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushFrame();

    // Streaming frame: the old element is emptied and a fresh one mounted, so
    // the focused control is gone before the new container renders.
    const focus = captureUiFocus(container);
    container.remove();
    const next = createContainer();
    renderUiBlock(next, source, { blockKey: 'm12:0' });
    restoreUiFocus(next, focus);

    const after = document.activeElement as HTMLInputElement;
    expect(after.tagName).toBe('INPUT');
    expect(after.dataset.uiBinding).toBe('name');
    expect(after.value).toBe('ab');
    expect(after.selectionStart).toBe(2);
    expect(after.selectionEnd).toBe(2);
    expect(next.textContent).toContain('typed=ab');
  });

  it('captures focused bound controls without reading selection on types that lack it', () => {
    const container = createContainer();
    const range = document.createElement('input');
    range.type = 'range';
    range.dataset.uiBinding = 'hours';
    container.appendChild(range);
    range.focus();

    const rangeFocus = captureUiFocus(container);
    expect(rangeFocus?.binding).toBe('hours');
    expect(rangeFocus?.selectionStart).toBeNull();
    expect(rangeFocus?.selectionEnd).toBeNull();

    // Legacy engines throw for non-text types; the capture must stay safe.
    const throwing = document.createElement('input');
    throwing.type = 'number';
    throwing.dataset.uiBinding = 'qty';
    Object.defineProperty(throwing, 'selectionStart', {
      get(): number | null {
        throw new DOMException('no selection', 'InvalidStateError');
      },
      configurable: true,
    });
    Object.defineProperty(throwing, 'selectionEnd', {
      get(): number | null {
        throw new DOMException('no selection', 'InvalidStateError');
      },
      configurable: true,
    });
    container.appendChild(throwing);
    throwing.focus();

    expect(() => captureUiFocus(container)).not.toThrow();
    const guarded = captureUiFocus(container);
    expect(guarded?.binding).toBe('qty');
    expect(guarded?.selectionStart).toBeNull();
  });

  it('reports failure when the program has no usable root', () => {
    const container = createContainer();

    expect(renderUiBlock(container, 'this is not a program', { blockKey: 'm4:0' })).toBe(false);
    expect(renderUiBlock(container, 'root = NotAComponent()', { blockKey: 'm4:1' })).toBe(false);
    expect(container.childElementCount).toBe(0);
  });

  it('leaves the previous render in place when a frame yields nothing renderable', () => {
    const container = createContainer();
    renderUiBlock(container, 'root = Col([title])\ntitle = Title("kept")', { blockKey: 'm5:0' });

    // A frame without a usable program must not blank the answer.
    expect(renderUiBlock(container, 'no root here', { blockKey: 'm5:0' })).toBe(false);
    expect(container.textContent).toContain('kept');
  });

  it('renders a partially streamed program progressively', () => {
    const container = createContainer();
    renderUiBlock(container, 'root = Col([title])\ntitle = Title("first")', { blockKey: 'm5:1' });

    // An unclosed bracket auto-closes, so the newer frame still renders.
    expect(renderUiBlock(container, 'root = Col([title])\ntitle = Title("second"', { blockKey: 'm5:1' })).toBe(true);
    expect(container.textContent).toContain('second');
  });

  it('does not accumulate store subscriptions when a block is re-rendered', () => {
    const container = createContainer();
    const source = 'root = Col([])';

    for (let index = 0; index < 5; index += 1) {
      renderUiBlock(container, source, { blockKey: 'm6:0' });
    }
    expect(uiBlockSubscriptionCount()).toBe(1);

    disposeUiBlocksUnder(container);
    expect(uiBlockSubscriptionCount()).toBe(0);
  });

  it('renders a layered diagram and reports the clicked node', () => {
    const container = createContainer();
    const source = [
      'root = Col([flow, detail], 3)',
      '$sel = "a"',
      'flow = Diagram([{title: "输入", nodes: [{id: "a", label: "Token"}]}, {title: "编码器", nodes: [{id: "b", label: "注意力"}, {id: "c", label: "FFN"}]}], $sel)',
      'detail = Text("selected=" + $sel)',
    ].join('\n');

    renderUiBlock(container, source, { blockKey: 'd1:0' });

    const nodes = container.querySelectorAll('.claudian-plus-ui-diagram-node');
    expect(nodes).toHaveLength(3);
    expect(container.textContent).toContain('selected=a');
    expect((nodes[0] as HTMLElement).classList.contains('is-selected')).toBe(true);

    (nodes[1] as HTMLElement).click();
    flushFrame();

    expect(container.textContent).toContain('selected=b');
    const afterClick = container.querySelectorAll('.claudian-plus-ui-diagram-node');
    expect((afterClick[1] as HTMLElement).classList.contains('is-selected')).toBe(true);
  });

  it('forwards host actions to the callbacks', () => {
    const container = createContainer();
    const onContinueConversation = jest.fn();
    const onOpenUrl = jest.fn();

    renderUiBlock(
      container,
      [
        'root = Col([ask, link])',
        'ask = Button("Explain", @ToAssistant("Explain the chart", {chart: "revenue"}))',
        'link = Button("Docs", @OpenUrl("https://example.com/docs"))',
      ].join('\n'),
      { blockKey: 'm7:0', callbacks: { onContinueConversation, onOpenUrl } },
    );

    const buttons = container.querySelectorAll('.claudian-plus-ui-button');
    (buttons[0] as HTMLElement).click();
    flushFrame();
    (buttons[1] as HTMLElement).click();
    flushFrame();

    expect(onContinueConversation).toHaveBeenCalledWith('Explain the chart', { chart: 'revenue' });
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('forwards @InsertToNote markdown to the host callback', () => {
    const container = createContainer();
    const onInsertToNote = jest.fn();

    renderUiBlock(container, 'root = Button("Insert", @InsertToNote("## Heading"))', {
      blockKey: 'm-insert:0',
      callbacks: { onInsertToNote },
    });

    (container.querySelector('.claudian-plus-ui-button') as HTMLElement).click();
    flushFrame();
    expect(onInsertToNote).toHaveBeenCalledWith('## Heading');
  });

  it('shows a skeleton while a streaming program has no resolvable content', () => {
    const container = createContainer();

    renderUiBlock(container, 'root = Col([pending])', { blockKey: 'skeleton:0', streaming: true });
    expect(container.querySelector('.claudian-plus-ui-skeleton')).not.toBeNull();

    renderUiBlock(container, 'root = Col([Text("ready")])', {
      blockKey: 'skeleton:0',
      streaming: true,
    });
    expect(container.querySelector('.claudian-plus-ui-skeleton')).toBeNull();
  });

  it('animates a settled block once and never while streaming', () => {
    const settled = createContainer();
    renderUiBlock(settled, 'root = Col([])', { blockKey: 'enter:0' });
    expect(settled.querySelector('.claudian-plus-ui-col')?.classList.contains('is-entering')).toBe(true);

    renderUiBlock(settled, 'root = Col([])', { blockKey: 'enter:0' });
    expect(settled.querySelector('.claudian-plus-ui-col')?.classList.contains('is-entering')).toBe(false);

    const streaming = createContainer();
    renderUiBlock(streaming, 'root = Col([Text("x")])', { blockKey: 'enter:1', streaming: true });
    expect(streaming.querySelector('.claudian-plus-ui-col')?.classList.contains('is-entering')).toBe(false);
  });

  it('offers copy, reset and expand actions on every block', () => {
    const store = new UiStateStore();
    const onCopy = jest.fn();
    const source = [
      'root = Col([picker, output])',
      '$mode = "slow"',
      'picker = SegmentedControl($mode, ["slow", "fast"])',
      'output = Text("mode=" + $mode)',
    ].join('\n');
    const container = createContainer();
    renderUiBlock(container, source, { blockKey: 'toolbar:0', store, callbacks: { onCopy } });

    const buttons = (): NodeListOf<HTMLButtonElement> => (
      container.querySelectorAll<HTMLButtonElement>('.claudian-plus-ui-toolbar-button')
    );
    expect(buttons()).toHaveLength(3);

    buttons()[0]!.click();
    flushFrame();
    expect(onCopy).toHaveBeenCalledWith(source);

    (container.querySelectorAll('.claudian-plus-ui-segment')[1] as HTMLElement).click();
    flushFrame();
    expect(store.get('toolbar:0', 'mode')).toBe('fast');

    buttons()[1]!.click();
    flushFrame();
    expect(store.get('toolbar:0', 'mode')).toBeUndefined();
    expect(container.textContent).toContain('mode=slow');

    buttons()[2]!.click();
    flushFrame();
    expect(document.querySelector('.claudian-plus-ui-expanded-overlay')).not.toBeNull();
    (document.querySelector('.claudian-plus-ui-expanded-close') as HTMLElement).click();
    flushFrame();
    expect(document.querySelector('.claudian-plus-ui-expanded-overlay')).toBeNull();
  });

  it('rejects non-http links before reaching the host', () => {
    const container = createContainer();
    const onOpenUrl = jest.fn();

    renderUiBlock(container, 'root = Button("Bad", @OpenUrl("javascript:alert(1)"))', {
      blockKey: 'm8:0',
      callbacks: { onOpenUrl },
    });

    (container.querySelector('.claudian-plus-ui-button') as HTMLElement).click();
    flushFrame();
    expect(onOpenUrl).not.toHaveBeenCalled();
  });

  it('keeps one toolbar per container across re-renders', () => {
    const container = createContainer();
    renderUiBlock(container, SIMPLE_PROGRAM, { blockKey: 'bar:0' });
    const first = container.querySelector('.claudian-plus-ui-toolbar');

    renderUiBlock(container, SIMPLE_PROGRAM, { blockKey: 'bar:0' });

    const toolbars = container.querySelectorAll('.claudian-plus-ui-toolbar');
    expect(first).not.toBeNull();
    expect(toolbars).toHaveLength(1);
    expect(toolbars[0]).toBe(first);
    expect(container.lastElementChild).toBe(first);
  });

  it('renders only the block whose scope was written', () => {
    const store = new UiStateStore();
    const source = [
      'root = Col([label])',
      '$value = "initial"',
      'label = Text("value=" + $value)',
    ].join('\n');
    const written = createContainer();
    const untouched = createContainer();
    renderUiBlock(written, source, { blockKey: 'scope:a', store });
    renderUiBlock(untouched, source, { blockKey: 'scope:b', store });

    // Adoption rewrites the root's attributes, so a surviving probe proves the
    // untouched block never entered its render path.
    const root = untouched.querySelector('.claudian-plus-ui-col') as HTMLElement;
    root.dataset.probe = 'kept';

    store.set('scope:a', 'value', 'changed');

    expect(pendingFrames()).toBe(1);
    flushFrame();

    expect(written.textContent).toContain('value=changed');
    expect(untouched.textContent).toContain('value=initial');
    expect(root.dataset.probe).toBe('kept');
    expect(untouched.querySelector('.claudian-plus-ui-col')).toBe(root);
  });

  it('builds once for every write that lands in the same frame', () => {
    const store = new UiStateStore();
    const container = createContainer();
    const source = [
      'root = Col([label])',
      '$value = "initial"',
      'label = Text("value=" + $value)',
    ].join('\n');
    renderUiBlock(container, source, { blockKey: 'coalesce:0', store });

    const parse = jest.spyOn(uiParser, 'parseUiProgramCached');
    store.set('coalesce:0', 'value', 'first');
    store.set('coalesce:0', 'value', 'second');

    expect(pendingFrames()).toBe(1);
    expect(parse).not.toHaveBeenCalled();
    expect(container.textContent).toContain('value=initial');

    flushFrame();

    expect(parse).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('value=second');
    expect(pendingFrames()).toBe(0);
    parse.mockRestore();
  });

  it('drops a pending frame when the block is disposed', () => {
    const store = new UiStateStore();
    const container = createContainer();
    renderUiBlock(container, SIMPLE_PROGRAM, { blockKey: 'cancel:0', store });

    store.set('cancel:0', 'value', 'x');
    expect(pendingFrames()).toBe(1);

    disposeUiBlocksUnder(container);

    expect(pendingFrames()).toBe(0);
  });


  it('drains a pending render synchronously for hosts that read the DOM', () => {
    const store = new UiStateStore();
    const container = createContainer();
    const source = [
      'root = Col([label])',
      '$value = "initial"',
      'label = Text("value=" + $value)',
    ].join('\n');
    renderUiBlock(container, source, { blockKey: 'flush:0', store });

    store.set('flush:0', 'value', 'now');
    expect(container.textContent).toContain('value=initial');

    flushUiRender(container);

    expect(container.textContent).toContain('value=now');
    expect(pendingFrames()).toBe(0);
    flushFrame();
    expect(container.textContent).toContain('value=now');
  });

});
