/**
 * @jest-environment jsdom
 */
import { uiStateStore } from '@/features/chat/rendering/ui/stateStore';
import {
  pruneDetachedUiBlocks,
  renderUiBlock,
} from '@/features/chat/rendering/UiBlockRenderer';

let blockCounter = 0;

function renderProgram(source: string): HTMLElement {
  blockCounter += 1;
  const container = document.createElement('div');
  document.body.appendChild(container);
  renderUiBlock(container, source, { blockKey: `components:${blockCounter}` });
  return container;
}

describe('component arguments at documented positions', () => {
  afterEach(() => {
    document.body.replaceChildren();
    pruneDetachedUiBlocks();
  });

  it('reads the Box border from the sixth argument', () => {
    const container = renderProgram('root = Box([Text("x")], null, null, null, null, true)');
    const box = container.querySelector<HTMLElement>('.claudian-plus-ui-box');
    expect(box?.style.border).toContain('var(--claudian-plus-border)');
  });

  it('omits the Box border when the sixth argument is absent', () => {
    const container = renderProgram('root = Box([Text("x")], null, null, null, "#ffffff")');
    const box = container.querySelector<HTMLElement>('.claudian-plus-ui-box');
    expect(box?.style.border).toBe('');
  });

  it('reads the Grid gap from the third argument', () => {
    const container = renderProgram('root = Grid([Text("a"), Text("b")], 2, 3)');
    const grid = container.querySelector<HTMLElement>('.claudian-plus-ui-grid');
    expect(grid?.style.gap).toBe('12px');
    expect(grid?.dataset.columns).toBe('2');
  });

  it('maps the Row align argument to align-items', () => {
    const end = renderProgram('root = Row([Text("a")], null, "end")')
      .querySelector<HTMLElement>('.claudian-plus-ui-row');
    expect(end?.style.alignItems).toBe('flex-end');

    const start = renderProgram('root = Row([Text("a")], null, "start")')
      .querySelector<HTMLElement>('.claudian-plus-ui-row');
    expect(start?.style.alignItems).toBe('flex-start');

    const center = renderProgram('root = Row([Text("a")], null, "center")')
      .querySelector<HTMLElement>('.claudian-plus-ui-row');
    expect(center?.style.alignItems).toBe('center');
  });

  it('marks a block SegmentedControl with is-block', () => {
    const blocked = renderProgram('root = SegmentedControl($v, ["a", "b"], true)\n$v = "a"')
      .querySelector<HTMLElement>('.claudian-plus-ui-segmented');
    expect(blocked?.classList.contains('is-block')).toBe(true);

    const inline = renderProgram('root = SegmentedControl($v, ["a", "b"])\n$v = "a"')
      .querySelector<HTMLElement>('.claudian-plus-ui-segmented');
    expect(inline?.classList.contains('is-block')).toBe(false);
  });

  it('reads the Text italic argument from the fifth position', () => {
    const container = renderProgram('root = Text("slanted", null, null, null, true)');
    const text = container.querySelector<HTMLElement>('.claudian-plus-ui-text');
    expect(text?.style.fontStyle).toBe('italic');
  });

  it('reads Button disabled from the fourth argument without stretching full-width', () => {
    const container = renderProgram('root = Button("Go", null, null, true, null)');
    const button = container.querySelector<HTMLButtonElement>('.claudian-plus-ui-button');
    expect(button?.hasAttribute('disabled')).toBe(true);
    expect(button?.style.width).toBe('');
  });

  it('reads Button full-width from the fifth argument without disabling', () => {
    const container = renderProgram('root = Button("Go", null, null, null, true)');
    const button = container.querySelector<HTMLButtonElement>('.claudian-plus-ui-button');
    expect(button?.hasAttribute('disabled')).toBe(false);
    expect(button?.style.width).toBe('100%');
  });

  it('reads the List marker from the second argument', () => {
    const container = renderProgram('root = List([ListItem("one"), ListItem("two")], "number")');
    const list = container.querySelector<HTMLElement>('.claudian-plus-ui-list');
    expect(list?.dataset.marker).toBe('number');
  });

  it('reads the Chart height from the fifth argument', () => {
    const container = renderProgram('root = Chart("bar", [["a", 1], ["b", 2]], null, null, 200)');
    const svg = container.querySelector<SVGElement>('svg');
    expect(svg?.getAttribute('height')).toBe('200');
  });

  it('reads ListItem children from the third argument', () => {
    const container = renderProgram('root = ListItem("title", "desc", [Text("nested")])');
    const item = container.querySelector<HTMLElement>('.claudian-plus-ui-list-item');
    expect(item?.textContent).toContain('nested');
  });
});

describe('Slider, Select and Checkbox input components', () => {
  afterEach(() => {
    document.body.replaceChildren();
    pruneDetachedUiBlocks();
  });

  it('commits Slider state as a number on change only', () => {
    const container = renderProgram(
      'root = Col([Slider($hours, 1, 40, 1, "Weekly hours", "h"), Text($hours)], 4)\n$hours = 10',
    );
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
    expect(slider?.min).toBe('1');
    expect(slider?.max).toBe('40');
    expect(slider?.step).toBe('1');
    expect(slider?.value).toBe('10');
    expect(slider?.dataset.uiBinding).toBe('hours');
    expect(slider?.disabled).toBe(false);
    expect(container.querySelector('label')?.textContent).toBe('Weekly hours');
    expect(container.querySelector('.claudian-plus-ui-slider-value')?.textContent).toContain('10');
    expect(container.querySelector('.claudian-plus-ui-slider-unit')?.textContent).toBe('h');

    slider!.value = '20';
    slider!.dispatchEvent(new Event('input'));
    slider!.value = '30';
    slider!.dispatchEvent(new Event('input'));
    expect(container.querySelector('.claudian-plus-ui-text')?.textContent).toBe('10');
    expect(uiStateStore.get(`components:${blockCounter}`, 'hours')).toBeUndefined();

    slider!.dispatchEvent(new Event('change'));
    expect(uiStateStore.get(`components:${blockCounter}`, 'hours')).toBe(30);
    expect(container.querySelector('.claudian-plus-ui-text')?.textContent).toBe('30');
    expect(container.querySelector<HTMLInputElement>('input[type="range"]')?.value).toBe('30');
  });

  it('falls back to 0/100/1 for invalid Slider range arguments and clamps the value', () => {
    const container = renderProgram('root = Slider($v, "bad", null, "nope")\n$v = 500');
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
    expect(slider?.min).toBe('0');
    expect(slider?.max).toBe('100');
    expect(slider?.step).toBe('1');
    expect(slider?.value).toBe('100');
  });

  it('renders Select options and writes the chosen string on change', () => {
    const container = renderProgram(
      'root = Col([Select($mode, ["slow", "fast"], "Mode"), Text($mode)], 4)\n$mode = "slow"',
    );
    const select = container.querySelector<HTMLSelectElement>('select');
    expect(select?.dataset.uiBinding).toBe('mode');
    expect(select?.disabled).toBe(false);
    expect(Array.from(select?.options ?? []).map((option) => option.textContent))
      .toEqual(['slow', 'fast']);
    expect(select?.value).toBe('slow');
    expect(container.querySelector('label')?.textContent).toBe('Mode');

    select!.value = 'fast';
    select!.dispatchEvent(new Event('change'));
    expect(uiStateStore.get(`components:${blockCounter}`, 'mode')).toBe('fast');
    expect(container.querySelector('.claudian-plus-ui-text')?.textContent).toBe('fast');
    expect(container.querySelector<HTMLSelectElement>('select')?.value).toBe('fast');
  });

  it('writes a boolean when the Checkbox toggles', () => {
    const container = renderProgram('root = Col([Checkbox($done, "Done"), Text($done)], 4)\n$done = false');
    const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.checked).toBe(false);
    expect(box?.disabled).toBe(false);
    expect(box?.dataset.uiBinding).toBe('done');
    expect(container.querySelector('label')?.textContent).toContain('Done');

    box!.checked = true;
    box!.dispatchEvent(new Event('change'));
    expect(uiStateStore.get(`components:${blockCounter}`, 'done')).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(container.querySelector('.claudian-plus-ui-text')?.textContent).toBe('true');
  });

  it('renders without a binding and ignores interaction on unbound controls', () => {
    const slider = renderProgram('root = Slider(null, 1, 10)')
      .querySelector<HTMLInputElement>('input[type="range"]');
    slider!.value = '5';
    slider!.dispatchEvent(new Event('change'));

    const select = renderProgram('root = Select(null, null, "Mode")')
      .querySelector<HTMLSelectElement>('select');
    expect(select?.options.length).toBe(0);
    select!.dispatchEvent(new Event('change'));

    const box = renderProgram('root = Checkbox(null)')
      .querySelector<HTMLInputElement>('input[type="checkbox"]');
    box!.checked = true;
    box!.dispatchEvent(new Event('change'));
  });

  it('keeps a number Input clearable instead of snapping it back to 0', () => {
    const container = renderProgram('root = Col([Input($n, "Qty", "number"), Text($n)], 4)\n$n = 5');
    const input = container.querySelector<HTMLInputElement>('input[type="number"]');
    expect(input?.value).toBe('5');

    input!.value = '';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    // The program default lives in the program, not the store; clearing the
    // field must not commit Number("") === 0.
    expect(uiStateStore.get(`components:${blockCounter}`, 'n')).toBeUndefined();
    expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('');

    input!.value = '42';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(uiStateStore.get(`components:${blockCounter}`, 'n')).toBe(42);
    expect(container.querySelector('.claudian-plus-ui-text')?.textContent).toBe('42');
  });
});
