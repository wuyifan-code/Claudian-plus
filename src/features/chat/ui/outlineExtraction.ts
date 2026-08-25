import { formatConversationDirectoryTitle } from '../utils/conversationDirectoryTitle';

export type ConversationOutlineKind = 'prompt' | 'heading' | 'tool' | 'thinking';
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

/**
 * Extracts outline entries for user questions/prompts in document order from a chat container.
 */
export function extractOutlineEntries(messagesEl: HTMLElement): ConversationOutlineEntry[] {
  const entries: ConversationOutlineEntry[] = [];
  const messageEls = Array.from(
    messagesEl.querySelectorAll<HTMLElement>(
      '.claudian-plus-message-user, [data-role="user"]'
    )
  );

  for (const messageEl of messageEls) {
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
