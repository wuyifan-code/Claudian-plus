/**
 * Claudian Plus - Context Utilities
 *
 * Note and context file formatting for prompts.
 */

import type { Conversation } from '../core/types';

const LINKED_NOTE_TAG = 'linked_note';
const NOTE_CONTEXT_TAG_PATTERN = '(linked_note|current_note)';

// Matches note context at the START of prompt (legacy placement)
const NOTE_CONTEXT_PREFIX_REGEX = new RegExp(`^<${NOTE_CONTEXT_TAG_PATTERN}>\\n[\\s\\S]*?<\\/\\1>\\n\\n`);
// Matches note context at the END of prompt (current placement)
const NOTE_CONTEXT_SUFFIX_REGEX = new RegExp(`\\n\\n<${NOTE_CONTEXT_TAG_PATTERN}>\\n[\\s\\S]*?<\\/\\1>$`);

/**
 * Pattern to match XML context tags appended to prompts.
 * These tags are always preceded by \n\n separator.
 * Matches: linked_note/current_note, editor_selection (with attributes), editor_cursor (with attributes),
 * context_files, canvas_selection, browser_selection
 */
export const XML_CONTEXT_PATTERN = /\n\n<(?:linked_note|current_note|editor_selection|editor_cursor|context_files|canvas_selection|browser_selection|vault_context)[\s>]/;
const BRACKET_CONTEXT_PATTERN = /\n\[(?:Current note|Editor selection from|Browser selection from|Canvas selection from)\b/;

export function formatCurrentNote(notePath: string): string {
  return `<${LINKED_NOTE_TAG}>\n${notePath}\n</${LINKED_NOTE_TAG}>`;
}

export function appendCurrentNote(prompt: string, notePath: string): string {
  return `${prompt}\n\n${formatCurrentNote(notePath)}`;
}

/**
 * Strips note context from a prompt.
 * Handles legacy <current_note> tags and canonical <linked_note> tags.
 */
export function stripCurrentNoteContext(prompt: string): string {
  const strippedPrefix = prompt.replace(NOTE_CONTEXT_PREFIX_REGEX, '');
  if (strippedPrefix !== prompt) {
    return strippedPrefix;
  }
  return prompt.replace(NOTE_CONTEXT_SUFFIX_REGEX, '');
}

/**
 * Extracts user content that appears before XML context tags.
 * Handles two formats:
 * 1. Legacy: content inside <query> tags
 * 2. Current: user content first, context XML appended after
 */
export function extractContentBeforeXmlContext(text: string): string | undefined {
  if (!text) return undefined;

  // Legacy format: content inside <query> tags
  const queryMatch = text.match(/<query>\n?([\s\S]*?)\n?<\/query>/);
  if (queryMatch) {
    return queryMatch[1].trim();
  }

  // Current format: user content before any XML context tags
  // Context tags are always appended with \n\n separator
  const xmlMatch = text.match(XML_CONTEXT_PATTERN);
  if (xmlMatch?.index !== undefined) {
    return text.substring(0, xmlMatch.index).trim();
  }

  return undefined;
}

export function extractUserDisplayContent(text: string): string | undefined {
  if (!text) return undefined;

  const xmlDisplayContent = extractContentBeforeXmlContext(text);
  if (xmlDisplayContent !== undefined) {
    return xmlDisplayContent;
  }

  const bracketMatch = text.match(BRACKET_CONTEXT_PATTERN);
  if (bracketMatch?.index !== undefined) {
    return text.substring(0, bracketMatch.index).trim();
  }

  return undefined;
}

/**
 * Extracts the actual user query from an XML-wrapped prompt.
 * Used for comparing prompts during history deduplication.
 *
 * Always returns a string - falls back to stripping all XML tags if no
 * structured context is found.
 */
export function extractUserQuery(prompt: string): string {
  if (!prompt) return '';

  // Try to extract content before XML context
  const extracted = extractContentBeforeXmlContext(prompt);
  if (extracted !== undefined) {
    return extracted;
  }

  // No XML context - return the whole prompt stripped of any remaining tags
  return prompt
    .replace(/<(linked_note|current_note)>[\s\S]*?<\/\1>\s*/g, '')
    .replace(/<editor_selection[\s\S]*?<\/editor_selection>\s*/g, '')
    .replace(/<editor_cursor[\s\S]*?<\/editor_cursor>\s*/g, '')
    .replace(/<context_files>[\s\S]*?<\/context_files>\s*/g, '')
    .replace(/<canvas_selection[\s\S]*?<\/canvas_selection>\s*/g, '')
    .replace(/<browser_selection[\s\S]*?<\/browser_selection>\s*/g, '')
    .replace(/<vault_context>[\s\S]*?<\/vault_context>\s*/g, '')
    .trim();
}

/**
 * Builds a bounded, human-readable transcript index for history search.
 *
 * The full messages remain provider-owned; this deliberately stores only a
 * small plain-text projection so cold-start history search does not need to
 * hydrate every provider session or expose hidden prompt context.
 */
export const MAX_CONVERSATION_SEARCH_TEXT_LENGTH = 12_000;

export function buildConversationSearchText(conversation: Pick<Conversation, 'title' | 'messages'>): string {
  const parts: string[] = [];
  if (conversation.title.trim()) parts.push(conversation.title.trim());

  for (const message of conversation.messages) {
    if (message.isRebuiltContext || !message.content.trim()) continue;
    const visibleContent = message.role === 'user'
      ? (message.displayContent ?? extractUserDisplayContent(message.content) ?? message.content)
      : message.content;
    const normalized = visibleContent.replace(/\s+/g, ' ').trim();
    if (normalized) parts.push(normalized);
    if (parts.join('\n').length >= MAX_CONVERSATION_SEARCH_TEXT_LENGTH) break;
  }

  return parts.join('\n').slice(0, MAX_CONVERSATION_SEARCH_TEXT_LENGTH);
}

/** Uses the persisted cold-start index until provider messages are hydrated. */
export function getConversationSearchText(conversation: Conversation): string {
  if (conversation.messages.length === 0 && conversation.searchText) {
    return conversation.searchText.slice(0, MAX_CONVERSATION_SEARCH_TEXT_LENGTH);
  }
  return buildConversationSearchText(conversation);
}

function formatContextFilesLine(files: string[]): string {
  return `<context_files>\n${files.join(', ')}\n</context_files>`;
}

export function appendContextFiles(prompt: string, files: string[]): string {
  return `${prompt}\n\n${formatContextFilesLine(files)}`;
}

/**
 * Appends source-backed vault context to the provider prompt without changing
 * the user-visible message or the persisted turn text.
 */
export function appendVaultContext(prompt: string, vaultContext?: string): string {
  const trimmed = vaultContext?.trim();
  return trimmed ? `${prompt}\n\n${trimmed}` : prompt;
}
