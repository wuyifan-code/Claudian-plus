import { createMockEl } from '@test/helpers/mockElement';

import { extractSearchSnippet, filterSessions, renderHighlightedSnippet, SessionsView, sortSessions } from '@/features/chat/ui/SessionsView';

describe('SessionsView', () => {
  describe('sortSessions', () => {
    it('sorts sessions by last activity descending (lastResponseAt > updatedAt > createdAt)', () => {
      const s1 = { id: 's1', title: 'Old session', createdAt: 1000, lastResponseAt: 2000 };
      const s2 = { id: 's2', title: 'Recent session', createdAt: 1500, lastResponseAt: 5000 };
      const s3 = { id: 's3', title: 'Mid session', createdAt: 1200, updatedAt: 3000 };

      const sorted = sortSessions([s1, s2, s3]);
      expect(sorted.map(s => s.id)).toEqual(['s2', 's3', 's1']);
    });
  });

  describe('filterSessions', () => {
    it('filters sessions by title case-insensitively', () => {
      const s1 = { id: 's1', title: 'Optimize Algorithm' };
      const s2 = { id: 's2', title: 'Refactor UI' };
      const s3 = { id: 's3', title: 'Write Tests' };

      const filtered = filterSessions([s1, s2, s3], 'opt');
      expect(filtered.map(s => s.id)).toEqual(['s1']);
    });

    it('filters sessions by searchText or preview', () => {
      const s1 = { id: 's1', title: 'Session 1', preview: 'Discussing vector embeddings' };
      const s2 = { id: 's2', title: 'Session 2', searchText: 'Implementing AST parser' };

      const filteredEmbeddings = filterSessions([s1, s2], 'embeddings');
      expect(filteredEmbeddings.map(s => s.id)).toEqual(['s1']);

      const filteredParser = filterSessions([s1, s2], 'parser');
      expect(filteredParser.map(s => s.id)).toEqual(['s2']);
    });

    it('returns all sessions if query is empty or whitespace', () => {
      const s1 = { id: 's1', title: 'Session 1' };
      const s2 = { id: 's2', title: 'Session 2' };

      expect(filterSessions([s1, s2], '')).toEqual([s1, s2]);
      expect(filterSessions([s1, s2], '   ')).toEqual([s1, s2]);
    });
  });

  describe('DOM rendering and interaction', () => {
    let containerEl: any;
    let mockOnOpenConversation: jest.Mock;
    let mockOnDeleteConversation: jest.Mock;
    let mockOnRenameConversation: jest.Mock;
    let mockPlugin: any;

    beforeEach(() => {
      containerEl = createMockEl();
      mockOnOpenConversation = jest.fn();
      mockOnDeleteConversation = jest.fn().mockResolvedValue(undefined);
      mockOnRenameConversation = jest.fn().mockResolvedValue(undefined);
      mockPlugin = {
        deleteConversation: mockOnDeleteConversation,
        renameConversation: mockOnRenameConversation,
      };
    });

    it('renders search bar and session rows', () => {
      const sessions = [
        { id: 's-1', title: 'Alpha session', preview: 'Alpha preview text', createdAt: 1000, updatedAt: Date.now() - 1000 },
        { id: 's-2', title: 'Beta session', preview: 'Beta preview text', createdAt: 2000, updatedAt: Date.now() - 5000 },
      ];

      const view = new SessionsView(containerEl, {
        plugin: mockPlugin,
        getConversationList: () => sessions,
        onOpenConversation: mockOnOpenConversation,
        onDeleteConversation: mockOnDeleteConversation,
        onRenameConversation: mockOnRenameConversation,
      });

      const searchInput = containerEl.querySelector('.claudian-plus-sessions-search-input');
      expect(searchInput).not.toBeNull();

      const rows = containerEl.querySelectorAll('.claudian-plus-session-row');
      expect(rows.length).toBe(2);

      // Clicking row triggers onOpenConversation
      rows[0].click();
      expect(mockOnOpenConversation).toHaveBeenCalledWith('s-1', false);

      view.destroy();
    });

    it('displays empty state when no sessions are available', () => {
      const view = new SessionsView(containerEl, {
        plugin: mockPlugin,
        getConversationList: () => [],
        onOpenConversation: mockOnOpenConversation,
        onDeleteConversation: mockOnDeleteConversation,
        onRenameConversation: mockOnRenameConversation,
      });

      const emptyEl = containerEl.querySelector('.claudian-plus-sessions-empty');
      expect(emptyEl).not.toBeNull();
      expect(emptyEl?.textContent).toContain('No chat sessions yet');

      view.destroy();
    });

  describe('extractSearchSnippet', () => {
    it('returns null if text or query is empty', () => {
      expect(extractSearchSnippet('', 'test')).toBeNull();
      expect(extractSearchSnippet('some text', '')).toBeNull();
    });

    it('returns null if query is not found in text', () => {
      expect(extractSearchSnippet('Hello world', 'nonexistent')).toBeNull();
    });

    it('extracts prefix, match, and suffix around match', () => {
      const text = 'The quick brown fox jumps over the lazy dog';
      const snippet = extractSearchSnippet(text, 'brown fox', 30);
      expect(snippet).not.toBeNull();
      expect(snippet?.match).toBe('brown fox');
      expect(snippet?.prefix).toContain('quick ');
      expect(snippet?.suffix).toContain(' jumps');
    });

    it('preserves case of matched text from original text', () => {
      const text = 'User wants to Optimize Algorithm performance';
      const snippet = extractSearchSnippet(text, 'optimize', 40);
      expect(snippet).not.toBeNull();
      expect(snippet?.match).toBe('Optimize');
    });
  });

  describe('renderHighlightedSnippet', () => {
    it('renders prefix, mark with class, and suffix into container', () => {
      const container = createMockEl('div');
      renderHighlightedSnippet(container, 'prefix ', 'MATCH', ' suffix');

      const mark = container.querySelector('.claudian-plus-search-match');
      expect(mark).not.toBeNull();
      expect(mark?.tagName?.toLowerCase()).toBe('mark');
      expect(mark?.textContent).toBe('MATCH');
    });
  });

  describe('Search highlighting and navigation', () => {
    let containerEl: any;
    let mockOnOpenConversation: jest.Mock;
    let mockOnDeleteConversation: jest.Mock;
    let mockOnRenameConversation: jest.Mock;
    let mockPlugin: any;

    beforeEach(() => {
      containerEl = createMockEl();
      mockOnOpenConversation = jest.fn();
      mockOnDeleteConversation = jest.fn().mockResolvedValue(undefined);
      mockOnRenameConversation = jest.fn().mockResolvedValue(undefined);
      mockPlugin = {
        deleteConversation: mockOnDeleteConversation,
        renameConversation: mockOnRenameConversation,
      };
    });

    it('renders highlighted snippet in preview when search query matches searchText', () => {
      const sessions = [
        {
          id: 's-search',
          title: 'Search Session',
          searchText: 'User asked about machine learning algorithms in deep neural nets',
          createdAt: 1000,
        },
      ];

      const view = new SessionsView(containerEl, {
        plugin: mockPlugin,
        getConversationList: () => sessions,
        onOpenConversation: mockOnOpenConversation,
        onDeleteConversation: mockOnDeleteConversation,
        onRenameConversation: mockOnRenameConversation,
      });

      const searchInput = containerEl.querySelector('.claudian-plus-sessions-search-input');
      expect(searchInput).not.toBeNull();
      searchInput.value = 'learning';
      searchInput.dispatchEvent('input');

      const markEl = containerEl.querySelector('.claudian-plus-search-match');
      expect(markEl).not.toBeNull();
      expect(markEl?.textContent).toBe('learning');

      const row = containerEl.querySelector('.claudian-plus-session-row');
      row.click();
      expect(mockOnOpenConversation).toHaveBeenCalledWith('s-search', false, { searchQuery: 'learning' });

      view.destroy();
    });

    it('passes searchQuery when opening in new tab from action button', () => {
      const sessions = [
        {
          id: 's-search-2',
          title: 'Session 2',
          searchText: 'Testing unit test snippets',
          createdAt: 1000,
        },
      ];

      const view = new SessionsView(containerEl, {
        plugin: mockPlugin,
        getConversationList: () => sessions,
        onOpenConversation: mockOnOpenConversation,
        onDeleteConversation: mockOnDeleteConversation,
        onRenameConversation: mockOnRenameConversation,
      });

      const searchInput = containerEl.querySelector('.claudian-plus-sessions-search-input');
      searchInput.value = 'unit test';
      searchInput.dispatchEvent('input');

      const newTabBtn = containerEl.querySelector('.claudian-plus-session-action-btn');
      newTabBtn.click();
      expect(mockOnOpenConversation).toHaveBeenCalledWith('s-search-2', true, { searchQuery: 'unit test' });

      view.destroy();
    });
  });

  });
});
