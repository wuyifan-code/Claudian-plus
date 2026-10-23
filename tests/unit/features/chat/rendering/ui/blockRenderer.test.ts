/**
 * @jest-environment jsdom
 */
import {
  disposeUiBlocksUnder,
  pruneDetachedUiBlocks,
  renderUiBlock,
  uiBlockSubscriptionCount,
} from '@/features/chat/rendering/UiBlockRenderer';

function createContainer(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

describe('renderUiBlock', () => {
  afterEach(() => {
    document.body.replaceChildren();
    pruneDetachedUiBlocks();
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

    expect(container.textContent).toContain('mode=fast');

    // Re-rendering the same block keeps the chosen value (streaming frames).
    renderUiBlock(container, source, { blockKey: 'm3:0' });
    expect(container.textContent).toContain('mode=fast');
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
    (buttons[1] as HTMLElement).click();

    expect(onContinueConversation).toHaveBeenCalledWith('Explain the chart', { chart: 'revenue' });
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('rejects non-http links before reaching the host', () => {
    const container = createContainer();
    const onOpenUrl = jest.fn();

    renderUiBlock(container, 'root = Button("Bad", @OpenUrl("javascript:alert(1)"))', {
      blockKey: 'm8:0',
      callbacks: { onOpenUrl },
    });

    (container.querySelector('.claudian-plus-ui-button') as HTMLElement).click();
    expect(onOpenUrl).not.toHaveBeenCalled();
  });
});
