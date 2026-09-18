import type { AuxQueryConfig, AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
import { computeLineDiff, InlineEditService } from '@/features/inline-edit/InlineEditService';

describe('InlineEditService', () => {
  describe('computeLineDiff', () => {
    it('computes equal diff when texts match', () => {
      const diff = computeLineDiff('hello\nworld', 'hello\nworld');
      expect(diff).toEqual([
        { type: 'equal', text: 'hello' },
        { type: 'equal', text: 'world' },
      ]);
    });

    it('identifies inserted and deleted lines', () => {
      const diff = computeLineDiff('old line', 'new line');
      expect(diff).toEqual([
        { type: 'delete', text: 'old line' },
        { type: 'insert', text: 'new line' },
      ]);
    });

    it('handles additions and preserves unchanged lines', () => {
      const diff = computeLineDiff('first\nthird', 'first\nsecond\nthird');
      expect(diff).toEqual([
        { type: 'equal', text: 'first' },
        { type: 'insert', text: 'second' },
        { type: 'equal', text: 'third' },
      ]);
    });
  });

  describe('generateEdit', () => {
    let mockRunner: jest.Mocked<AuxQueryRunner>;
    let service: InlineEditService;

    beforeEach(() => {
      mockRunner = {
        query: jest.fn(),
        reset: jest.fn(),
      };
      service = new InlineEditService(() => mockRunner);
    });

    it('generates edit and returns clean replacement with diff lines', async () => {
      mockRunner.query.mockResolvedValue('const y = 20;');

      const result = await service.generateEdit({
        instruction: 'change variable to y',
        context: {
          notePath: 'test.md',
          mode: 'selection',
          selectedText: 'const x = 10;',
        },
      });

      expect(result.originalText).toBe('const x = 10;');
      expect(result.replacementText).toBe('const y = 20;');
      expect(result.diffLines).toEqual([
        { type: 'delete', text: 'const x = 10;' },
        { type: 'insert', text: 'const y = 20;' },
      ]);
    });

    it('strips markdown code block fences if AI adds them around pure code', async () => {
      mockRunner.query.mockResolvedValue('```ts\nconst total = calculateTotal();\n```');

      const result = await service.generateEdit({
        instruction: 'clean up code',
        context: {
          notePath: 'test.md',
          mode: 'selection',
          selectedText: 'const total = calc();',
        },
      });

      expect(result.replacementText).toBe('const total = calculateTotal();');
    });

    it('invokes onChunk during streaming generation', async () => {
      mockRunner.query.mockImplementation(async (config: AuxQueryConfig) => {
        config.onTextChunk?.('partial line 1');
        config.onTextChunk?.('partial line 1\nline 2');
        return 'partial line 1\nline 2';
      });

      const chunkSpy = jest.fn();

      await service.generateEdit(
        {
          instruction: 'add lines',
          context: {
            notePath: 'test.md',
            mode: 'selection',
            selectedText: 'old line',
          },
        },
        { onChunk: chunkSpy }
      );

      expect(chunkSpy).toHaveBeenCalledTimes(2);
      expect(chunkSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          replacementText: 'partial line 1\nline 2',
        })
      );
    });
  });
});
