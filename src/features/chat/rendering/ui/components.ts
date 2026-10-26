/**
 * Maps evaluated UI values onto Obsidian-native DOM.
 *
 * The builders themselves live in `widgets/` and are looked up by component
 * name. Two invariants stay load-bearing across every widget:
 *  - no model-supplied string is ever written through innerHTML;
 *  - colours are restricted to theme tokens or hex literals, so a program
 *    cannot smuggle `url()`, `var()` or a CSS expression into a style.
 */

import { type ResolvedElement, toDisplayText } from './evaluate';
import { UI_KIND_ATTR } from './reconcile';
import { WIDGETS } from './widgets';
import type { BuildContext } from './widgets/context';

export type { BuildContext, RenderContext } from './widgets/context';

/** Renders any evaluated value. Elements become DOM, everything else is text. */
export function renderValue(value: unknown, ctx: BuildContext): Node | null {
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

/** Builds one component node. Unknown components render nothing. */
export function buildElement(element: ResolvedElement, ctx: BuildContext): HTMLElement | null {
  const builder = WIDGETS[element.name];
  if (builder === undefined) return null;
  const node = builder(element, ctx);
  // The component name is what the reconciler matches slots on, so widgets stay
  // free of reconciliation concerns.
  if (node !== null) node.setAttribute(UI_KIND_ATTR, element.name);
  return node;
}
