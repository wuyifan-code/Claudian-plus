import { type ResolvedElement, toDisplayText } from '../evaluate';
import {
  appendChildren,
  type BuildContext,
  createBlock,
  createButton,
  readList,
  readLocalState,
  readNumberValue,
  readRecord,
  readText,
  readTone,
  type WidgetBuilder,
} from './context';

function readIndex(value: unknown): number | null {
  const parsed = readNumberValue(value);
  return parsed === null ? null : Math.trunc(parsed);
}

interface TabItem {
  label: string;
  content: unknown;
}

function readTabItems(value: unknown): TabItem[] {
  return readList(value).map((item, index) => {
    const record = readRecord(item);
    if (record === null) return { label: toDisplayText(item), content: item };
    const label = typeof record.label === 'string' ? record.label : `Tab ${String(index + 1)}`;
    return { label, content: record.content ?? null };
  });
}

/** Tabs($active, tabs) — every panel is rendered; only the selected one is shown. */
function buildTabs(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const tabs = readTabItems(element.values[1]);
  const container = createBlock('claudian-plus-ui-tabs');
  if (tabs.length === 0) return container;

  const binding = readLocalState(element, ctx, 0, 'tabs');
  const raw = binding?.value;
  let active = typeof raw === 'number'
    ? Math.trunc(raw)
    : typeof raw === 'string'
      ? tabs.findIndex((tab) => tab.label === raw)
      : 0;
  if (!Number.isFinite(active) || active < 0 || active >= tabs.length) active = 0;

  const bar = container.createDiv({ cls: 'claudian-plus-ui-tab-bar' });
  bar.setAttribute('role', 'tablist');
  const panelsEl = container.createDiv({ cls: 'claudian-plus-ui-tab-panels' });
  const buttons: HTMLButtonElement[] = [];
  const panels: HTMLElement[] = [];

  const apply = (next: number): void => {
    buttons.forEach((button, index) => {
      const selected = index === next;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel, index) => {
      panel.toggleAttribute('hidden', index !== next);
    });
  };

  const select = (next: number): void => {
    const clamped = Math.max(0, Math.min(tabs.length - 1, next));
    apply(clamped);
    if (binding !== null) ctx.setState(binding.name, clamped);
  };

  tabs.forEach((tab, index) => {
    const button = createButton('claudian-plus-ui-tab', tab.label);
    button.setAttribute('role', 'tab');
    ctx.on(button, 'click', () => select(index));
    ctx.on(button, 'keydown', (event) => {
      let next: number | null = null;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      select(next);
      buttons[next]?.focus();
    });
    bar.appendChild(button);
    buttons.push(button);

    const panel = createDiv({ cls: 'claudian-plus-ui-tab-panel' });
    panel.setAttribute('role', 'tabpanel');
    const node = ctx.render(tab.content);
    if (node !== null) panel.appendChild(node);
    panelsEl.appendChild(panel);
    panels.push(panel);
  });

  apply(active);
  return container;
}

interface AccordionItem {
  title: string;
  content: unknown;
}

function readAccordionItems(value: unknown): AccordionItem[] {
  return readList(value).map((item, index) => {
    const record = readRecord(item);
    if (record === null) return { title: toDisplayText(item), content: item };
    return {
      title: typeof record.title === 'string' ? record.title : `Item ${String(index + 1)}`,
      content: record.content ?? null,
    };
  });
}

function readOpenIndices(value: unknown, multiple: boolean): Set<number> {
  const open = new Set<number>();
  if (multiple) {
    for (const item of readList(value)) {
      const index = readIndex(item);
      if (index !== null) open.add(index);
    }
    return open;
  }
  const index = readIndex(value);
  if (index !== null && index >= 0) open.add(index);
  return open;
}

/** Accordion(items, $open?, multiple?) — controlled when open state is written. */
function buildAccordion(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const items = readAccordionItems(element.values[0]);
  const container = createBlock('claudian-plus-ui-accordion');
  const multiple = element.values[2] === true;
  const binding = readLocalState(element, ctx, 1, 'accordion');
  const open = readOpenIndices(binding?.value, multiple);

  const headers: HTMLButtonElement[] = [];
  const bodies: HTMLElement[] = [];

  const apply = (next: Set<number>): void => {
    headers.forEach((header, index) => {
      const expanded = next.has(index);
      header.classList.toggle('is-open', expanded);
      header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
    bodies.forEach((body, index) => {
      body.toggleAttribute('hidden', !next.has(index));
    });
  };

  const toggle = (index: number): void => {
    const next = new Set(open);
    if (next.has(index)) {
      next.delete(index);
    } else {
      if (!multiple) next.clear();
      next.add(index);
    }
    apply(next);
    if (binding === null) return;
    if (multiple) {
      ctx.setState(binding.name, [...next].sort((a, b) => a - b));
    } else {
      ctx.setState(binding.name, next.has(index) ? index : -1);
    }
  };

  items.forEach((item, index) => {
    const wrapper = createDiv({ cls: 'claudian-plus-ui-accordion-item' });
    const header = createButton('claudian-plus-ui-accordion-header', item.title);
    header.setAttribute('aria-expanded', open.has(index) ? 'true' : 'false');
    if (open.has(index)) header.classList.add('is-open');
    ctx.on(header, 'click', () => toggle(index));
    wrapper.appendChild(header);

    const body = createDiv({ cls: 'claudian-plus-ui-accordion-body' });
    if (!open.has(index)) body.setAttribute('hidden', 'hidden');
    const node = ctx.render(item.content);
    if (node !== null) body.appendChild(node);
    wrapper.appendChild(body);

    headers.push(header);
    bodies.push(body);
    container.appendChild(wrapper);
  });

  return container;
}

interface StepItem {
  title: string;
  description: string;
}

function readSteps(value: unknown): StepItem[] {
  return readList(value).map((item, index) => {
    const record = readRecord(item);
    if (record === null) return { title: toDisplayText(item), description: '' };
    return {
      title: typeof record.title === 'string' ? record.title : `Step ${String(index + 1)}`,
      description: toDisplayText(record.description ?? ''),
    };
  });
}

/** Steps(items, $current?) — clicking a step writes its index so siblings can react. */
function buildSteps(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const steps = readSteps(element.values[0]);
  const container = createBlock('claudian-plus-ui-steps');
  const binding = readLocalState(element, ctx, 1, 'steps');
  const parsed = readIndex(binding?.value);
  const current = parsed !== null && parsed >= 0 && parsed < steps.length ? parsed : 0;

  steps.forEach((step, index) => {
    const button = createButton('claudian-plus-ui-step');
    const done = index < current;
    const active = index === current;
    if (done) button.classList.add('is-done');
    if (active) button.classList.add('is-active');
    if (active) button.setAttribute('aria-current', 'step');

    const badge = createSpan({
      cls: 'claudian-plus-ui-step-badge',
      text: done ? '✓' : String(index + 1),
    });
    button.appendChild(badge);

    const body = createDiv({ cls: 'claudian-plus-ui-step-body' });
    body.appendChild(createDiv({ cls: 'claudian-plus-ui-step-title', text: step.title }));
    if (step.description.length > 0) {
      body.appendChild(createDiv({ cls: 'claudian-plus-ui-step-desc', text: step.description }));
    }
    button.appendChild(body);

    ctx.on(button, 'click', () => {
      if (binding !== null) ctx.setState(binding.name, index);
    });
    container.appendChild(button);
  });

  return container;
}

interface TimelineItem {
  time: string;
  title: string;
  description: string;
  tone: string;
}

function readTimelineItems(value: unknown): TimelineItem[] {
  return readList(value).map((item, index) => {
    const record = readRecord(item);
    if (record === null) {
      return { time: '', title: toDisplayText(item), description: '', tone: 'neutral' };
    }
    return {
      time: toDisplayText(record.time ?? ''),
      title: typeof record.title === 'string' ? record.title : `Event ${String(index + 1)}`,
      description: toDisplayText(record.description ?? ''),
      tone: readTone(record.tone),
    };
  });
}

function buildTimeline(element: ResolvedElement): HTMLElement {
  const container = createBlock('claudian-plus-ui-timeline');
  for (const item of readTimelineItems(element.values[0])) {
    const row = createDiv({ cls: 'claudian-plus-ui-timeline-item' });
    row.dataset.tone = item.tone;
    // The grid tracks follow this flag, not the number of cells emitted: a row
    // with no time must not shift the rail into the auto-sized time track.
    row.dataset.hasTime = item.time.length > 0 ? 'true' : 'false';
    if (item.time.length > 0) {
      row.appendChild(createDiv({ cls: 'claudian-plus-ui-timeline-time', text: item.time }));
    }
    // The connector lives on a rail that stretches with the row, so it stays
    // continuous no matter how many lines the description wraps to.
    const rail = createDiv({ cls: 'claudian-plus-ui-timeline-rail' });
    rail.appendChild(createDiv({ cls: 'claudian-plus-ui-timeline-dot' }));
    rail.appendChild(createDiv({ cls: 'claudian-plus-ui-timeline-line' }));
    row.appendChild(rail);
    const body = createDiv({ cls: 'claudian-plus-ui-timeline-body' });
    body.appendChild(createDiv({ cls: 'claudian-plus-ui-timeline-title', text: item.title }));
    if (item.description.length > 0) {
      body.appendChild(createDiv({ cls: 'claudian-plus-ui-timeline-desc', text: item.description }));
    }
    row.appendChild(body);
    container.appendChild(row);
  }
  return container;
}

function buildCallout(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-callout');
  container.dataset.tone = readTone(element.values[1], 'info');
  const title = readText(element, 2);
  if (title.length > 0) {
    container.appendChild(createDiv({ cls: 'claudian-plus-ui-callout-title', text: title }));
  }
  appendChildren(container, element.values[0], ctx);
  return container;
}

function buildStat(element: ResolvedElement): HTMLElement {
  const container = createBlock('claudian-plus-ui-stat');
  container.appendChild(createDiv({ cls: 'claudian-plus-ui-stat-label', text: readText(element, 0) }));
  container.appendChild(createDiv({ cls: 'claudian-plus-ui-stat-value', text: readText(element, 1) }));

  const delta = element.values[2];
  if (typeof delta === 'number' && Number.isFinite(delta)) {
    const direction = delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : 'is-flat';
    const sign = delta > 0 ? '+' : '';
    container.appendChild(createSpan({
      cls: `claudian-plus-ui-stat-delta ${direction}`,
      text: `${sign}${String(delta)}`,
    }));
  } else {
    const text = readText(element, 2);
    if (text.length > 0) {
      container.appendChild(createSpan({ cls: 'claudian-plus-ui-stat-delta is-text', text }));
    }
  }

  const caption = readText(element, 3);
  if (caption.length > 0) {
    container.appendChild(createDiv({ cls: 'claudian-plus-ui-stat-caption', text: caption }));
  }
  return container;
}

/** Reveal(label, children) — click-to-reveal spoiler without a model turn. */
function buildReveal(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-reveal');
  const binding = readLocalState(element, ctx, null, 'reveal');
  const open = binding?.value === true;

  const button = createButton('claudian-plus-ui-reveal-toggle', readText(element, 0));
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) button.classList.add('is-open');

  const body = createDiv({ cls: 'claudian-plus-ui-reveal-body' });
  if (!open) body.setAttribute('hidden', 'hidden');
  appendChildren(body, element.values[1], ctx);

  ctx.on(button, 'click', () => {
    const next = body.hasAttribute('hidden');
    body.toggleAttribute('hidden', !next);
    button.classList.toggle('is-open', next);
    button.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (binding !== null) ctx.setState(binding.name, next);
  });

  container.appendChild(button);
  container.appendChild(body);
  return container;
}

export const STRUCTURE_WIDGETS: Record<string, WidgetBuilder> = {
  Tabs: buildTabs,
  Accordion: buildAccordion,
  Steps: buildSteps,
  Timeline: buildTimeline,
  Callout: buildCallout,
  Stat: buildStat,
  Reveal: buildReveal,
};
