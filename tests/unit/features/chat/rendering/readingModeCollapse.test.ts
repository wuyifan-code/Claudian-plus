import { buildThinkingSummary } from '@/features/chat/rendering/ThinkingBlockRenderer';
import { buildToolCallSummary } from '@/features/chat/rendering/ToolCallRenderer';

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
});
