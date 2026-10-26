import { type ResolvedElement, toDisplayText } from '../evaluate';
import {
  type BuildContext,
  createBlock,
  createButton,
  readList,
  readLocalState,
  readNumberValue,
  readRecord,
  readText,
  type WidgetBuilder,
} from './context';

function buildFlashcard(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const binding = readLocalState(element, ctx, null, 'flashcard');
  const flipped = binding?.value === true;

  const card = createButton(`claudian-plus-ui-flashcard${flipped ? ' is-flipped' : ''}`);
  card.setAttribute('aria-pressed', flipped ? 'true' : 'false');

  const inner = createDiv({ cls: 'claudian-plus-ui-flashcard-inner' });
  inner.appendChild(createDiv({
    cls: 'claudian-plus-ui-flashcard-face claudian-plus-ui-flashcard-front',
    text: readText(element, 0),
  }));
  inner.appendChild(createDiv({
    cls: 'claudian-plus-ui-flashcard-face claudian-plus-ui-flashcard-back',
    text: readText(element, 1),
  }));
  card.appendChild(inner);

  const toggle = (): void => {
    if (binding !== null) ctx.setState(binding.name, !flipped);
  };
  ctx.on(card, 'click', toggle);
  ctx.on(card, 'keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle();
  });

  return card;
}

interface QuizOption {
  id: string;
  label: string;
}

function readQuizOptions(value: unknown): QuizOption[] {
  return readList(value).map((item, index) => {
    const record = readRecord(item);
    if (record === null) {
      const text = toDisplayText(item);
      return { id: text, label: text };
    }
    const id = typeof record.id === 'string'
      ? record.id
      : typeof record.value === 'string' ? record.value : String(index + 1);
    const label = typeof record.label === 'string'
      ? record.label
      : typeof record.title === 'string' ? record.title : id;
    return { id, label };
  });
}

function isCorrectAnswer(answer: unknown, option: QuizOption, index: number): boolean {
  if (typeof answer === 'number') return Math.trunc(answer) === index;
  if (typeof answer === 'string') return answer === option.id || answer === option.label;
  return false;
}

/** Quiz(question, options, answer, explanation?) — grading stays local. */
function buildQuiz(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const options = readQuizOptions(element.values[1]);
  const answer = element.values[2];
  const correctIndex = options.findIndex((option, index) => isCorrectAnswer(answer, option, index));

  const selectedBinding = readLocalState(element, ctx, null, 'quizSelected');
  const checkedBinding = readLocalState(element, ctx, null, 'quizChecked');
  const rawSelected = readNumberValue(selectedBinding?.value);
  const selected = rawSelected !== null && rawSelected >= 0 && rawSelected < options.length
    ? Math.trunc(rawSelected)
    : null;
  const checked = checkedBinding?.value === true;

  const container = createBlock('claudian-plus-ui-quiz');
  container.appendChild(createDiv({ cls: 'claudian-plus-ui-quiz-question', text: readText(element, 0) }));

  const list = createDiv({ cls: 'claudian-plus-ui-quiz-options' });
  options.forEach((option, index) => {
    const button = createButton('claudian-plus-ui-quiz-option', option.label);
    button.setAttribute('role', 'radio');
    const isSelected = selected === index;
    button.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    if (isSelected) button.classList.add('is-selected');
    if (checked && isSelected) {
      button.classList.add(index === correctIndex ? 'is-correct' : 'is-wrong');
    }
    if (checked && !isSelected && index === correctIndex) button.classList.add('is-answer');

    ctx.on(button, 'click', () => {
      if (selectedBinding !== null) ctx.setState(selectedBinding.name, index);
      // Changing the answer clears a previous grade so the quiz can be retried.
      if (checked && checkedBinding !== null) ctx.setState(checkedBinding.name, false);
    });
    list.appendChild(button);
  });
  container.appendChild(list);

  const actions = createDiv({ cls: 'claudian-plus-ui-quiz-actions' });
  const check = createButton('claudian-plus-ui-button', 'Check');
  check.dataset.variant = 'outline';
  if (selected === null) check.setAttribute('disabled', 'disabled');
  ctx.on(check, 'click', () => {
    if (selectedBinding === null || checkedBinding === null) return;
    ctx.setState(checkedBinding.name, true);
  });
  actions.appendChild(check);
  container.appendChild(actions);

  if (checked && selected !== null) {
    const correct = selected === correctIndex;
    container.appendChild(createDiv({
      cls: `claudian-plus-ui-quiz-result ${correct ? 'is-correct' : 'is-wrong'}`,
      text: correct ? 'Correct' : 'Not quite',
    }));
    const explanation = readText(element, 3);
    if (explanation.length > 0) {
      container.appendChild(createDiv({ cls: 'claudian-plus-ui-quiz-explanation', text: explanation }));
    }
  }

  return container;
}

function readChecklistItems(value: unknown): string[] {
  return readList(value).map((item) => {
    const record = readRecord(item);
    if (record === null) return toDisplayText(item);
    return toDisplayText(record.label ?? record.text ?? record.title ?? '');
  });
}

function buildChecklist(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const items = readChecklistItems(element.values[0]);
  const binding = readLocalState(element, ctx, 1, 'checklist');
  const done = new Set<number>();
  for (const item of readList(binding?.value)) {
    const index = readNumberValue(item);
    if (index !== null) done.add(Math.trunc(index));
  }

  const container = createBlock('claudian-plus-ui-checklist');
  const head = createDiv({ cls: 'claudian-plus-ui-checklist-head' });
  head.appendChild(createSpan({
    cls: 'claudian-plus-ui-checklist-count',
    text: `${String(done.size)}/${String(items.length)}`,
  }));
  const track = createDiv({ cls: 'claudian-plus-ui-checklist-track' });
  const ratio = items.length === 0 ? 0 : Math.round((done.size / items.length) * 100);
  const fill = createDiv({ cls: 'claudian-plus-ui-checklist-fill' });
  fill.setCssProps({ width: `${String(ratio)}%` });
  track.appendChild(fill);
  head.appendChild(track);
  container.appendChild(head);

  items.forEach((item, index) => {
    const isDone = done.has(index);
    const row = createButton(`claudian-plus-ui-checklist-item${isDone ? ' is-done' : ''}`);
    row.setAttribute('role', 'checkbox');
    row.setAttribute('aria-checked', isDone ? 'true' : 'false');
    row.appendChild(createSpan({ cls: 'claudian-plus-ui-checklist-box' }));
    row.appendChild(createSpan({ cls: 'claudian-plus-ui-checklist-text', text: item }));
    ctx.on(row, 'click', () => {
      if (binding === null) return;
      const next = new Set(done);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      ctx.setState(binding.name, [...next].sort((a, b) => a - b));
    });
    container.appendChild(row);
  });

  return container;
}

export const LEARNING_WIDGETS: Record<string, WidgetBuilder> = {
  Flashcard: buildFlashcard,
  Quiz: buildQuiz,
  Checklist: buildChecklist,
};
