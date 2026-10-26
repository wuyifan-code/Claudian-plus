import { formatConversationDirectoryTitle } from '../utils/conversationDirectoryTitle';

export type ConversationOutlineKind = 'prompt' | 'heading' | 'tool' | 'thinking' | 'ui';
export type ConversationOutlineLevel = 1 | 2 | 3;

export interface ConversationOutlineEntry {
  targetEl: HTMLElement;
  messageEl: HTMLElement;
  title: string;
  excerpt: string;
  badge: string;
  kind: ConversationOutlineKind;
  level: ConversationOutlineLevel;
}

const OUTLINE_EXCERPT_LENGTH = 140;

function normalizeOutlineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateOutlineText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function getDirectoryTitle(el: HTMLElement): string {
  const explicitTitle = (el.getAttribute('data-toc-title') ?? '').trim();
  if (explicitTitle) return explicitTitle;

  const contentEl = el.querySelector<HTMLElement>('.claudian-plus-message-content');
  return formatConversationDirectoryTitle(contentEl?.textContent ?? el.textContent ?? '');
}

function getOutlineLevelForTitle(title: string): ConversationOutlineLevel {
  if (title.length < 16) return 3;
  if (title.length <= 32) return 2;
  return 1;
}

function getAssistantResponseExcerpt(userMsgEl: HTMLElement): string {
  let sibling = userMsgEl.nextElementSibling as HTMLElement | null;
  while (sibling) {
    if (
      sibling.classList?.contains?.('claudian-plus-message-user')
      || sibling.getAttribute?.('data-role') === 'user'
    ) {
      return '';
    }

    const isAssistant =
      sibling.classList?.contains?.('claudian-plus-message-assistant')
      || sibling.getAttribute?.('data-role') === 'assistant';

    if (isAssistant) {
      const textBlocks = sibling.querySelectorAll<HTMLElement>('.claudian-plus-text-block');
      if (textBlocks.length > 0) {
        const parts: string[] = [];
        for (const block of Array.from(textBlocks)) {
          const text = normalizeOutlineText(block.textContent ?? '');
          if (text) parts.push(text);
        }
        return truncateOutlineText(parts.join(' '), OUTLINE_EXCERPT_LENGTH);
      }
      return '';
    }
    sibling = sibling.nextElementSibling as HTMLElement | null;
  }
  return '';
}

function getUiBlockTitle(block: HTMLElement): string {
  const explicit = block.querySelector<HTMLElement>(
    '.claudian-plus-ui-title, .claudian-plus-ui-stat-value, .claudian-plus-ui-tab.is-active',
  );
  const text = normalizeOutlineText(explicit?.textContent ?? '');
  if (text.length > 0) return truncateOutlineText(text, 60);
  const fallback = normalizeOutlineText(block.textContent ?? '');
  return fallback.length > 0 ? truncateOutlineText(fallback, 60) : 'UI';
}

/**
 * Extracts outline entries for user questions/prompts and generated interface
 * blocks in document order from a chat container.
 */
export function extractOutlineEntries(messagesEl: HTMLElement): ConversationOutlineEntry[] {
  const entries: ConversationOutlineEntry[] = [];
  const messageEls = Array.from(
    messagesEl.querySelectorAll<HTMLElement>(
      '.claudian-plus-message-user, .claudian-plus-message-assistant, [data-role="user"], [data-role="assistant"]'
    )
  );
  const seen = new Set<HTMLElement>();

  for (const messageEl of messageEls) {
    if (seen.has(messageEl)) continue;
    seen.add(messageEl);
    const isUser = messageEl.classList.contains('claudian-plus-message-user')
      || messageEl.getAttribute('data-role') === 'user';

    if (isUser) {
      const title = getDirectoryTitle(messageEl);
      if (title) {
        entries.push({
          targetEl: messageEl,
          messageEl,
          title,
          excerpt: getAssistantResponseExcerpt(messageEl),
          badge: 'Q',
          kind: 'prompt',
          level: getOutlineLevelForTitle(title),
        });
      }
      continue;
    }

    for (const block of messageEl.querySelectorAll<HTMLElement>('.claudian-plus-ui-block')) {
      entries.push({
        targetEl: block,
        messageEl,
        title: getUiBlockTitle(block),
        excerpt: truncateOutlineText(
          normalizeOutlineText(block.textContent ?? ''),
          OUTLINE_EXCERPT_LENGTH,
        ),
        badge: 'UI',
        kind: 'ui',
        level: 3,
      });
    }
  }

  return entries;
}

/**
 * Filters outline entries by enabled kinds.
 */
export function filterEntriesByKinds(
  entries: ConversationOutlineEntry[],
  enabledKinds: Set<ConversationOutlineKind>
): ConversationOutlineEntry[] {
  return entries.filter((e) => enabledKinds.has(e.kind));
}
