import { buildActivityContext } from '@/core/memory/activityContext';

describe('activityContext', () => {
  const now = new Date('2026-10-24T09:30:00Z').getTime();

  it('renders the current time, recent files, and recent conversations', () => {
    const text = buildActivityContext({
      now,
      locale: 'en-US',
      recentFiles: [
        { path: 'notes/a.md', mtime: now },
        { path: 'notes/b.md', mtime: now - 1000 },
      ],
      recentConversationTitles: ['Refactor memory', 'Plan UI'],
    });

    expect(text).toContain('Current time:');
    expect(text).toContain('Recently edited: notes/a.md, notes/b.md');
    expect(text).toContain('Recent conversations: Refactor memory, Plan UI');
  });

  it('localizes to Chinese with the same inputs', () => {
    const text = buildActivityContext({
      now,
      locale: 'zh-CN',
      recentFiles: [{ path: '笔记/a.md', mtime: now }],
      recentConversationTitles: [],
    });

    expect(text).toContain('当前时间:');
    expect(text).toContain('最近编辑: 笔记/a.md');
    expect(text).not.toContain('Recent conversations');
  });

  it('bounds the block by maxChars', () => {
    const text = buildActivityContext({
      now,
      locale: 'en-US',
      recentFiles: [{ path: 'x'.repeat(500), mtime: now }],
      recentConversationTitles: ['y'.repeat(500)],
      maxChars: 120,
    });

    expect(text.length).toBeLessThanOrEqual(120);
  });
});
