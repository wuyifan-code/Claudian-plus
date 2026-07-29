import { QueryBackedInstructionRefineService } from '@/core/auxiliary/QueryBackedInstructionRefineService';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe('QueryBackedInstructionRefineService', () => {
  it('cancels an older refinement so its late result cannot replace the newer conversation', async () => {
    const firstResponse = createDeferred<string>();
    const runner = {
      query: jest.fn()
        .mockReturnValueOnce(firstResponse.promise)
        .mockResolvedValueOnce('<instruction>New instruction</instruction>')
        .mockResolvedValueOnce('<instruction>Follow-up instruction</instruction>'),
      reset: jest.fn(),
    };
    const service = new QueryBackedInstructionRefineService(runner);

    const firstProgress = jest.fn();
    const first = service.refineInstruction('old request', '', firstProgress);
    const firstConfig = runner.query.mock.calls[0][0];

    const second = service.refineInstruction('new request', '');
    expect(firstConfig.abortController.signal.aborted).toBe(true);
    firstConfig.onTextChunk?.('<instruction>Old instruction</instruction>');
    expect(firstProgress).not.toHaveBeenCalled();

    firstResponse.resolve('<instruction>Old instruction</instruction>');

    await expect(first).resolves.toEqual({ success: false, error: 'Cancelled' });
    await expect(second).resolves.toEqual({
      success: true,
      refinedInstruction: 'New instruction',
    });
    await expect(service.continueConversation('follow up')).resolves.toEqual({
      success: true,
      refinedInstruction: 'Follow-up instruction',
    });
  });
});
