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
  const blockKey = `learning:${blockCounter}`;
  const container = document.createElement('div');
  document.body.appendChild(container);
  renderUiBlock(container, source, { blockKey, callbacks });
  return { container, blockKey };
}

describe('learning widgets', () => {
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

  it('flips a flashcard and keeps it flipped across re-renders', () => {
    const source = 'root = Col([card], 3)\ncard = Flashcard("Question", "Answer")';
    const { container, blockKey } = renderProgram(source);

    const card = container.querySelector<HTMLElement>('.claudian-plus-ui-flashcard')!;
    expect(card.classList.contains('is-flipped')).toBe(false);
    expect(container.textContent).toContain('Question');
    expect(container.textContent).toContain('Answer');

    card.click();
    flushFrame();
    expect(uiStateStore.get(blockKey, 'flashcard#0')).toBe(true);
    expect(container.querySelector('.claudian-plus-ui-flashcard')?.classList.contains('is-flipped'))
      .toBe(true);

    renderUiBlock(container, source, { blockKey });
    expect(container.querySelector('.claudian-plus-ui-flashcard')?.classList.contains('is-flipped'))
      .toBe(true);

    container.querySelector<HTMLElement>('.claudian-plus-ui-flashcard')!.click();
    flushFrame();
    expect(uiStateStore.get(blockKey, 'flashcard#0')).toBe(false);
  });

  it('grades a quiz locally without asking the model', () => {
    const onContinueConversation = jest.fn();
    const { container } = renderProgram([
      'root = Col([quiz], 3)',
      'quiz = Quiz("2 + 2?", ["3", "4", "5"], "4", "2 + 2 is four.")',
    ].join('\n'), { onContinueConversation });

    container.querySelectorAll<HTMLElement>('.claudian-plus-ui-quiz-option')[1]!.click();
    flushFrame();
    container.querySelector<HTMLButtonElement>('.claudian-plus-ui-quiz-actions .claudian-plus-ui-button')!.click();
    flushFrame();

    expect(container.querySelectorAll<HTMLElement>('.claudian-plus-ui-quiz-option')[1]
      ?.classList.contains('is-correct')).toBe(true);
    expect(container.querySelector('.claudian-plus-ui-quiz-result')?.textContent).toBe('Correct');
    expect(container.textContent).toContain('2 + 2 is four.');
    expect(onContinueConversation).not.toHaveBeenCalled();
  });

  it('marks a wrong answer and reveals the correct option', () => {
    const { container } = renderProgram(
      'root = Quiz("2 + 2?", ["3", "4", "5"], "4", "Count on your fingers.")',
    );

    container.querySelectorAll<HTMLElement>('.claudian-plus-ui-quiz-option')[0]!.click();
    flushFrame();
    container.querySelector<HTMLButtonElement>('.claudian-plus-ui-quiz-actions .claudian-plus-ui-button')!.click();
    flushFrame();

    const options = container.querySelectorAll<HTMLElement>('.claudian-plus-ui-quiz-option');
    expect(options[0]?.classList.contains('is-wrong')).toBe(true);
    expect(options[1]?.classList.contains('is-answer')).toBe(true);
    expect(container.querySelector('.claudian-plus-ui-quiz-result')?.textContent).toBe('Not quite');
  });

  it('clears the grade when the answer changes', () => {
    const { container } = renderProgram('root = Quiz("2 + 2?", ["3", "4"], 1)');

    container.querySelectorAll<HTMLElement>('.claudian-plus-ui-quiz-option')[0]!.click();
    flushFrame();
    container.querySelector<HTMLButtonElement>('.claudian-plus-ui-quiz-actions .claudian-plus-ui-button')!.click();
    flushFrame();
    expect(container.querySelector('.claudian-plus-ui-quiz-result')?.textContent).toBe('Not quite');

    container.querySelectorAll<HTMLElement>('.claudian-plus-ui-quiz-option')[1]!.click();
    flushFrame();
    expect(container.querySelector('.claudian-plus-ui-quiz-result')).toBeNull();
    expect(container.querySelector('.claudian-plus-ui-quiz-option.is-wrong')).toBeNull();

    container.querySelector<HTMLButtonElement>('.claudian-plus-ui-quiz-actions .claudian-plus-ui-button')!.click();
    flushFrame();
    expect(container.querySelector('.claudian-plus-ui-quiz-result')?.textContent).toBe('Correct');
  });

  it('tracks checklist progress from the bound index list', () => {
    const { container, blockKey } = renderProgram([
      'root = Col([list], 3)',
      '$done = []',
      'list = Checklist(["A", "B", "C"], $done)',
    ].join('\n'));

    expect(container.querySelector('.claudian-plus-ui-checklist-count')?.textContent).toBe('0/3');

    container.querySelectorAll<HTMLElement>('.claudian-plus-ui-checklist-item')[0]!.click();
    flushFrame();
    container.querySelectorAll<HTMLElement>('.claudian-plus-ui-checklist-item')[2]!.click();
    flushFrame();

    expect(uiStateStore.get(blockKey, 'done')).toEqual([0, 2]);
    expect(container.querySelector('.claudian-plus-ui-checklist-count')?.textContent).toBe('2/3');
    expect(container.querySelector<HTMLElement>('.claudian-plus-ui-checklist-fill')?.style.width)
      .toBe('67%');

    container.querySelectorAll<HTMLElement>('.claudian-plus-ui-checklist-item')[0]!.click();
    flushFrame();
    expect(uiStateStore.get(blockKey, 'done')).toEqual([2]);
  });
});
