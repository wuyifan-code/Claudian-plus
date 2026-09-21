import { setIcon } from 'obsidian';

import type { ToolCallInfo } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { collapseElement, setupCollapsible } from './collapsible';

export interface StoredToolGroupOptions {
  initiallyExpanded?: boolean;
  collapsedByDefault?: boolean;
}

export type ToolGroupStatus = 'running' | 'completed' | 'error' | 'blocked';

export function buildToolGroupSummary(toolCalls: ToolCallInfo[]): { countText: string; previewText: string } {
  const count = toolCalls.length;
  const countText = count === 1
    ? t('chat.toolGroup.callSingle', { count: 1 })
    : t('chat.toolGroup.calls', { count });

  const uniqueNames: string[] = [];
  for (const tc of toolCalls) {
    if (tc.name && !uniqueNames.includes(tc.name)) {
      uniqueNames.push(tc.name);
    }
  }

  let previewText = '';
  if (uniqueNames.length > 0) {
    if (uniqueNames.length <= 3) {
      previewText = `· ${uniqueNames.join(', ')}`;
    } else {
      previewText = `· ${uniqueNames.slice(0, 3).join(', ')}...`;
    }
  }

  return { countText, previewText };
}

export function determineToolGroupStatus(toolCalls: ToolCallInfo[]): ToolGroupStatus {
  if (toolCalls.some(tc => tc.status === 'error')) {
    return 'error';
  }
  if (toolCalls.some(tc => tc.status === 'blocked')) {
    return 'blocked';
  }
  if (toolCalls.some(tc => tc.status === 'running')) {
    return 'running';
  }
  return 'completed';
}

export function updateToolGroupStatusEl(statusEl: HTMLElement, status: ToolGroupStatus): void {
  statusEl.className = 'claudian-plus-tool-group-status';
  statusEl.empty();
  statusEl.addClass(`status-${status}`);

  switch (status) {
    case 'error':
      statusEl.setAttribute('aria-label', t('chat.toolGroup.statusHasErrors'));
      setIcon(statusEl, 'x');
      break;
    case 'blocked':
      statusEl.setAttribute('aria-label', t('chat.toolGroup.statusBlocked'));
      setIcon(statusEl, 'shield-off');
      break;
    case 'running':
      statusEl.setAttribute('aria-label', 'Status: in progress');
      setIcon(statusEl, 'loader-2');
      break;
    case 'completed':
    default:
      statusEl.setAttribute('aria-label', t('chat.toolGroup.statusAllSuccess'));
      setIcon(statusEl, 'check');
      break;
  }
}

/**
 * Renders a collapsed tool group container for historical / stored messages.
 */
export function renderStoredToolGroup(
  parentEl: HTMLElement,
  toolCalls: ToolCallInfo[],
  renderSingleTool: (container: HTMLElement, toolCall: ToolCallInfo) => void,
  options: StoredToolGroupOptions = {}
): HTMLElement {
  const containerEl = parentEl.createDiv({ cls: 'claudian-plus-tool-group' });
  containerEl.setAttribute('role', 'region');
  containerEl.setAttribute('aria-label', t('chat.toolGroup.ariaLabel'));

  const headerEl = containerEl.createDiv({ cls: 'claudian-plus-tool-group-header' });
  headerEl.setAttribute('role', 'button');
  headerEl.setAttribute('tabindex', '0');

  const chevronEl = headerEl.createSpan({ cls: 'claudian-plus-tool-group-chevron' });
  chevronEl.setAttribute('aria-hidden', 'true');
  setIcon(chevronEl, 'chevron-right');

  const iconEl = headerEl.createSpan({ cls: 'claudian-plus-tool-group-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, 'wrench');

  const titleEl = headerEl.createSpan({ cls: 'claudian-plus-tool-group-title' });
  const { countText, previewText } = buildToolGroupSummary(toolCalls);
  titleEl.createSpan({ cls: 'claudian-plus-tool-group-count', text: countText });
  titleEl.createSpan({ cls: 'claudian-plus-tool-group-preview', text: previewText });

  const statusEl = headerEl.createSpan({ cls: 'claudian-plus-tool-group-status' });
  const status = determineToolGroupStatus(toolCalls);
  updateToolGroupStatusEl(statusEl, status);

  const listEl = containerEl.createDiv({ cls: 'claudian-plus-tool-group-list' });

  for (const tc of toolCalls) {
    renderSingleTool(listEl, tc);
  }

  const initiallyExpanded = options.initiallyExpanded ?? false;
  const state = { isExpanded: initiallyExpanded };
  setupCollapsible(containerEl, headerEl, listEl, state, {
    initiallyExpanded,
    baseAriaLabel: `${countText} ${previewText}`.trim(),
  });

  return containerEl;
}

export interface LiveToolGroupState {
  containerEl: HTMLElement;
  headerEl: HTMLElement;
  chevronEl: HTMLElement;
  iconEl: HTMLElement;
  titleEl: HTMLElement;
  countEl: HTMLElement;
  previewEl: HTMLElement;
  statusEl: HTMLElement;
  listEl: HTMLElement;
  toolCalls: ToolCallInfo[];
  renderedElements: HTMLElement[];
  isExpanded: boolean;
  addToolCall(toolCall: ToolCallInfo, renderedToolEl?: HTMLElement): void;
  registerRenderedTool(toolId: string, toolEl: HTMLElement): void;
  updateStatus(): void;
  autoCollapse(): void;
  finalize(): void;
}

/**
 * Creates a live tool group that starts expanded during streaming and can be
 * auto-collapsed once the tool execution phase completes.
 */
export function createLiveToolGroup(
  parentEl: HTMLElement,
  options: { initiallyExpanded?: boolean } = {}
): LiveToolGroupState {
  const containerEl = parentEl.createDiv({ cls: 'claudian-plus-tool-group' });
  containerEl.setAttribute('role', 'region');
  containerEl.setAttribute('aria-label', t('chat.toolGroup.ariaLabel'));

  const headerEl = containerEl.createDiv({ cls: 'claudian-plus-tool-group-header' });
  headerEl.setAttribute('role', 'button');
  headerEl.setAttribute('tabindex', '0');

  const chevronEl = headerEl.createSpan({ cls: 'claudian-plus-tool-group-chevron' });
  chevronEl.setAttribute('aria-hidden', 'true');
  setIcon(chevronEl, 'chevron-right');

  const iconEl = headerEl.createSpan({ cls: 'claudian-plus-tool-group-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, 'wrench');

  const titleEl = headerEl.createSpan({ cls: 'claudian-plus-tool-group-title' });
  const countEl = titleEl.createSpan({ cls: 'claudian-plus-tool-group-count', text: '' });
  const previewEl = titleEl.createSpan({ cls: 'claudian-plus-tool-group-preview', text: '' });

  const statusEl = headerEl.createSpan({ cls: 'claudian-plus-tool-group-status' });

  const listEl = containerEl.createDiv({ cls: 'claudian-plus-tool-group-list' });

  const toolCalls: ToolCallInfo[] = [];
  const renderedElements: HTMLElement[] = [];
  const renderedToolIdMap = new Map<string, HTMLElement>();

  const initiallyExpanded = options.initiallyExpanded ?? true;
  const collapsibleState = { isExpanded: initiallyExpanded };

  setupCollapsible(containerEl, headerEl, listEl, collapsibleState, {
    initiallyExpanded,
    baseAriaLabel: t('chat.toolGroup.ariaLabel'),
  });

  function updateHeader() {
    const { countText, previewText } = buildToolGroupSummary(toolCalls);
    countEl.setText(countText);
    previewEl.setText(previewText);
    const status = determineToolGroupStatus(toolCalls);
    updateToolGroupStatusEl(statusEl, status);
  }

  const liveState: LiveToolGroupState = {
    containerEl,
    headerEl,
    chevronEl,
    iconEl,
    titleEl,
    countEl,
    previewEl,
    statusEl,
    listEl,
    toolCalls,
    renderedElements,
    get isExpanded() {
      return collapsibleState.isExpanded;
    },
    set isExpanded(val: boolean) {
      collapsibleState.isExpanded = val;
    },
    addToolCall(toolCall: ToolCallInfo, renderedToolEl?: HTMLElement) {
      if (!toolCalls.some(tc => tc.id === toolCall.id)) {
        toolCalls.push(toolCall);
      }
      if (renderedToolEl && !renderedElements.includes(renderedToolEl)) {
        renderedElements.push(renderedToolEl);
        renderedToolIdMap.set(toolCall.id, renderedToolEl);
      }
      updateHeader();
    },
    registerRenderedTool(toolId: string, toolEl: HTMLElement) {
      if (!renderedElements.includes(toolEl)) {
        renderedElements.push(toolEl);
        renderedToolIdMap.set(toolId, toolEl);
      }
      updateHeader();
    },
    updateStatus() {
      updateHeader();
    },
    autoCollapse() {
      if (collapsibleState.isExpanded) {
        collapseElement(containerEl, headerEl, listEl, collapsibleState);
      }
      updateHeader();
    },
    finalize() {
      if (toolCalls.length === 1 && renderedElements.length === 1) {
        const singleEl = renderedElements[0];
        const parent = containerEl.parentElement ?? (containerEl.parentNode as HTMLElement | null);
        if (parent) {
          parent.insertBefore(singleEl, containerEl);
        }
        containerEl.remove();
      } else if (toolCalls.length >= 2) {
        liveState.autoCollapse();
      } else if (toolCalls.length === 0) {
        containerEl.remove();
      }
    },
  };

  return liveState;
}
