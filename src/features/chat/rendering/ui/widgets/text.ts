import type { ResolvedElement } from '../evaluate';
import {
  appendChildren,
  appendIcon,
  applyColor,
  type BuildContext,
  createBlock,
  readNumberValue,
  readString,
  readText,
  type WidgetBuilder,
} from './context';

const SAFE_URL = /^https?:\/\//i;

function buildTitle(element: ResolvedElement): HTMLElement {
  const container = createBlock('claudian-plus-ui-title');
  container.dataset.size = readString(element, 1) ?? 'lg';
  container.textContent = readText(element, 0);
  applyColor(container, element.values[2], 'color');
  return container;
}

function buildTextBlock(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-text');
  container.dataset.size = readString(element, 1) ?? 'md';
  const weight = readString(element, 3);
  if (weight === 'semibold') container.classList.add('is-weight-semibold');
  else if (weight === 'medium') container.classList.add('is-weight-medium');
  if (element.values[4] === true) container.classList.add('is-italic');
  appendChildren(container, element.values[0], ctx);
  applyColor(container, element.values[2], 'color');
  return container;
}

function buildCaption(element: ResolvedElement): HTMLElement {
  const container = createBlock('claudian-plus-ui-caption');
  container.textContent = readText(element, 0);
  applyColor(container, element.values[1], 'color');
  return container;
}

function buildBadge(element: ResolvedElement): HTMLElement {
  const container = createSpan({ cls: 'claudian-plus-ui-badge' });
  container.textContent = readText(element, 0);
  applyColor(container, element.values[1], 'color');
  return container;
}

function buildCode(element: ResolvedElement): HTMLElement {
  const container = createBlock('claudian-plus-ui-code');
  const pre = createEl('pre');
  const code = createEl('code');
  code.textContent = readText(element, 0);
  const language = readString(element, 1);
  if (language !== null) code.dataset.language = language;
  pre.appendChild(code);
  container.appendChild(pre);
  return container;
}

function buildQuote(element: ResolvedElement): HTMLElement {
  const container = createBlock('claudian-plus-ui-quote');
  container.textContent = readText(element, 0);
  const cite = readString(element, 1);
  if (cite !== null) container.createEl('cite', { text: cite });
  return container;
}

function buildList(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-list');
  container.dataset.marker = readString(element, 1) ?? 'bullet';
  appendChildren(container, element.values[0], ctx);
  return container;
}

function buildListItem(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-list-item');
  container.appendChild(createDiv({ cls: 'claudian-plus-ui-list-title', text: readText(element, 0) }));
  const description = readText(element, 1);
  if (description.length > 0) {
    container.appendChild(createDiv({ cls: 'claudian-plus-ui-list-desc', text: description }));
  }
  appendChildren(container, element.values[2], ctx);
  return container;
}

/** No `href` is set: navigation goes through the host's http(s) allow-list only. */
function buildLink(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const text = readText(element, 0);
  const url = readString(element, 1);
  if (url === null || !SAFE_URL.test(url)) {
    return createSpan({ cls: 'claudian-plus-ui-link is-disabled', text });
  }
  const link = createEl('a', { cls: 'claudian-plus-ui-link', text: text.length > 0 ? text : url });
  link.setAttribute('role', 'link');
  link.setAttribute('tabindex', '0');
  link.setAttribute('title', url);
  const open = (): void => ctx.runAction({ type: 'action', name: '@OpenUrl', values: [url] });
  ctx.on(link, 'click', open);
  ctx.on(link, 'keydown', (event) => {
    if (event.key === 'Enter') open();
  });
  return link;
}

function buildIcon(element: ResolvedElement): HTMLElement | null {
  const wrapper = createSpan({ cls: 'claudian-plus-ui-icon-wrap' });
  const icon = appendIcon(wrapper, element.values[0]);
  if (icon === null) return null;
  const size = readString(element, 1);
  if (size === 'sm' || size === 'lg' || size === 'xl') wrapper.dataset.size = size;
  applyColor(wrapper, element.values[2], 'color');
  return wrapper;
}

function renderMarkdownInto(container: HTMLElement, markdown: string, ctx: BuildContext): void {
  if (ctx.host?.renderMarkdown !== undefined) {
    ctx.host.renderMarkdown(container, markdown);
    return;
  }
  container.classList.add('is-plain');
  container.textContent = markdown;
}

/** Markdown inside a widget, through the same sanitising pipeline as normal answers. */
function buildMarkdown(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-markdown');
  renderMarkdownInto(container, readText(element, 0), ctx);
  return container;
}

function buildMath(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const tex = readText(element, 0).trim();
  const block = element.values[1] === true;
  const container = block
    ? createBlock('claudian-plus-ui-math is-block')
    : createSpan({ cls: 'claudian-plus-ui-math' });
  renderMarkdownInto(container, block ? `$$\n${tex}\n$$` : `$${tex}$`, ctx);
  return container;
}

/** Progress(value, max?, label?, variant? "bar"|"ring") */
function buildProgress(element: ResolvedElement): HTMLElement {
  const value = readNumberValue(element.values[0]) ?? 0;
  const max = readNumberValue(element.values[1]) ?? 100;
  const ratio = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  const percent = Math.round(ratio * 100);
  const label = readText(element, 2);
  const ring = element.values[3] === 'ring';

  const container = createBlock(`claudian-plus-ui-progress${ring ? ' is-ring' : ''}`);
  container.setAttribute('role', 'progressbar');
  container.setAttribute('aria-valuenow', String(percent));
  container.setAttribute('aria-valuemin', '0');
  container.setAttribute('aria-valuemax', '100');
  if (label.length > 0) container.setAttribute('aria-label', label);

  if (ring) {
    const dial = container.createDiv({ cls: 'claudian-plus-ui-progress-ring' });
    dial.setCssProps({ '--ui-progress': `${percent}%` });
    dial.createSpan({ cls: 'claudian-plus-ui-progress-value', text: `${percent}%` });
    if (label.length > 0) container.createDiv({ cls: 'claudian-plus-ui-progress-label', text: label });
    return container;
  }

  const head = container.createDiv({ cls: 'claudian-plus-ui-progress-head' });
  head.createSpan({ cls: 'claudian-plus-ui-progress-label', text: label });
  head.createSpan({ cls: 'claudian-plus-ui-progress-value', text: `${percent}%` });
  const track = container.createDiv({ cls: 'claudian-plus-ui-progress-track' });
  track.createDiv({ cls: 'claudian-plus-ui-progress-fill' }).setCssProps({ width: `${percent}%` });
  return container;
}

export const TEXT_WIDGETS: Record<string, WidgetBuilder> = {
  Title: buildTitle,
  Text: buildTextBlock,
  Caption: buildCaption,
  Badge: buildBadge,
  Code: buildCode,
  Quote: buildQuote,
  List: buildList,
  ListItem: buildListItem,
  Link: buildLink,
  Icon: buildIcon,
  Markdown: buildMarkdown,
  Math: buildMath,
  Progress: buildProgress,
};
