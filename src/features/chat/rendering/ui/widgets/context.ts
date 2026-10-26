/**
 * Shared contract and helpers for generated-UI widget builders.
 *
 * Two invariants are load-bearing and enforced here for every widget:
 *  - no model-supplied string is ever written through innerHTML;
 *  - colours are restricted to theme tokens or hex literals, so a program
 *    cannot smuggle `url()`, `var()` or a CSS expression into a style.
 */

import { setIcon } from 'obsidian';

import {
  ACTION_SEQUENCE,
  type EvaluationScope,
  type ResolvedAction,
  type ResolvedElement,
  toDisplayText,
  truthy,
} from '../evaluate';

/** Vault summary used by `NoteCard`. */
export interface UiNoteSummary {
  title: string;
  path: string;
  excerpt: string;
  tags: string[];
}

/** Optional host services; every widget must degrade when one is missing. */
export interface UiRenderHost {
  /** Renders markdown through the chat's single sanitising markdown pipeline. */
  renderMarkdown?(el: HTMLElement, markdown: string): void;
  openNote?(linktext: string): void;
  /** Whether a vault note exists; missing notes render muted and are not created. */
  noteExists?(linktext: string): boolean;
  /** Opens Obsidian search for a tag. */
  openTag?(tag: string): void;
  describeNote?(linktext: string): Promise<UiNoteSummary | null>;
  /** Resolves a vault-relative image path to a loadable resource URL. */
  resolveResource?(path: string): string | null;
}

export interface RenderContext {
  scope: EvaluationScope;
  setState(name: string, value: unknown): void;
  resetState(names: string[]): void;
  /** Host-level actions: continue the conversation, open a URL, copy text. */
  runAction(action: ResolvedAction): void;
  rerender(): void;
  /**
   * Registers a listener and marks the node as listener-holding, so a re-render
   * rebuilds it instead of adopting a node whose closure read older state.
   */
  on<K extends keyof HTMLElementEventMap>(
    element: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void;
  /**
   * Stable per-render key for widgets that keep local state (open tab,
   * flipped card, sort column) without a declared `$variable`. Keys are
   * assigned in render order, so the nth widget of a kind keeps its key.
   */
  autoKey?(kind: string): string;
  host?: UiRenderHost;
}

/** Context handed to builders: adds recursive child rendering. */
export interface BuildContext extends RenderContext {
  render(value: unknown): Node | null;
}

export type WidgetBuilder = (element: ResolvedElement, ctx: BuildContext) => HTMLElement | null;

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

/** Accepts a theme token or a plain hex colour; everything else is dropped. */
export function safeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const token = COLOR_TOKENS[trimmed];
  if (token !== undefined) return token;
  if (HEX_COLOR.test(trimmed)) return trimmed;
  return null;
}

/** Series palette drawn from theme tokens so charts follow the active theme. */
export const SERIES_COLORS = [
  'var(--color-blue)',
  'var(--color-green)',
  'var(--color-orange)',
  'var(--color-purple)',
  'var(--color-pink)',
  'var(--color-cyan)',
];

export const TONES = new Set(['info', 'success', 'warning', 'danger', 'neutral']);

export function readTone(value: unknown, fallback = 'neutral'): string {
  return typeof value === 'string' && TONES.has(value) ? value : fallback;
}

export function readText(element: ResolvedElement, index: number): string {
  return toDisplayText(element.values[index]);
}

export function readString(element: ResolvedElement, index: number): string | null {
  const value = element.values[index];
  return typeof value === 'string' ? value : null;
}

export function readNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

export function readList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function applyGap(element: HTMLElement, value: unknown): void {
  const gap = readNumberValue(value);
  if (gap !== null) element.setCssProps({ gap: `${gap * 4}px` });
}

export function applyColor(element: HTMLElement, value: unknown, property: 'color' | 'background'): void {
  const color = safeColor(value);
  if (color === null) return;
  element.setCssProps(property === 'color' ? { color } : { background: color });
}

export function createBlock(className: string): HTMLElement {
  return createDiv({ cls: `claudian-plus-ui ${className}` });
}

export function appendChildren(container: HTMLElement, value: unknown, ctx: BuildContext): void {
  const node = ctx.render(value);
  if (node !== null) container.appendChild(node);
}

export function createButton(className: string, text?: string): HTMLButtonElement {
  const button = createEl('button', { cls: className });
  button.setAttribute('type', 'button');
  if (text !== undefined) button.textContent = text;
  return button;
}

/** Renders a Lucide icon by name through Obsidian; unknown names render nothing. */
const ICON_NAME = /^[a-z0-9-]{1,48}$/;

export function appendIcon(container: HTMLElement, name: unknown): HTMLElement | null {
  if (typeof name !== 'string' || !ICON_NAME.test(name)) return null;
  const iconEl = createSpan({ cls: 'claudian-plus-ui-icon' });
  iconEl.dataset.icon = name;
  setIcon(iconEl, name);
  container.appendChild(iconEl);
  return iconEl;
}

/** A `$binding` argument, with its current value. */
export interface Binding {
  name: string;
  value: unknown;
}

export function readBinding(element: ResolvedElement, argumentIndex = 0): Binding | null {
  const target = element.args[argumentIndex];
  if (target === undefined || target.kind !== 'state') return null;
  return { name: target.name, value: element.values[argumentIndex] };
}

/**
 * Bound state when the program declared one, otherwise an automatic local
 * key so stateful widgets work without the model wiring a `$variable`.
 */
export function readLocalState(
  element: ResolvedElement,
  ctx: BuildContext,
  argumentIndex: number | null,
  kind: string,
): Binding | null {
  if (argumentIndex !== null) {
    const binding = readBinding(element, argumentIndex);
    if (binding !== null) return binding;
  }
  const key = ctx.autoKey?.(kind);
  if (key === undefined) return null;
  return { name: key, value: ctx.scope.getState(key) };
}

export function isAction(value: unknown): value is ResolvedAction {
  return value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'action';
}

/** Runs an action: local state writes here, everything else through the host. */
export function dispatchAction(action: unknown, ctx: RenderContext): void {
  if (!isAction(action)) return;

  switch (action.name) {
    case ACTION_SEQUENCE:
      for (const step of readList(action.values[0])) dispatchAction(step, ctx);
      return;
    case '@Set': {
      const target = action.targets?.[0];
      if (target !== undefined) ctx.setState(target, action.values[1] ?? null);
      return;
    }
    case '@Reset':
      if (action.targets !== undefined && action.targets.length > 0) ctx.resetState(action.targets);
      return;
    case '@Toggle': {
      const target = action.targets?.[0];
      if (target !== undefined) ctx.setState(target, !truthy(action.values[0]));
      return;
    }
    default:
      ctx.runAction(action);
  }
}
