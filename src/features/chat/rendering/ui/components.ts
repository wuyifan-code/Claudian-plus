/**
 * Maps evaluated UI values onto Obsidian-native DOM.
 *
 * Two invariants here are load-bearing and deliberately enforced in code:
 *  - no model-supplied string is ever written through innerHTML;
 *  - colours are restricted to theme tokens or hex literals, so a program
 *    cannot smuggle `url()`, `var()` or a CSS expression into a style.
 */

import {
  type EvaluationScope,
  readActionTarget,
  type ResolvedAction,
  type ResolvedElement,
  toDisplayText,
} from './evaluate';

export interface RenderContext {
  scope: EvaluationScope;
  setState(name: string, value: unknown): void;
  resetState(names: string[]): void;
  /** Host-level actions: continue the conversation, open a URL, copy text. */
  runAction(action: ResolvedAction): void;
  rerender(): void;
}

const COLOR_TOKENS: Record<string, string> = {
  ink: 'var(--claudian-plus-text-normal)',
  muted: 'var(--claudian-plus-text-muted)',
  faint: 'var(--claudian-plus-text-faint)',
  accent: 'var(--claudian-plus-text-accent)',
  surface: 'var(--claudian-plus-surface-secondary)',
  info: 'var(--color-blue)',
  success: 'var(--color-green)',
  warning: 'var(--color-orange)',
  danger: 'var(--color-red)',
  purple: 'var(--color-purple)',
  pink: 'var(--color-pink)',
  chart1: 'var(--color-blue)',
  chart2: 'var(--color-green)',
  chart3: 'var(--color-orange)',
  chart4: 'var(--color-purple)',
  chart5: 'var(--color-pink)',
  chart6: 'var(--color-cyan)',
};

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const UNSAFE_CSS = /url\(|var\(|expression\(|javascript:|[;}]/i;

/** Accepts a theme token or a plain hex colour; everything else is dropped. */
export function safeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const token = COLOR_TOKENS[trimmed];
  if (token !== undefined) return token;
  if (HEX_COLOR.test(trimmed)) return trimmed;
  if (UNSAFE_CSS.test(trimmed)) return null;
  return null;
}

function readText(element: ResolvedElement, index: number): string {
  return toDisplayText(element.values[index]);
}

function readString(element: ResolvedElement, index: number): string | null {
  const value = element.values[index];
  return typeof value === 'string' ? value : null;
}

function applyGap(element: HTMLElement, value: unknown): void {
  const gap = readNumberValue(value);
  if (gap !== null) element.style.gap = `${gap * 4}px`;
}

function readNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function applyColor(element: HTMLElement, value: unknown, property: 'color' | 'background'): void {
  const color = safeColor(value);
  if (color === null) return;
  if (property === 'color') element.style.color = color;
  else element.style.background = color;
}

/** Renders any evaluated value. Elements become DOM, everything else is text. */
export function renderValue(value: unknown, ctx: RenderContext): Node | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = toDisplayText(value);
    return text.length === 0 ? null : document.createTextNode(text);
  }

  if (Array.isArray(value)) {
    const fragment = createFragment();
    for (const item of value) {
      const node = renderValue(item, ctx);
      if (node !== null) fragment.appendChild(node);
    }
    return fragment.childNodes.length === 0 ? null : fragment;
  }

  if (typeof value === 'object') {
    const record = value as { type?: string };
    if (record.type === 'element') return buildElement(value as ResolvedElement, ctx);
    if (record.type === 'action') return null;
  }

  return null;
}

function appendChildren(container: HTMLElement, value: unknown, ctx: RenderContext): void {
  const node = renderValue(value, ctx);
  if (node !== null) container.appendChild(node);
}

function createColumn(className: string): HTMLElement {
  return createDiv({ cls: `claudian-plus-ui ${className}` });
}

function buildLayout(element: ResolvedElement, ctx: RenderContext): HTMLElement {
  switch (element.name) {
    case 'Col': {
      const container = createColumn('claudian-plus-ui-col');
      applyGap(container, element.values[1]);
      appendChildren(container, element.values[0], ctx);
      return container;
    }
    case 'Row': {
      const container = createColumn('claudian-plus-ui-row');
      applyGap(container, element.values[1]);
      const justify = readString(element, 3);
      if (justify === 'between') container.style.justifyContent = 'space-between';
      else if (justify === 'center') container.style.justifyContent = 'center';
      else if (justify === 'end') container.style.justifyContent = 'flex-end';
      if (element.values[4] === true) container.style.flexWrap = 'wrap';
      appendChildren(container, element.values[0], ctx);
      return container;
    }
    case 'Box': {
      const container = createColumn('claudian-plus-ui-box');
      if (element.values[1] === 'row') container.style.flexDirection = 'row';
      applyGap(container, element.values[2]);
      const padding = readNumberValue(element.values[3]);
      if (padding !== null) container.style.padding = `${padding * 4}px`;
      applyColor(container, element.values[4], 'background');
      if (element.values[6] === true) container.style.border = '1px solid var(--claudian-plus-border)';
      appendChildren(container, element.values[0], ctx);
      return container;
    }
    case 'Grid': {
      const container = createColumn('claudian-plus-ui-grid');
      const columns = readNumberValue(element.values[1]);
      container.style.display = 'grid';
      container.style.gridTemplateColumns = `repeat(${Math.max(1, Math.trunc(columns ?? 2))}, minmax(0, 1fr))`;
      applyGap(container, element.values[3]);
      appendChildren(container, element.values[0], ctx);
      return container;
    }
    case 'Card': {
      const container = createColumn('claudian-plus-ui-card');
      if (element.values[1] === 'soft') container.classList.add('is-soft');
      appendChildren(container, element.values[0], ctx);
      return container;
    }
    case 'Divider': {
      return createDiv({ cls: 'claudian-plus-ui claudian-plus-ui-divider' });
    }
    case 'Spacer': {
      const spacer = createDiv({ cls: 'claudian-plus-ui claudian-plus-ui-spacer' });
      spacer.style.flex = '1 1 0';
      return spacer;
    }
    default:
      return createColumn('claudian-plus-ui-col');
  }
}

function buildText(element: ResolvedElement, ctx: RenderContext): HTMLElement {
  switch (element.name) {
    case 'Title': {
      const container = createColumn('claudian-plus-ui-title');
      container.dataset.size = readString(element, 1) ?? 'lg';
      container.textContent = readText(element, 0);
      applyColor(container, element.values[2], 'color');
      return container;
    }
    case 'Text': {
      const container = createColumn('claudian-plus-ui-text');
      container.dataset.size = readString(element, 1) ?? 'md';
      const weight = readString(element, 3);
      if (weight !== null) container.style.fontWeight = weight === 'semibold' ? '600' : weight === 'medium' ? '500' : '400';
      if (element.values[4] === true) container.style.fontStyle = 'italic';
      appendChildren(container, element.values[0], ctx);
      applyColor(container, element.values[2], 'color');
      return container;
    }
    case 'Caption': {
      const container = createColumn('claudian-plus-ui-caption');
      container.textContent = readText(element, 0);
      applyColor(container, element.values[1], 'color');
      return container;
    }
    case 'Badge': {
      const container = createSpan({ cls: 'claudian-plus-ui-badge' });
      container.textContent = readText(element, 0);
      applyColor(container, element.values[1], 'color');
      return container;
    }
    case 'Code': {
      const container = createColumn('claudian-plus-ui-code');
      const pre = createEl('pre');
      const code = createEl('code');
      code.textContent = readText(element, 0);
      const language = readString(element, 1);
      if (language !== null) code.dataset.language = language;
      pre.appendChild(code);
      container.appendChild(pre);
      return container;
    }
    case 'Quote': {
      const container = createColumn('claudian-plus-ui-quote');
      container.textContent = readText(element, 0);
      const cite = readString(element, 1);
      if (cite !== null) container.createEl('cite', { text: cite });
      return container;
    }
    case 'List': {
      const container = createColumn('claudian-plus-ui-list');
      container.dataset.marker = readString(element, 1) ?? 'bullet';
      appendChildren(container, element.values[0], ctx);
      return container;
    }
    case 'ListItem': {
      const container = createColumn('claudian-plus-ui-list-item');
      const title = createDiv({ cls: 'claudian-plus-ui-list-title', text: readText(element, 0) });
      container.appendChild(title);
      const description = readText(element, 1);
      if (description.length > 0) {
        container.appendChild(createDiv({ cls: 'claudian-plus-ui-list-desc', text: description }));
      }
      appendChildren(container, element.values[3], ctx);
      return container;
    }
    default: {
      const container = createColumn('claudian-plus-ui-text');
      container.textContent = readText(element, 0);
      return container;
    }
  }
}

function buildTable(element: ResolvedElement, ctx: RenderContext): HTMLElement {
  const container = createColumn('claudian-plus-ui-table-wrap');
  const table = createEl('table', { cls: 'claudian-plus-ui-table' });
  const columns = Array.isArray(element.values[0]) ? element.values[0] : [];

  const headRow = createEl('tr');
  for (const column of columns) {
    headRow.appendChild(createEl('th', { text: toDisplayText(column) }));
  }
  const thead = createEl('thead');
  thead.appendChild(headRow);
  table.appendChild(thead);

  const rows = Array.isArray(element.values[1]) ? element.values[1] : [];
  const tbody = createEl('tbody');
  for (const row of rows) {
    const rowEl = createEl('tr');
    const cells = Array.isArray(row) ? row : [row];
    for (const cell of cells) {
      const cellEl = createEl('td');
      const node = renderValue(cell, ctx);
      if (node !== null) cellEl.appendChild(node);
      rowEl.appendChild(cellEl);
    }
    tbody.appendChild(rowEl);
  }
  table.appendChild(tbody);
  container.appendChild(table);
  return container;
}

function dispatchAction(action: unknown, ctx: RenderContext, targetName: string | null): void {
  if (action === null || typeof action !== 'object') return;
  const resolved = action as ResolvedAction;
  if (resolved.type !== 'action') return;

  switch (resolved.name) {
    case '@Set':
      if (targetName !== null) ctx.setState(targetName, resolved.values[1]);
      ctx.rerender();
      return;
    case '@Reset':
      if (targetName !== null) ctx.resetState([targetName]);
      ctx.rerender();
      return;
    default:
      ctx.runAction(resolved);
  }
}

function buildButton(element: ResolvedElement, ctx: RenderContext): HTMLElement {
  const button = createEl('button', { cls: 'claudian-plus-ui-button' });
  button.textContent = readText(element, 0);
  const variant = readString(element, 2);
  button.dataset.variant = variant ?? 'solid';
  if (element.values[7] === true) {
    button.setAttribute('disabled', 'disabled');
  }
  if (element.values[8] === true) button.style.width = '100%';
  const action = element.values[1];
  const targetName = readActionTarget(element.args[1]);
  button.addEventListener('click', () => dispatchAction(action, ctx, targetName));
  return button;
}

function readBoundTarget(element: ResolvedElement, ctx: RenderContext): { name: string; value: unknown } | null {
  const target = element.args[0];
  if (target === undefined || target.kind !== 'state') return null;
  return { name: target.name, value: element.values[0] };
}

function buildInput(element: ResolvedElement, ctx: RenderContext): HTMLElement {
  const container = createColumn('claudian-plus-ui-field');
  const label = readString(element, 1);
  if (label !== null) container.appendChild(createEl('label', { text: label }));

  const binding = readBoundTarget(element, ctx);
  const input = createEl('input', { cls: 'claudian-plus-ui-input' });
  const type = readString(element, 2);
  input.type = type === 'number' ? 'number' : 'text';
  const placeholder = readString(element, 3);
  if (placeholder !== null) input.placeholder = placeholder;
  input.value = toDisplayText(binding?.value ?? '');

  input.addEventListener('input', () => {
    if (binding === null) return;
    ctx.setState(binding.name, input.type === 'number' ? Number(input.value) : input.value);
  });

  container.appendChild(input);
  return container;
}

function buildSegmentedControl(element: ResolvedElement, ctx: RenderContext): HTMLElement {
  const container = createColumn('claudian-plus-ui-segmented');
  const binding = readBoundTarget(element, ctx);
  const options = Array.isArray(element.values[1]) ? element.values[1] : [];
  const current = toDisplayText(binding?.value ?? '');

  for (const option of options) {
    const value = toDisplayText(option);
    const button = createEl('button', { cls: 'claudian-plus-ui-segment', text: value });
    if (value === current) button.classList.add('is-active');
    button.addEventListener('click', () => {
      if (binding === null) return;
      ctx.setState(binding.name, value);
      ctx.rerender();
    });
    container.appendChild(button);
  }

  return container;
}

/** Builds one component node. Unknown components render nothing. */
export function buildElement(element: ResolvedElement, ctx: RenderContext): HTMLElement | null {
  switch (element.name) {
    case 'Col':
    case 'Row':
    case 'Box':
    case 'Grid':
    case 'Card':
    case 'Divider':
    case 'Spacer':
      return buildLayout(element, ctx);
    case 'Table':
      return buildTable(element, ctx);
    case 'Button':
      return buildButton(element, ctx);
    case 'Input':
      return buildInput(element, ctx);
    case 'SegmentedControl':
      return buildSegmentedControl(element, ctx);
    case 'Title':
    case 'Text':
    case 'Caption':
    case 'Badge':
    case 'Code':
    case 'Quote':
    case 'List':
    case 'ListItem':
      return buildText(element, ctx);
    default:
      return null;
  }
}
