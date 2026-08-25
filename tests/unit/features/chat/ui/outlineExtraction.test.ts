/**
 * @jest-environment jsdom
 */
import {
  type ConversationOutlineKind,
  extractOutlineEntries,
  filterEntriesByKinds,
} from '@/features/chat/ui/outlineExtraction';

describe('outlineExtraction', () => {
  function createFixture(): HTMLElement {
    const root = document.createElement('div');

    // 1. User message 1
    const userMsg1 = document.createElement('div');
    userMsg1.className = 'claudian-plus-message-user';
    const userContent1 = document.createElement('div');
    userContent1.className = 'claudian-plus-message-content';
    userContent1.textContent = 'How do I optimize database queries?';
    userMsg1.appendChild(userContent1);
    root.appendChild(userMsg1);

    // 2. Assistant message 1
    const assistantMsg1 = document.createElement('div');
    assistantMsg1.className = 'claudian-plus-message-assistant';
    const content1 = document.createElement('div');
    content1.className = 'claudian-plus-message-content';
    const p1 = document.createElement('p');
    p1.className = 'claudian-plus-text-block';
    p1.textContent = 'To optimize database performance, ensure proper indexing on frequently queried columns.';
    content1.appendChild(p1);
    assistantMsg1.appendChild(content1);
    root.appendChild(assistantMsg1);

    // 3. User message 2
    const userMsg2 = document.createElement('div');
    userMsg2.className = 'claudian-plus-message-user';
    const userContent2 = document.createElement('div');
    userContent2.className = 'claudian-plus-message-content';
    userContent2.textContent = 'What about query caching?';
    userMsg2.appendChild(userContent2);
    root.appendChild(userMsg2);

    // 4. Assistant message 2
    const assistantMsg2 = document.createElement('div');
    assistantMsg2.className = 'claudian-plus-message-assistant';
    const content2 = document.createElement('div');
    content2.className = 'claudian-plus-message-content';
    const p2 = document.createElement('p');
    p2.className = 'claudian-plus-text-block';
    p2.textContent = 'Query caching stores query results in memory for rapid retrieval.';
    content2.appendChild(p2);
    assistantMsg2.appendChild(content2);
    root.appendChild(assistantMsg2);

    return root;
  }

  it('extracts user questions/prompts in document order', () => {
    const root = createFixture();
    const entries = extractOutlineEntries(root);

    expect(entries.map(e => e.kind)).toEqual(['prompt', 'prompt']);
    expect(entries.map(e => e.title)).toEqual([
      'How do I optimize database queries?',
      'What about query caching?',
    ]);
  });

  it('extracts prompt details with excerpt and Q badge', () => {
    const root = createFixture();
    const entries = extractOutlineEntries(root);
    const promptEntry = entries[0];

    expect(promptEntry).toBeDefined();
    expect(promptEntry.badge).toBe('Q');
    expect(promptEntry.kind).toBe('prompt');
    expect(promptEntry.title).toBe('How do I optimize database queries?');
    expect(promptEntry.excerpt).toContain('To optimize database performance');
  });

  describe('filterEntriesByKinds', () => {
    it('filters outline entries by enabled kinds', () => {
      const root = createFixture();
      const entries = extractOutlineEntries(root);

      const filtered = filterEntriesByKinds(entries, new Set<ConversationOutlineKind>(['prompt']));
      expect(filtered.length).toBe(2);

      const empty = filterEntriesByKinds(entries, new Set<ConversationOutlineKind>(['tool']));
      expect(empty.length).toBe(0);
    });
  });
});
