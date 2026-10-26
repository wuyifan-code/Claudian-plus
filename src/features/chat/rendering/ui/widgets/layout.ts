import type { ResolvedElement } from '../evaluate';
import {
  appendChildren,
  appendIcon,
  applyColor,
  applyGap,
  type BuildContext,
  createBlock,
  readNumberValue,
  readString,
  readText,
  type WidgetBuilder,
} from './context';

const ROW_ALIGN: Record<string, string> = { start: 'is-align-start', center: 'is-align-center', end: 'is-align-end' };
const ROW_JUSTIFY: Record<string, string> = {
  between: 'is-justify-between',
  center: 'is-justify-center',
  end: 'is-justify-end',
};

function buildCol(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-col');
  applyGap(container, element.values[1]);
  appendChildren(container, element.values[0], ctx);
  return container;
}

function buildRow(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-row');
  applyGap(container, element.values[1]);
  const align = ROW_ALIGN[readString(element, 2) ?? ''];
  if (align !== undefined) container.classList.add(align);
  const justify = ROW_JUSTIFY[readString(element, 3) ?? ''];
  if (justify !== undefined) container.classList.add(justify);
  if (element.values[4] === true) container.classList.add('is-wrap');
  appendChildren(container, element.values[0], ctx);
  return container;
}

function buildBox(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-box');
  if (element.values[1] === 'row') container.classList.add('is-row');
  applyGap(container, element.values[2]);
  const padding = readNumberValue(element.values[3]);
  if (padding !== null) container.setCssProps({ padding: `${padding * 4}px` });
  applyColor(container, element.values[4], 'background');
  if (element.values[5] === true) container.classList.add('is-bordered');
  appendChildren(container, element.values[0], ctx);
  return container;
}

function buildGrid(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-grid');
  const columns = readNumberValue(element.values[1]);
  container.dataset.columns = String(Math.max(1, Math.min(4, Math.trunc(columns ?? 2))));
  applyGap(container, element.values[2]);
  appendChildren(container, element.values[0], ctx);
  return container;
}

/** Card(children, variant?, title?, subtitle?, icon?) — the header slot saves the model a Row. */
function buildCard(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-card');
  if (element.values[1] === 'soft') container.classList.add('is-soft');

  const title = readText(element, 2);
  const subtitle = readText(element, 3);
  if (title.length > 0 || subtitle.length > 0) {
    const header = container.createDiv({ cls: 'claudian-plus-ui-card-header' });
    appendIcon(header, element.values[4]);
    const heading = header.createDiv({ cls: 'claudian-plus-ui-card-heading' });
    if (title.length > 0) heading.createDiv({ cls: 'claudian-plus-ui-card-title', text: title });
    if (subtitle.length > 0) heading.createDiv({ cls: 'claudian-plus-ui-card-subtitle', text: subtitle });
  }

  appendChildren(container, element.values[0], ctx);
  return container;
}

export const LAYOUT_WIDGETS: Record<string, WidgetBuilder> = {
  Col: buildCol,
  Row: buildRow,
  Box: buildBox,
  Grid: buildGrid,
  Card: buildCard,
  Divider: () => createDiv({ cls: 'claudian-plus-ui claudian-plus-ui-divider' }),
  Spacer: () => createDiv({ cls: 'claudian-plus-ui claudian-plus-ui-spacer' }),
};
