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

function renderProgram(source: string, callbacks?: {
  onContinueConversation?: (prompt: string, context: unknown) => void;
}): { container: HTMLElement; blockKey: string } {
  blockCounter += 1;
  const blockKey = `inputs:${blockCounter}`;
  const container = document.createElement('div');
  document.body.appendChild(container);
  renderUiBlock(container, source, { blockKey, callbacks });
  return { container, blockKey };
}

describe('input widgets', () => {
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

  it('selects one choice card and writes its id', () => {
    const { container, blockKey } = renderProgram([
      'root = Col([cards, echo], 3)',
      '$choice = "a"',
      'cards = ChoiceCards($choice, [{id: "a", title: "A", description: "first"}, {id: "b", title: "B"}])',
      'echo = Text("picked=" + $choice)',
    ].join('\n'));

    const cards = container.querySelectorAll<HTMLElement>('.claudian-plus-ui-choice-card');
    expect(cards[0]?.classList.contains('is-selected')).toBe(true);

    cards[1]!.click();
    flushFrame();

    expect(uiStateStore.get(blockKey, 'choice')).toBe('b');
    expect(container.textContent).toContain('picked=b');
    expect(container.querySelectorAll<HTMLElement>('.claudian-plus-ui-choice-card')[1]
      ?.classList.contains('is-selected')).toBe(true);
  });

  it('toggles several choice cards in multiple mode', () => {
    const { container, blockKey } = renderProgram([
      'root = Col([cards, echo], 3)',
      '$choices = []',
      'cards = ChoiceCards($choices, [{id: "a", title: "A"}, {id: "b", title: "B"}], true)',
      'echo = Text("n=" + @Count($choices))',
    ].join('\n'));

    container.querySelectorAll<HTMLElement>('.claudian-plus-ui-choice-card')[0]!.click();
    flushFrame();
    container.querySelectorAll<HTMLElement>('.claudian-plus-ui-choice-card')[1]!.click();
    flushFrame();

    expect(uiStateStore.get(blockKey, 'choices')).toEqual(['a', 'b']);
    expect(container.textContent).toContain('n=2');

    container.querySelectorAll<HTMLElement>('.claudian-plus-ui-choice-card')[0]!.click();
    flushFrame();
    expect(uiStateStore.get(blockKey, 'choices')).toEqual(['b']);
  });

  it('writes the selected radio option', () => {
    const { container, blockKey } = renderProgram([
      'root = Col([group, echo], 3)',
      '$plan = "free"',
      'group = RadioGroup($plan, [{value: "free", label: "Free"}, {value: "pro", label: "Pro", description: "paid"}], "Plan")',
      'echo = Text($plan)',
    ].join('\n'));

    const radios = container.querySelectorAll<HTMLElement>('.claudian-plus-ui-radio');
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true');

    radios[1]!.click();
    flushFrame();

    expect(uiStateStore.get(blockKey, 'plan')).toBe('pro');
    expect(container.textContent).toContain('pro');
    expect(container.querySelectorAll<HTMLElement>('.claudian-plus-ui-radio')[1]
      ?.getAttribute('aria-checked')).toBe('true');
  });

  it('toggles a switch between true and false', () => {
    const { container, blockKey } = renderProgram([
      'root = Col([toggle, echo], 3)',
      '$notify = false',
      'toggle = Switch($notify, "Notify")',
      'echo = Text("on=" + $notify)',
    ].join('\n'));

    const first = container.querySelector<HTMLElement>('.claudian-plus-ui-switch');
    expect(first?.getAttribute('aria-checked')).toBe('false');
    first!.click();
    flushFrame();

    expect(uiStateStore.get(blockKey, 'notify')).toBe(true);
    expect(container.textContent).toContain('on=true');
    const second = container.querySelector<HTMLElement>('.claudian-plus-ui-switch');
    expect(second?.getAttribute('aria-checked')).toBe('true');

    second!.click();
    flushFrame();
    expect(uiStateStore.get(blockKey, 'notify')).toBe(false);
  });

  it('commits textarea input and keeps focus across rebuilds', () => {
    const { container } = renderProgram([
      'root = Col([notes, echo], 3)',
      '$notes = ""',
      'notes = TextArea($notes, "Notes")',
      'echo = Text("len=" + $notes)',
    ].join('\n'));

    const textarea = container.querySelector<HTMLTextAreaElement>('.claudian-plus-ui-textarea')!;
    textarea.focus();
    textarea.value = 'abc';
    textarea.setSelectionRange(3, 3);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushFrame();

    const after = document.activeElement as HTMLTextAreaElement;
    expect(after.tagName).toBe('TEXTAREA');
    expect(after.dataset.uiBinding).toBe('notes');
    expect(after.value).toBe('abc');
    expect(after.selectionStart).toBe(3);
    expect(container.textContent).toContain('len=abc');
  });

  it('steps numbers and clamps them to the declared range', () => {
    const { container, blockKey } = renderProgram([
      'root = Col([stepper, echo], 3)',
      '$qty = 1',
      'stepper = NumberStepper($qty, 1, 3, 1, "Qty")',
      'echo = Text("qty=" + $qty)',
    ].join('\n'));

    container.querySelectorAll<HTMLButtonElement>('.claudian-plus-ui-stepper-button')[1]!.click();
    flushFrame();
    expect(uiStateStore.get(blockKey, 'qty')).toBe(2);

    container.querySelectorAll<HTMLButtonElement>('.claudian-plus-ui-stepper-button')[1]!.click();
    flushFrame();
    container.querySelectorAll<HTMLButtonElement>('.claudian-plus-ui-stepper-button')[1]!.click();
    flushFrame();
    expect(uiStateStore.get(blockKey, 'qty')).toBe(3);

    const input = container.querySelector<HTMLInputElement>('.claudian-plus-ui-stepper-input')!;
    input.value = '9';
    input.dispatchEvent(new Event('change'));
    flushFrame();
    expect(uiStateStore.get(blockKey, 'qty')).toBe(3);
    expect(container.textContent).toContain('qty=3');
  });

  it('writes a date string on change', () => {
    const { container, blockKey } = renderProgram([
      'root = Col([day, echo], 3)',
      '$day = "2026-10-25"',
      'day = DatePicker($day, "Day", "date")',
      'echo = Text($day)',
    ].join('\n'));

    const input = container.querySelector<HTMLInputElement>('.claudian-plus-ui-date');
    expect(input?.type).toBe('date');
    expect(input?.value).toBe('2026-10-25');

    input!.value = '2026-11-01';
    input!.dispatchEvent(new Event('change'));
    flushFrame();

    expect(uiStateStore.get(blockKey, 'day')).toBe('2026-11-01');
    expect(container.textContent).toContain('2026-11-01');
  });

  it('renders an icon button with a required accessible label', () => {
    const { container } = renderProgram('root = IconButton("sparkles", @Copy("x"), "Generate")');

    const button = container.querySelector<HTMLButtonElement>('.claudian-plus-ui-icon-button');
    expect(button?.getAttribute('aria-label')).toBe('Generate');
    expect(button?.querySelector<HTMLElement>('.claudian-plus-ui-icon')?.dataset.icon).toBe('sparkles');
  });

  it('runs a local action from a pressable block', () => {
    const { container, blockKey } = renderProgram([
      'root = Col([clickable, echo], 3)',
      '$n = 0',
      'clickable = Pressable([Text("Tap")], @Set($n, 5))',
      'echo = Text("n=" + $n)',
    ].join('\n'));

    container.querySelector<HTMLElement>('.claudian-plus-ui-pressable')!.click();
    flushFrame();

    expect(uiStateStore.get(blockKey, 'n')).toBe(5);
    expect(container.textContent).toContain('n=5');
  });

  it('submits a form once with every bound field', () => {
    const onContinueConversation = jest.fn();
    const { container } = renderProgram([
      'root = Form([name, notes, notify], "Send", "Plan it")',
      '$name = ""',
      '$notes = ""',
      '$notify = false',
      'name = Input($name, "Name")',
      'notes = TextArea($notes, "Notes")',
      'notify = Switch($notify, "Notify")',
    ].join('\n'), { onContinueConversation });

    const name = container.querySelector<HTMLInputElement>('.claudian-plus-ui-input')!;
    name.value = 'Ada';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    flushFrame();

    const notes = container.querySelector<HTMLTextAreaElement>('.claudian-plus-ui-textarea')!;
    notes.value = 'bring a coat';
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    flushFrame();

    container.querySelector<HTMLElement>('.claudian-plus-ui-switch')!.click();
    flushFrame();

    container.querySelector<HTMLButtonElement>('.claudian-plus-ui-form-footer .claudian-plus-ui-button')!.click();
    flushFrame();

    expect(onContinueConversation).toHaveBeenCalledTimes(1);
    expect(onContinueConversation).toHaveBeenCalledWith('Plan it', {
      name: 'Ada',
      notes: 'bring a coat',
      notify: true,
    });
  });

  it('disables form submission without a prompt', () => {
    const onContinueConversation = jest.fn();
    const { container } = renderProgram(
      'root = Form([Input($name, "Name")], "Send", "")\n$name = ""',
      { onContinueConversation },
    );

    const submit = container.querySelector<HTMLButtonElement>('.claudian-plus-ui-form-footer .claudian-plus-ui-button');
    expect(submit?.hasAttribute('disabled')).toBe(true);
    submit!.click();
    flushFrame();
    expect(onContinueConversation).not.toHaveBeenCalled();
  });

  it('labels select options from {id, label} pairs', () => {
    const { container, blockKey } = renderProgram([
      'root = Col([dest, echo], 3)',
      '$dest = "kyoto"',
      'dest = Select($dest, [{id: "tokyo", label: "东京"}, {id: "kyoto", label: "京都"}], "目的地")',
      'echo = Text("picked=" + $dest)',
    ].join('\n'));

    const options = [...container.querySelectorAll<HTMLOptionElement>('.claudian-plus-ui-select option')];
    expect(options.map((option) => option.textContent)).toEqual(['东京', '京都']);
    expect(options.map((option) => option.value)).toEqual(['tokyo', 'kyoto']);
    expect(container.querySelector<HTMLSelectElement>('.claudian-plus-ui-select')?.value).toBe('kyoto');

    const select = container.querySelector<HTMLSelectElement>('.claudian-plus-ui-select')!;
    select.value = 'tokyo';
    select.dispatchEvent(new Event('change'));
    flushFrame();

    expect(uiStateStore.get(blockKey, 'dest')).toBe('tokyo');
  });

  it('labels segments from {id, label} pairs and writes the id', () => {
    const { container, blockKey } = renderProgram([
      'root = Col([mode, echo], 3)',
      '$mode = "week"',
      'mode = SegmentedControl($mode, [{id: "day", label: "日"}, {id: "week", label: "周"}])',
      'echo = Text("picked=" + $mode)',
    ].join('\n'));

    const segments = [...container.querySelectorAll<HTMLButtonElement>('.claudian-plus-ui-segment')];
    expect(segments.map((segment) => segment.textContent)).toEqual(['日', '周']);
    expect(segments[1]?.classList.contains('is-active')).toBe(true);

    segments[0]!.click();
    flushFrame();

    expect(uiStateStore.get(blockKey, 'mode')).toBe('day');
  });
});
