/**
 * In-place adoption for generated-UI trees.
 *
 * Rebuilding the whole subtree on every frame restarts every CSS transition,
 * so a re-render adopts the previous DOM instead: a node that still occupies
 * the same structural slot is patched where it stands and only the slots whose
 * widget changed are built again.
 *
 * Invariants:
 *  - adoption requires `data-ui-key`, `tagName` and `data-ui-kind` to be equal AND
 *    the incoming node to hold no listener of its own (`data-ui-interactive="host"`);
 *    a listener-holding node is always rebuilt, so a stale closure can never be
 *    reused. An ancestor of such a node is only marked `"subtree"` and is still
 *    adopted: its interactive descendants are rebuilt on the way down.
 *  - the incoming node owns the slot's attributes: class, aria, other data-*
 *    attributes and the whole inline style are copied from it, and attributes
 *    it no longer sets are removed. The three mechanism attributes are the
 *    exception (key and kind are immutable, interactivity follows the new tree).
 *  - text is always written with `nodeValue`/`textContent`, never with innerHTML;
 *  - removed slots disappear, new slots are inserted, adopted slots keep their
 *    DOM identity and therefore their running transition.
 */

/** Component name of the widget that produced the node; keys are built from it. */
export const UI_KIND_ATTR = 'data-ui-kind';
/** Structural path of the node, e.g. `r/Col#0/Row#1/Progress#0`. */
export const UI_KEY_ATTR = 'data-ui-key';
/** Set on a node that registered listeners, and on every one of its ancestors. */
export const UI_INTERACTIVE_ATTR = 'data-ui-interactive';

/** The node holds at least one registered listener. */
export const UI_INTERACTIVE_HOST = 'host';
/** The node has a listener-holding descendant. */
export const UI_INTERACTIVE_SUBTREE = 'subtree';

const MECHANISM_ATTRS = new Set([UI_KIND_ATTR, UI_KEY_ATTR, UI_INTERACTIVE_ATTR]);

/** Key of the tree root; children hang off it. */
const ROOT_KEY = 'r';

// nodeType numbers instead of `instanceof`: the tree may come from a popout
// window, where the constructor identity differs.
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function kindOf(element: Element): string {
  return element.getAttribute(UI_KIND_ATTR) ?? element.tagName.toLowerCase();
}

/** Marks a node whose listeners live on the node itself: it is never adopted. */
export function markUiInteractive(element: HTMLElement): void {
  element.setAttribute(UI_INTERACTIVE_ATTR, UI_INTERACTIVE_HOST);
}

/**
 * Assigns structural keys and propagates interactivity in one pass over the
 * finished tree. Keys flow down from the root; the interactive mark flows back
 * up, so a widget that binds a listener before it is attached to its parent is
 * still seen by every ancestor.
 */
export function annotateUiTree(root: HTMLElement): void {
  annotateElement(root, ROOT_KEY);
}

function annotateElement(element: Element, key: string): boolean {
  const isHost = element.getAttribute(UI_INTERACTIVE_ATTR) === UI_INTERACTIVE_HOST;
  if (!isHost) element.removeAttribute(UI_INTERACTIVE_ATTR);
  element.setAttribute(UI_KEY_ATTR, key);

  let hasInteractiveChild = false;
  const counters = new Map<string, number>();
  for (const child of Array.from(element.children)) {
    const kind = kindOf(child);
    const index = counters.get(kind) ?? 0;
    counters.set(kind, index + 1);
    if (annotateElement(child, `${key}/${kind}#${String(index)}`)) hasInteractiveChild = true;
  }

  if (isHost) return true;
  if (hasInteractiveChild) {
    element.setAttribute(UI_INTERACTIVE_ATTR, UI_INTERACTIVE_SUBTREE);
    return true;
  }
  return false;
}

/** Whether `previous` can stand in for `next` without rebuilding it. */
export function canAdopt(previous: Element, next: Element): boolean {
  if (next.getAttribute(UI_INTERACTIVE_ATTR) === UI_INTERACTIVE_HOST) return false;
  if (previous.tagName !== next.tagName) return false;
  const previousKey = previous.getAttribute(UI_KEY_ATTR);
  if (previousKey === null || previousKey !== next.getAttribute(UI_KEY_ATTR)) return false;
  return previous.getAttribute(UI_KIND_ATTR) === next.getAttribute(UI_KIND_ATTR);
}

/**
 * Patches `previous` until it matches `next` and then reconciles their
 * children. Callers must have checked `canAdopt` first.
 */
export function adoptUiElement(previous: Element, next: Element): void {
  adoptAttributes(previous, next);
  adoptChildren(previous, next);
}

function adoptAttributes(previous: Element, next: Element): void {
  for (const attribute of Array.from(previous.attributes)) {
    if (MECHANISM_ATTRS.has(attribute.name) || attribute.name === 'style') continue;
    if (!next.hasAttribute(attribute.name)) previous.removeAttribute(attribute.name);
  }
  for (const attribute of Array.from(next.attributes)) {
    if (MECHANISM_ATTRS.has(attribute.name) || attribute.name === 'style') continue;
    if (previous.getAttribute(attribute.name) === attribute.value) continue;
    previous.setAttribute(attribute.name, attribute.value);
  }

  // Inline style is one attribute in the DOM but a live object on the element,
  // so a property the new tree dropped only disappears through cssText.
  const previousStyle = inlineStyleOf(previous);
  const nextStyle = inlineStyleOf(next);
  if (previousStyle !== null && nextStyle !== null) {
    if (previousStyle.cssText !== nextStyle.cssText) previousStyle.cssText = nextStyle.cssText;
  } else {
    const style = next.getAttribute('style');
    if (style === null) previous.removeAttribute('style');
    else previous.setAttribute('style', style);
  }

  const interactive = next.getAttribute(UI_INTERACTIVE_ATTR);
  if (interactive === null) previous.removeAttribute(UI_INTERACTIVE_ATTR);
  else previous.setAttribute(UI_INTERACTIVE_ATTR, interactive);
}

function inlineStyleOf(element: Element): CSSStyleDeclaration | null {
  return (element as Partial<HTMLElement>).style ?? null;
}

function adoptChildren(previous: Element, next: Element): void {
  const previousNodes = Array.from(previous.childNodes);
  const byKey = new Map<string, Element>();
  for (const node of previousNodes) {
    if (node.nodeType !== ELEMENT_NODE) continue;
    const element = node as Element;
    const key = element.getAttribute(UI_KEY_ATTR);
    if (key === null || byKey.has(key)) continue;
    byKey.set(key, element);
  }

  const desired: Node[] = [];
  let textIndex = 0;
  for (const nextChild of Array.from(next.childNodes)) {
    if (nextChild.nodeType === TEXT_NODE) {
      // Text carries no identity worth keeping; reusing the slot only avoids
      // detaching a leaf for no reason.
      const reusable = previousNodes[textIndex];
      textIndex += 1;
      if (reusable !== undefined && reusable.nodeType === TEXT_NODE) {
        if (reusable.nodeValue !== nextChild.nodeValue) reusable.nodeValue = nextChild.nodeValue;
        desired.push(reusable);
        continue;
      }
      desired.push(nextChild);
      continue;
    }
    if (nextChild.nodeType !== ELEMENT_NODE) continue;
    const element = nextChild as Element;

    const key = element.getAttribute(UI_KEY_ATTR);
    const candidate = key === null ? undefined : byKey.get(key);
    if (candidate !== undefined && candidate.parentNode === previous && canAdopt(candidate, element)) {
      byKey.delete(key ?? '');
      desired.push(candidate);
      adoptUiElement(candidate, element);
      continue;
    }
    desired.push(element);
  }

  placeChildren(previous, desired);
}

/** Moves `desired` into order, touching only the nodes that are out of place. */
function placeChildren(parent: Element, desired: readonly Node[]): void {
  desired.forEach((node, index) => {
    const atIndex = parent.childNodes[index] ?? null;
    if (atIndex === node) return;
    parent.insertBefore(node, atIndex);
  });
  while (parent.childNodes.length > desired.length) parent.lastChild?.remove();
}

/** Scroll offsets of every scrollable node, keyed by structural path. */
export interface ScrollSnapshot {
  top: number;
  left: number;
  nodes: { key: string; top: number; left: number }[];
}

export function captureScrollOffsets(container: HTMLElement): ScrollSnapshot {
  const nodes: ScrollSnapshot['nodes'] = [];
  for (const element of Array.from(container.querySelectorAll<HTMLElement>(`[${UI_KEY_ATTR}]`))) {
    if (element.scrollTop === 0 && element.scrollLeft === 0) continue;
    const key = element.getAttribute(UI_KEY_ATTR);
    if (key === null) continue;
    nodes.push({ key, top: element.scrollTop, left: element.scrollLeft });
  }
  return { top: container.scrollTop, left: container.scrollLeft, nodes };
}

/** Restores what `captureScrollOffsets` saw; replaced nodes match by key. */
export function restoreScrollOffsets(container: HTMLElement, snapshot: ScrollSnapshot): void {
  container.scrollTop = snapshot.top;
  container.scrollLeft = snapshot.left;
  if (snapshot.nodes.length === 0) return;

  const byKey = new Map<string, HTMLElement>();
  for (const element of Array.from(container.querySelectorAll<HTMLElement>(`[${UI_KEY_ATTR}]`))) {
    const key = element.getAttribute(UI_KEY_ATTR);
    if (key === null || byKey.has(key)) continue;
    byKey.set(key, element);
  }
  for (const node of snapshot.nodes) {
    const element = byKey.get(node.key);
    if (element === undefined) continue;
    element.scrollTop = node.top;
    element.scrollLeft = node.left;
  }
}
