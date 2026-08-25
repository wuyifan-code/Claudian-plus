import { Menu, setIcon } from 'obsidian';

import { formatConversationTimestamp } from '../../../utils/date';
import type { FeatureHost } from '../../FeatureHost';

export interface SessionItemData {
  id: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  lastResponseAt?: number;
  providerId?: string;
  preview?: string;
  searchText?: string;
}

export function sortSessions<T extends { createdAt: number; updatedAt?: number; lastResponseAt?: number }>(
  sessions: T[]
): T[] {
  return [...sessions].sort((a, b) => {
    const timeA = a.lastResponseAt ?? a.updatedAt ?? a.createdAt;
    const timeB = b.lastResponseAt ?? b.updatedAt ?? b.createdAt;
    return timeB - timeA;
  });
}

export function filterSessions<T extends { title: string; searchText?: string; preview?: string }>(
  sessions: T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter((s) => {
    if (s.title && s.title.toLowerCase().includes(q)) return true;
    if (s.searchText && s.searchText.toLowerCase().includes(q)) return true;
    if (s.preview && s.preview.toLowerCase().includes(q)) return true;
    return false;
  });
}

export interface SessionsViewDeps {
  plugin: FeatureHost;
  getConversationList: () => SessionItemData[];
  onOpenConversation: (id: string, newTab?: boolean) => void;
  onDeleteConversation: (id: string) => Promise<void>;
  onRenameConversation: (id: string, newTitle: string) => Promise<void>;
  getActiveConversationId?: () => string | null;
}

/**
 * SessionsView renders a first-class file-explorer style list of conversations.
 */
export class SessionsView {
  private containerEl: HTMLElement;
  private deps: SessionsViewDeps;
  private searchQuery = '';
  private searchInputEl: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;

  constructor(containerEl: HTMLElement, deps: SessionsViewDeps) {
    this.containerEl = containerEl;
    this.deps = deps;
    this.build();
  }

  private build(): void {
    this.containerEl.empty();
    this.containerEl.addClass('claudian-plus-sessions-view');

    // Header with search bar
    const searchHeader = this.containerEl.createDiv({ cls: 'claudian-plus-sessions-search-header' });
    const searchWrapper = searchHeader.createDiv({ cls: 'claudian-plus-sessions-search-wrapper' });

    const searchIcon = searchWrapper.createSpan({ cls: 'claudian-plus-sessions-search-icon' });
    setIcon(searchIcon, 'search');

    this.searchInputEl = searchWrapper.createEl('input', {
      type: 'text',
      cls: 'claudian-plus-sessions-search-input',
      placeholder: 'Search sessions...',
    });

    this.searchInputEl.addEventListener('input', () => {
      this.searchQuery = this.searchInputEl?.value ?? '';
      this.renderList();
    });

    // Session list container
    this.listEl = this.containerEl.createDiv({ cls: 'claudian-plus-sessions-list' });
    this.renderList();
  }

  renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    const rawList = this.deps.getConversationList();
    const sorted = sortSessions(rawList);
    const filtered = filterSessions(sorted, this.searchQuery);

    if (filtered.length === 0) {
      const emptyEl = this.listEl.createDiv({ cls: 'claudian-plus-sessions-empty' });
      emptyEl.setText(this.searchQuery ? 'No matching sessions' : 'No chat sessions yet');
      return;
    }

    const activeId = this.deps.getActiveConversationId?.();

    for (const session of filtered) {
      this.renderSessionRow(this.listEl, session, session.id === activeId);
    }
  }

  private renderSessionRow(container: HTMLElement, session: SessionItemData, isActive: boolean): HTMLElement {
    const row = container.createDiv({
      cls: ['claudian-plus-session-row', isActive ? 'is-active' : ''].filter(Boolean).join(' '),
    });

    // Provider / Message icon
    const iconEl = row.createSpan({ cls: 'claudian-plus-session-icon' });
    setIcon(iconEl, isActive ? 'message-square-dot' : 'message-square');

    // Content container (Title + relative time + preview)
    const contentEl = row.createDiv({ cls: 'claudian-plus-session-content' });

    const titleRow = contentEl.createDiv({ cls: 'claudian-plus-session-title-row' });
    const titleEl = titleRow.createSpan({ cls: 'claudian-plus-session-title', text: session.title });

    const timeEl = titleRow.createSpan({ cls: 'claudian-plus-session-time' });
    const timestamp = session.lastResponseAt ?? session.updatedAt ?? session.createdAt;
    timeEl.setText(formatConversationTimestamp(timestamp));

    if (session.preview) {
      const previewEl = contentEl.createDiv({ cls: 'claudian-plus-session-preview' });
      previewEl.setText(session.preview);
    }

    // Actions on hover
    const actionsEl = row.createDiv({ cls: 'claudian-plus-session-actions' });

    const newTabBtn = actionsEl.createEl('button', {
      cls: 'claudian-plus-session-action-btn',
      attr: { 'aria-label': 'Open in new tab' },
    });
    setIcon(newTabBtn, 'square-plus');
    newTabBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deps.onOpenConversation(session.id, true);
    });

    const renameBtn = actionsEl.createEl('button', {
      cls: 'claudian-plus-session-action-btn',
      attr: { 'aria-label': 'Rename session' },
    });
    setIcon(renameBtn, 'pencil');
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showInlineRename(row, session, titleEl);
    });

    const deleteBtn = actionsEl.createEl('button', {
      cls: 'claudian-plus-session-action-btn claudian-plus-session-delete-btn',
      attr: { 'aria-label': 'Delete session' },
    });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.deps.onDeleteConversation(session.id).then(() => this.renderList());
    });

    // Row click -> open in current tab
    row.addEventListener('click', () => {
      this.deps.onOpenConversation(session.id, false);
    });

    // Context menu
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle('Open in current tab').onClick(() => {
          this.deps.onOpenConversation(session.id, false);
        })
      );
      menu.addItem((item) =>
        item.setTitle('Open in new tab').onClick(() => {
          this.deps.onOpenConversation(session.id, true);
        })
      );
      menu.addItem((item) =>
        item.setTitle('Rename').onClick(() => {
          this.showInlineRename(row, session, titleEl);
        })
      );
      menu.addItem((item) =>
        item.setTitle('Delete').onClick(() => {
          void this.deps.onDeleteConversation(session.id).then(() => this.renderList());
        })
      );
      menu.showAtMouseEvent(e);
    });

    return row;
  }

  private showInlineRename(
    row: HTMLElement,
    session: SessionItemData,
    titleEl: HTMLElement
  ): void {
    const input = row.createEl('input', {
      cls: 'claudian-plus-session-rename-input',
      type: 'text',
      value: session.title,
    });

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const finish = async () => {
      const newTitle = input.value.trim() || session.title;
      await this.deps.onRenameConversation(session.id, newTitle);
      this.renderList();
    };

    input.addEventListener('blur', () => {
      void finish();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      } else if (e.key === 'Escape') {
        input.value = session.title;
        input.blur();
      }
    });
  }

  destroy(): void {
    this.containerEl.empty();
    this.containerEl.removeClass('claudian-plus-sessions-view');
  }
}
