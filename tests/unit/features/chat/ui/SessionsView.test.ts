import { createMockEl } from '@test/helpers/mockElement';

import { filterSessions, SessionsView, sortSessions } from '@/features/chat/ui/SessionsView';

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
  });
});
