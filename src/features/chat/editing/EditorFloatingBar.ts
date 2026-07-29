import type { EditorView, PluginValue, ViewUpdate } from '@codemirror/view';
import { ViewPlugin, WidgetType } from '@codemirror/view';
import { setIcon } from 'obsidian';

import { getActiveDocument } from '../../../utils/obsidianCompat';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditorFloatingBarAction {
  id: string;
  label: string;
  /** A Lucide icon name, or a short literal symbol for custom actions. */
  icon?: string;
  /** Prompt template — `{selection}` is replaced with the selected text. */
  promptTemplate: string;
  /** Optional: use inline edit modal instead of sidebar. */
  inlineEdit?: boolean;
  /** Explicit action behavior. `inlineEdit` remains supported for compatibility. */
  mode?: 'inline' | 'chat' | 'custom';
  /** Initial instruction shown in the inline edit prompt. */
  initialInstruction?: string;
  /** Show this action in the compact primary row. */
  primary?: boolean;
}

export interface EditorFloatingBarOptions {
  actions?: EditorFloatingBarAction[];
  onAction: (action: EditorFloatingBarAction, selectedText: string, view?: EditorView) => void;
  /** Minimum selection length to show the bar (default 1). */
  minSelectionLength?: number;
}

/** Vertical offset (px) to position the floating bar above the selection. */
const BAR_SELECTION_GAP_PX = 10;
const BAR_VIEWPORT_MARGIN_PX = 8;

const DEFAULT_ACTIONS: EditorFloatingBarAction[] = [
  {
    id: 'rewrite',
    label: '改写',
    icon: 'sparkles',
    inlineEdit: true,
    mode: 'inline',
    primary: true,
    initialInstruction: '在不改变原意的前提下，让这段文字更清晰、紧凑、自然。',
    promptTemplate: '请对以下内容进行重写和润色，使其更加清晰流畅：\n\n{selection}',
  },
  {
    id: 'explain',
    label: '解释',
    icon: 'help-circle',
    mode: 'chat',
    primary: true,
    promptTemplate: '请简明扼要地解释以下内容：\n\n{selection}',
  },
  {
    id: 'translate',
    label: '翻译',
    icon: 'languages',
    inlineEdit: true,
    mode: 'inline',
    primary: true,
    initialInstruction: '在保留原意和格式的前提下，在中文和英文之间互译。',
    promptTemplate: '请将以下内容翻译成中文（如果是中文则翻译成英文）：\n\n{selection}',
  },
  {
    id: 'summarize',
    label: '提炼',
    icon: 'file-text',
    mode: 'chat',
    promptTemplate: '请用 1-3 句话总结提炼以下内容的核心要点：\n\n{selection}',
  },
  {
    id: 'fix-grammar',
    label: '纠错',
    icon: 'check',
    inlineEdit: true,
    mode: 'inline',
    initialInstruction: '只修正语法、错别字和标点，不要改变原意。',
    promptTemplate: '请在不改变原意的前提下，修正以下内容中的语法、错别字及标点错误：\n\n{selection}',
  },
  {
    id: 'custom',
    label: '提问',
    icon: 'sparkles',
    mode: 'custom',
    promptTemplate: '{selection}',
  },
];

// ---------------------------------------------------------------------------
// Floating toolbar widget
// ---------------------------------------------------------------------------

export class FloatingToolbarWidget extends WidgetType {
  private dom: HTMLElement | null = null;
  private visible = false;

  constructor(
    private readonly view: EditorView | null,
    private readonly options: EditorFloatingBarOptions,
  ) {
    super();
  }

  eq(other: FloatingToolbarWidget): boolean {
    return other.options === this.options;
  }

  toDOM(): HTMLElement {
    if (this.dom) return this.dom;

    const container = createDiv({
      cls: 'claudian-plus-floating-bar claudian-plus-floating-bar-hidden',
      attr: {
        role: 'toolbar',
        'aria-label': 'Claudian Plus text actions',
      },
    });

    const actions = this.options.actions ?? DEFAULT_ACTIONS;
    const primaryActions = actions.filter(action => action.primary === true).slice(0, 3);
    const secondaryActions = actions.filter(action => !primaryActions.includes(action));

    const renderAction = (action: EditorFloatingBarAction, parent: HTMLElement, compact = false): void => {
      const btn = parent.createEl('button', {
        cls: compact
          ? 'claudian-plus-floating-bar-btn claudian-plus-floating-bar-menu-btn'
          : 'claudian-plus-floating-bar-btn',
        attr: {
          type: 'button',
          'data-action-id': action.id,
          'aria-label': action.label,
        },
      });
      btn.title = action.label;
      if (action.icon) {
        const iconSpan = btn.createSpan({ cls: 'claudian-plus-floating-bar-icon' });
        if (/^[a-z0-9-]+$/.test(action.icon)) {
          setIcon(iconSpan, action.icon);
        } else {
          iconSpan.textContent = action.icon;
        }
      }
      btn.createSpan({ cls: 'claudian-plus-floating-bar-label', text: action.label });
      btn.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();

        const selectedText = window.getSelection()?.toString() ?? '';
        if (selectedText.trim()) {
          this.options.onAction(action, selectedText, this.view ?? undefined);
        }
        this.hide();
      });
    };

    const primary = container.createDiv({ cls: 'claudian-plus-floating-bar-primary' });
    for (const action of primaryActions) renderAction(action, primary);

    if (secondaryActions.length > 0) {
      const moreWrap = container.createDiv({ cls: 'claudian-plus-floating-bar-more' });
      const moreButton = moreWrap.createEl('button', {
        cls: 'claudian-plus-floating-bar-btn claudian-plus-floating-bar-more-btn',
        attr: {
          type: 'button',
          'aria-label': '更多文本操作',
          'aria-expanded': 'false',
        },
      });
      const iconSpan = moreButton.createSpan({ cls: 'claudian-plus-floating-bar-icon' });
      setIcon(iconSpan, 'ellipsis');
      moreButton.createSpan({ cls: 'claudian-plus-floating-bar-label', text: '更多' });
      const menu = moreWrap.createDiv({
        cls: 'claudian-plus-floating-bar-menu claudian-plus-floating-bar-menu-hidden',
        attr: { role: 'menu' },
      });
      for (const action of secondaryActions) renderAction(action, menu, true);
      moreButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const expanded = moreButton.getAttribute('aria-expanded') === 'true';
        moreButton.setAttribute('aria-expanded', String(!expanded));
        menu.classList.toggle('claudian-plus-floating-bar-menu-hidden', expanded);
      });
    }

    this.dom = container;
    return container;
  }

  updatePositionFromSelection(): boolean {
    const dom = this.toDOM();

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      this.hide();
      return false;
    }

    // Every Markdown editor gets its own CodeMirror plugin instance. Only the
    // instance that owns the current DOM selection may render a toolbar; this
    // prevents one selection from producing a stack of identical bars when
    // several editors are open in the workspace.
    if (this.view) {
      const anchor = sel.anchorNode;
      const focus = sel.focusNode;
      if (!anchor || !focus || !this.view.dom.contains(anchor) || !this.view.dom.contains(focus)) {
        this.hide();
        return false;
      }
    }

    const selectedText = sel.toString();
    const minLen = this.options.minSelectionLength ?? 1;
    if (!selectedText || selectedText.trim().length < minLen) {
      this.hide();
      return false;
    }

    try {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      if (rect.width === 0 && rect.height === 0) {
        this.hide();
        return false;
      }

      const doc = getActiveDocument();
      if (!doc) {
        this.hide();
        return false;
      }
      if (dom.parentElement !== doc.body) {
        doc.body.appendChild(dom);
      }

      // Reveal before measuring so the toolbar can be clamped to the viewport.
      dom.classList.remove('claudian-plus-floating-bar-hidden');
      const viewport = doc.defaultView ?? window;
      const width = dom.offsetWidth;
      const height = dom.offsetHeight;
      const preferredTop = rect.top - height - BAR_SELECTION_GAP_PX;
      const fallbackTop = rect.bottom + BAR_SELECTION_GAP_PX;
      const top = Math.max(
        BAR_VIEWPORT_MARGIN_PX,
        preferredTop >= BAR_VIEWPORT_MARGIN_PX
          ? preferredTop
          : Math.min(
            fallbackTop,
            viewport.innerHeight - height - BAR_VIEWPORT_MARGIN_PX,
          ),
      );
      const left = Math.min(
        Math.max(BAR_VIEWPORT_MARGIN_PX, rect.left),
        Math.max(BAR_VIEWPORT_MARGIN_PX, viewport.innerWidth - width - BAR_VIEWPORT_MARGIN_PX),
      );

      // Position is fixed via CSS; only dynamic coordinates are set inline.
      dom.style.top = `${top}px`;
      dom.style.left = `${left}px`;
      this.show();
      return true;
    } catch {
      this.hide();
      return false;
    }
  }

  resetMenu(): void {
    if (!this.dom) return;
    const moreBtn = this.dom.querySelector('.claudian-plus-floating-bar-more-btn');
    const menu = this.dom.querySelector('.claudian-plus-floating-bar-menu');
    if (moreBtn) {
      moreBtn.setAttribute('aria-expanded', 'false');
    }
    if (menu) {
      menu.classList.add('claudian-plus-floating-bar-menu-hidden');
    }
  }

  show(): void {
    if (this.dom) {
      this.dom.classList.remove('claudian-plus-floating-bar-hidden');
      this.visible = true;
    }
  }

  hide(): void {
    if (this.dom) {
      this.dom.classList.add('claudian-plus-floating-bar-hidden');
      this.resetMenu();
      this.visible = false;
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    this.dom?.remove();
    this.dom = null;
  }
}

/**
 * The plugin is registered as a workspace-wide CodeMirror extension. That
 * means it also sees Claudian Plus's live-preview chat composer, which is a
 * CodeMirror editor too. Only Markdown source editors should receive the
 * floating actions toolbar.
 */
export function isFloatingBarEligibleEditorView(view: EditorView): boolean {
  const editorEl = view.dom;
  if (editorEl.closest('.claudian-plus-input-wrapper, .claudian-plus-live-preview-composer')) {
    return false;
  }
  return editorEl.closest('.markdown-source-view') !== null;
}

// ---------------------------------------------------------------------------
// ViewPlugin
// ---------------------------------------------------------------------------

function resolveFloatingBarActions(
  actions?: EditorFloatingBarAction[],
): EditorFloatingBarAction[] {
  return actions ?? DEFAULT_ACTIONS;
}

export function createEditorFloatingBarPlugin(
  options: Partial<EditorFloatingBarOptions> = {},
) {
  const actions = resolveFloatingBarActions(options.actions);
  const fullOptions: EditorFloatingBarOptions = {
    actions,
    onAction: options.onAction ?? (() => {}),
    minSelectionLength: options.minSelectionLength ?? 1,
  };

  const plugin = ViewPlugin.fromClass(class implements PluginValue {
    private readonly widget: FloatingToolbarWidget;
    private readonly removeListeners: () => void;
    private readonly enabled: boolean;

    constructor(readonly view: EditorView) {
      this.widget = new FloatingToolbarWidget(view, fullOptions);
      this.enabled = isFloatingBarEligibleEditorView(view);

      if (!this.enabled) {
        this.removeListeners = () => {};
        return;
      }

      const doc = view.dom.ownerDocument
        ?? getActiveDocument();
      if (!doc) {
        this.removeListeners = () => {};
        return;
      }
      const handleSelectionEvent = () => {
        this.widget.updatePositionFromSelection();
      };

      doc.addEventListener('selectionchange', handleSelectionEvent);
      doc.addEventListener('mouseup', handleSelectionEvent);
      doc.addEventListener('keyup', handleSelectionEvent);

      this.removeListeners = () => {
        doc.removeEventListener('selectionchange', handleSelectionEvent);
        doc.removeEventListener('mouseup', handleSelectionEvent);
        doc.removeEventListener('keyup', handleSelectionEvent);
      };
    }

    update(update: ViewUpdate): void {
      if (!this.enabled) return;
      this.widget.updatePositionFromSelection();
    }

    destroy(): void {
      this.removeListeners();
      this.widget.destroy();
    }
  }, {
    provide: () => [],
  });

  return plugin;
}

// ---------------------------------------------------------------------------
// Helper: build a turn request prompt from an action + selection
// ---------------------------------------------------------------------------

export function buildFloatingBarPrompt(
  action: EditorFloatingBarAction,
  selectedText: string,
): string {
  return action.promptTemplate.replace('{selection}', selectedText);
}

export { DEFAULT_ACTIONS };
