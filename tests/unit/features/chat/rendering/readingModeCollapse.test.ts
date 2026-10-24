import { buildThinkingSummary } from '@/features/chat/rendering/ThinkingBlockRenderer';
import { buildExecutionRunSummary, buildToolCallSummary } from '@/features/chat/rendering/ToolCallRenderer';

describe('Reading mode summary builders', () => {
  describe('buildToolCallSummary', () => {
    it('builds a one-line tool call summary with name, status, duration', () => {
      expect(buildToolCallSummary({ toolName: 'Write', status: 'completed', durationMs: 340 }))
        .toBe('Write · completed · 340ms');
    });

    it('handles missing duration or status gracefully', () => {
      expect(buildToolCallSummary({ toolName: 'Read' })).toBe('Read');
      expect(buildToolCallSummary({ toolName: 'Bash', status: 'running' })).toBe('Bash · running');
    });

    it('includes target file or pattern if provided', () => {
      expect(buildToolCallSummary({ toolName: 'Read', target: 'index.ts', status: 'completed', durationMs: 150 }))
        .toBe('Read index.ts · completed · 150ms');
    });
  });

  describe('buildThinkingSummary', () => {
    it('builds a thinking summary line with duration in ms', () => {
      const summary = buildThinkingSummary({ durationMs: 1200 });
      expect(summary).toContain('Thought');
      expect(summary).toContain('1.2s');
    });

    it('builds a thinking summary line with duration in seconds', () => {
      const summary = buildThinkingSummary({ durationSeconds: 5 });
      expect(summary).toContain('Thought');
      expect(summary).toContain('5s');
    });

    it('provides a default thinking summary when duration is not provided', () => {
      expect(buildThinkingSummary({})).toBe('Thought');
    });
  });

  describe('buildExecutionRunSummary', () => {
    it('summarizes a whole run with tool count, deduped names and thinking time', () => {
      const summary = buildExecutionRunSummary({
        tools: [
          { name: 'grep' },
          { name: 'glob' },
          { name: 'grep' },
        ],
        thinkingSeconds: 12,
      });
      expect(summary).toContain('3 tools');
      expect(summary).toContain('grep · glob');
      expect(summary).toContain('thought 12s');
    });

    it('reports failed tool counts when any tool errored', () => {
      const summary = buildExecutionRunSummary({
        tools: [
          { name: 'pwsh', status: 'error' },
          { name: 'pwsh', status: 'completed' },
          { name: 'glob', status: 'error' },
        ],
      });
      expect(summary).toContain('2 failed');
      expect(summary).not.toContain('thought');
    });

    it('handles an empty tool list', () => {
      expect(buildExecutionRunSummary({ tools: [] })).toBe('0 tools');
    });
  });
});
