import { type ResolvedElement, toDisplayText } from '../evaluate';
import {
  appendChildren,
  appendIcon,
  type BuildContext,
  createBlock,
  createButton,
  dispatchAction,
  readBinding,
  readList,
  readNumberValue,
  readRecord,
  readString,
  readText,
  type WidgetBuilder,
} from './context';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildButton(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const button = createButton('claudian-plus-ui-button', readText(element, 0));
  button.dataset.variant = readString(element, 2) ?? 'solid';
  if (element.values[3] === true) button.setAttribute('disabled', 'disabled');
  if (element.values[4] === true) button.classList.add('is-full-width');

  const action = element.values[1];
  ctx.on(button, 'click', () => dispatchAction(action, ctx));
  return button;
}

function buildInput(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-field');
  const label = readString(element, 1);
  if (label !== null) container.appendChild(createEl('label', { text: label }));

  const binding = readBinding(element);
  const input = createEl('input', { cls: 'claudian-plus-ui-input' });
  if (binding !== null) input.dataset.uiBinding = binding.name;
  input.type = readString(element, 2) === 'number' ? 'number' : 'text';
  const placeholder = readString(element, 3);
  if (placeholder !== null) input.placeholder = placeholder;
  input.value = readText(element, 0);

  ctx.on(input, 'input', () => {
    if (binding === null) return;
    if (input.type === 'number') {
      // Clearing the field or mid-edit values like "-" must not snap back to
      // the last committed number (Number("") === 0).
      const raw = input.value.trim();
      if (raw.length === 0) return;
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) return;
      ctx.setState(binding.name, parsed);
      return;
    }
    ctx.setState(binding.name, input.value);
  });

  container.appendChild(input);
  return container;
}

/**
 * The slider commits on `change` only: writing state on every `input` event
 * would rebuild the block mid-drag and break the gesture. The readout is
 * updated in place so the number still moves with the thumb.
 */
function buildSlider(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-field');
  const label = readString(element, 4);
  if (label !== null) container.appendChild(createEl('label', { text: label }));

  const binding = readBinding(element);
  const rawMin = readNumberValue(element.values[1]) ?? 0;
  const rawMax = readNumberValue(element.values[2]) ?? 100;
  const step = readNumberValue(element.values[3]) ?? 1;
  const min = Math.min(rawMin, rawMax);
  const max = Math.max(rawMin, rawMax);

  const input = createEl('input', { cls: 'claudian-plus-ui-range' });
  input.type = 'range';
  if (binding !== null) input.dataset.uiBinding = binding.name;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  const current = readNumberValue(binding?.value);
  input.value = String(current === null ? min : Math.min(max, Math.max(min, current)));

  const row = createDiv({ cls: 'claudian-plus-ui-slider' });
  row.appendChild(input);

  const readout = createSpan({ cls: 'claudian-plus-ui-slider-value' });
  const valueText = createSpan({ text: input.value });
  readout.appendChild(valueText);
  const unit = readString(element, 5);
  if (unit !== null) {
    readout.appendChild(createSpan({ cls: 'claudian-plus-ui-slider-unit', text: unit }));
  }
  row.appendChild(readout);

  ctx.on(input, 'input', () => {
    valueText.textContent = input.value;
  });

  ctx.on(input, 'change', () => {
    if (binding === null) return;
    ctx.setState(binding.name, Number(input.value));
  });

  container.appendChild(row);
  return container;
}

function buildSelect(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-field');
  const label = readString(element, 2);
  if (label !== null) container.appendChild(createEl('label', { text: label }));

  const binding = readBinding(element);
  const select = createEl('select', { cls: 'claudian-plus-ui-select' });
  if (binding !== null) select.dataset.uiBinding = binding.name;
  // Same option shapes as ChoiceCards and RadioGroup: a bare string, or an
  // {id, label} pair. Reading them through the shared coercion keeps the label
  // and the bound value from collapsing into an empty <option>.
  for (const option of readRadioOptions(element.values[1])) {
    select.appendChild(createEl('option', { text: option.label, attr: { value: option.value } }));
  }
  select.value = readText(element, 0);

  ctx.on(select, 'change', () => {
    if (binding === null) return;
    ctx.setState(binding.name, select.value);
  });

  container.appendChild(select);
  return container;
}

function buildCheckbox(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-field');
  const binding = readBinding(element);
  const labelText = readString(element, 1);

  const wrapper = createEl('label', { cls: 'claudian-plus-ui-checkbox' });
  const input = createEl('input', { cls: 'claudian-plus-ui-checkbox-input' });
  input.type = 'checkbox';
  if (binding !== null) input.dataset.uiBinding = binding.name;
  input.checked = binding?.value === true;

  ctx.on(input, 'change', () => {
    if (binding === null) return;
    ctx.setState(binding.name, input.checked);
  });

  wrapper.appendChild(input);
  if (labelText !== null) {
    wrapper.appendChild(createSpan({ cls: 'claudian-plus-ui-checkbox-text', text: labelText }));
  }
  container.appendChild(wrapper);
  return container;
}

function buildSegmentedControl(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-segmented');
  const binding = readBinding(element);
  const current = readText(element, 0);
  if (element.values[2] === true) container.classList.add('is-block');

  for (const option of readRadioOptions(element.values[1])) {
    const button = createEl('button', { cls: 'claudian-plus-ui-segment', text: option.label });
    button.setAttribute('type', 'button');
    if (option.value === current) button.classList.add('is-active');
    ctx.on(button, 'click', () => {
      if (binding === null) return;
      ctx.setState(binding.name, option.value);
    });
    container.appendChild(button);
  }

  return container;
}

interface ChoiceOption {
  id: string;
  title: string;
  description: string;
  icon: unknown;
}

function readChoiceOptions(value: unknown): ChoiceOption[] {
  return readList(value).map((item, index) => {
    const record = readRecord(item);
    if (record === null) {
      const text = toDisplayText(item);
      return { id: text, title: text, description: '', icon: null };
    }
    const fallback = String(index + 1);
    const id = typeof record.id === 'string'
      ? record.id
      : typeof record.value === 'string' ? record.value : fallback;
    const title = typeof record.title === 'string'
      ? record.title
      : typeof record.label === 'string' ? record.label : id;
    return {
      id,
      title,
      description: toDisplayText(record.description ?? ''),
      icon: record.icon,
    };
  });
}

function buildChoiceCards(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const options = readChoiceOptions(element.values[1]);
  const multiple = element.values[2] === true;
  const binding = readBinding(element);
  const container = createBlock('claudian-plus-ui-choice-cards');

  const selected = new Set<string>();
  if (multiple) {
    for (const item of readList(binding?.value)) selected.add(toDisplayText(item));
  } else if (binding !== null) {
    selected.add(toDisplayText(binding.value));
  }

  for (const option of options) {
    const card = createButton('claudian-plus-ui-choice-card');
    const isSelected = selected.has(option.id);
    card.classList.toggle('is-selected', isSelected);
    card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    appendIcon(card, option.icon);

    const body = createDiv({ cls: 'claudian-plus-ui-choice-body' });
    body.appendChild(createDiv({ cls: 'claudian-plus-ui-choice-title', text: option.title }));
    if (option.description.length > 0) {
      body.appendChild(createDiv({ cls: 'claudian-plus-ui-choice-desc', text: option.description }));
    }
    card.appendChild(body);

    ctx.on(card, 'click', () => {
      if (binding === null) return;
      if (!multiple) {
        ctx.setState(binding.name, option.id);
        return;
      }
      const next = new Set(selected);
      if (next.has(option.id)) next.delete(option.id);
      else next.add(option.id);
      ctx.setState(binding.name, [...next]);
    });
    container.appendChild(card);
  }

  return container;
}

interface RadioOption {
  value: string;
  label: string;
  description: string;
}

function readRadioOptions(value: unknown): RadioOption[] {
  return readList(value).map((item, index) => {
    const record = readRecord(item);
    if (record === null) {
      const text = toDisplayText(item);
      return { value: text, label: text, description: '' };
    }
    const value = typeof record.value === 'string'
      ? record.value
      : typeof record.id === 'string' ? record.id : String(index + 1);
    const label = typeof record.label === 'string'
      ? record.label
      : typeof record.title === 'string' ? record.title : value;
    return { value, label, description: toDisplayText(record.description ?? '') };
  });
}

function buildRadioGroup(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const options = readRadioOptions(element.values[1]);
  const binding = readBinding(element);
  const current = binding === null ? '' : toDisplayText(binding.value);
  const container = createBlock('claudian-plus-ui-radio-group');
  container.setAttribute('role', 'radiogroup');

  const label = readText(element, 2);
  if (label.length > 0) {
    container.appendChild(createDiv({ cls: 'claudian-plus-ui-radio-label', text: label }));
  }

  for (const option of options) {
    const item = createButton('claudian-plus-ui-radio');
    const active = option.value === current;
    item.setAttribute('role', 'radio');
    item.setAttribute('aria-checked', active ? 'true' : 'false');
    if (active) item.classList.add('is-active');

    item.appendChild(createSpan({ cls: 'claudian-plus-ui-radio-dot' }));
    const body = createDiv({ cls: 'claudian-plus-ui-radio-body' });
    body.appendChild(createDiv({ cls: 'claudian-plus-ui-radio-title', text: option.label }));
    if (option.description.length > 0) {
      body.appendChild(createDiv({ cls: 'claudian-plus-ui-radio-desc', text: option.description }));
    }
    item.appendChild(body);

    ctx.on(item, 'click', () => {
      if (binding !== null) ctx.setState(binding.name, option.value);
    });
    container.appendChild(item);
  }

  return container;
}

function buildSwitch(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const binding = readBinding(element);
  const on = binding?.value === true;
  const container = createBlock('claudian-plus-ui-switch-row');
  const button = createButton('claudian-plus-ui-switch');
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', on ? 'true' : 'false');
  if (on) button.classList.add('is-on');

  const track = createSpan({ cls: 'claudian-plus-ui-switch-track' });
  track.appendChild(createSpan({ cls: 'claudian-plus-ui-switch-thumb' }));
  button.appendChild(track);

  const label = readText(element, 1);
  if (label.length > 0) {
    button.appendChild(createSpan({ cls: 'claudian-plus-ui-switch-label', text: label }));
  }

  ctx.on(button, 'click', () => {
    if (binding !== null) ctx.setState(binding.name, !on);
  });

  container.appendChild(button);
  return container;
}

function buildTextArea(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-field');
  const label = readString(element, 1);
  if (label !== null) container.appendChild(createEl('label', { text: label }));

  const binding = readBinding(element);
  const textarea = createEl('textarea', { cls: 'claudian-plus-ui-textarea' });
  if (binding !== null) textarea.dataset.uiBinding = binding.name;
  const placeholder = readString(element, 2);
  if (placeholder !== null) textarea.placeholder = placeholder;
  const rows = readNumberValue(element.values[3]);
  textarea.rows = rows === null ? 3 : Math.max(2, Math.min(12, Math.trunc(rows)));
  textarea.value = readText(element, 0);

  ctx.on(textarea, 'input', () => {
    if (binding !== null) ctx.setState(binding.name, textarea.value);
  });

  container.appendChild(textarea);
  return container;
}

function buildNumberStepper(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-field');
  const label = readString(element, 4);
  if (label !== null) container.appendChild(createEl('label', { text: label }));

  const binding = readBinding(element);
  const rawMin = readNumberValue(element.values[1]);
  const rawMax = readNumberValue(element.values[2]);
  const step = Math.abs(readNumberValue(element.values[3]) ?? 1) || 1;
  const min = rawMin ?? -Number.MAX_SAFE_INTEGER;
  const max = rawMax ?? Number.MAX_SAFE_INTEGER;
  const current = readNumberValue(binding?.value);
  const value = current === null ? (rawMin ?? 0) : clamp(current, min, max);

  const row = createDiv({ cls: 'claudian-plus-ui-stepper' });
  const minus = createButton('claudian-plus-ui-stepper-button', '−');
  minus.setAttribute('aria-label', 'Decrease');
  const input = createEl('input', { cls: 'claudian-plus-ui-stepper-input' });
  input.type = 'number';
  if (binding !== null) input.dataset.uiBinding = binding.name;
  if (rawMin !== null) input.min = String(rawMin);
  if (rawMax !== null) input.max = String(rawMax);
  input.step = String(step);
  input.value = String(value);
  const plus = createButton('claudian-plus-ui-stepper-button', '+');
  plus.setAttribute('aria-label', 'Increase');

  const commit = (next: number): void => {
    const clamped = clamp(next, min, max);
    input.value = String(clamped);
    if (binding !== null) ctx.setState(binding.name, clamped);
  };

  ctx.on(minus, 'click', () => commit(Number(input.value) - step));
  ctx.on(plus, 'click', () => commit(Number(input.value) + step));
  ctx.on(input, 'change', () => {
    const parsed = Number(input.value);
    if (input.value.trim().length === 0 || Number.isNaN(parsed)) {
      input.value = String(value);
      return;
    }
    commit(parsed);
  });

  row.appendChild(minus);
  row.appendChild(input);
  row.appendChild(plus);
  container.appendChild(row);
  return container;
}

function buildDatePicker(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-field');
  const label = readString(element, 1);
  if (label !== null) container.appendChild(createEl('label', { text: label }));

  const binding = readBinding(element);
  const input = createEl('input', { cls: 'claudian-plus-ui-input claudian-plus-ui-date' });
  const mode = readString(element, 2);
  input.type = mode === 'time' ? 'time' : mode === 'datetime-local' ? 'datetime-local' : 'date';
  if (binding !== null) input.dataset.uiBinding = binding.name;
  input.value = readText(element, 0);

  ctx.on(input, 'change', () => {
    if (binding !== null) ctx.setState(binding.name, input.value);
  });

  container.appendChild(input);
  return container;
}

function buildIconButton(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const iconName = readText(element, 0);
  const label = readText(element, 2);
  const accessibleLabel = label.length > 0 ? label : iconName;
  const button = createButton('claudian-plus-ui-icon-button');
  button.setAttribute('aria-label', accessibleLabel);
  button.setAttribute('title', accessibleLabel);

  const icon = appendIcon(button, element.values[0]);
  if (icon === null) button.textContent = accessibleLabel;

  const action = element.values[1];
  ctx.on(button, 'click', () => dispatchAction(action, ctx));
  return button;
}

function buildPressable(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const button = createButton('claudian-plus-ui-pressable');
  appendChildren(button, element.values[0], ctx);
  const action = element.values[1];
  ctx.on(button, 'click', () => dispatchAction(action, ctx));
  return button;
}

/** Collects every `$variable` reachable from a form subtree with its current value. */
function collectBindings(value: unknown, fields: Record<string, unknown>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectBindings(item, fields);
    return;
  }
  if (value === null || typeof value !== 'object') return;

  const element = value as { type?: unknown; args?: unknown; values?: unknown };
  if (element.type !== 'element' || !Array.isArray(element.args) || !Array.isArray(element.values)) {
    return;
  }

  element.args.forEach((arg, index) => {
    if (arg === null || typeof arg !== 'object') return;
    const candidate = arg as { kind?: unknown; name?: unknown };
    if (candidate.kind === 'state' && typeof candidate.name === 'string') {
      fields[candidate.name] = (element.values as unknown[])[index];
    }
  });
  for (const child of element.values as unknown[]) collectBindings(child, fields);
}

/** Form(children, submitLabel, prompt) — one gesture, exactly one model turn. */
function buildForm(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-form');
  const body = createDiv({ cls: 'claudian-plus-ui-form-body' });
  appendChildren(body, element.values[0], ctx);
  container.appendChild(body);

  const prompt = readText(element, 2);
  const submitLabel = readText(element, 1);
  const footer = createDiv({ cls: 'claudian-plus-ui-form-footer' });
  const submit = createButton('claudian-plus-ui-button', submitLabel.length > 0 ? submitLabel : 'Submit');
  submit.dataset.variant = 'solid';
  if (prompt.length === 0) submit.setAttribute('disabled', 'disabled');

  ctx.on(submit, 'click', () => {
    if (prompt.length === 0) return;
    const fields: Record<string, unknown> = {};
    collectBindings(element.values[0], fields);
    ctx.runAction({ type: 'action', name: '@ToAssistant', values: [prompt, fields] });
  });

  footer.appendChild(submit);
  container.appendChild(footer);
  return container;
}

export const INPUT_WIDGETS: Record<string, WidgetBuilder> = {
  Button: buildButton,
  Input: buildInput,
  Slider: buildSlider,
  Select: buildSelect,
  Checkbox: buildCheckbox,
  SegmentedControl: buildSegmentedControl,
  ChoiceCards: buildChoiceCards,
  RadioGroup: buildRadioGroup,
  Switch: buildSwitch,
  TextArea: buildTextArea,
  NumberStepper: buildNumberStepper,
  DatePicker: buildDatePicker,
  IconButton: buildIconButton,
  Pressable: buildPressable,
  Form: buildForm,
};
