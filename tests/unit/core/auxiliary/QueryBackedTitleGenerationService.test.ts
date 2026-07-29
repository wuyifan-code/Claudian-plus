import { QueryBackedTitleGenerationService } from '@/core/auxiliary/QueryBackedTitleGenerationService';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe('QueryBackedTitleGenerationService', () => {
  it('does not let a replaced generation overwrite the newer title', async () => {
    const firstResponse = createDeferred<string>();
    const firstRunner = {
      query: jest.fn().mockReturnValue(firstResponse.promise),
      reset: jest.fn(),
    };
    const secondRunner = {
      query: jest.fn().mockResolvedValue('New title'),
      reset: jest.fn(),
    };
    const service = new QueryBackedTitleGenerationService({
      createRunner: jest.fn()
        .mockReturnValueOnce(firstRunner)
        .mockReturnValueOnce(secondRunner),
    });
    const firstCallback = jest.fn();
    const secondCallback = jest.fn();

    const first = service.generateTitle('conversation-1', 'old request', firstCallback);
    const firstConfig = firstRunner.query.mock.calls[0][0];
    const second = service.generateTitle('conversation-1', 'new request', secondCallback);

    expect(firstConfig.abortController.signal.aborted).toBe(true);
    firstResponse.resolve('Old title');

    await Promise.all([first, second]);

    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledWith('conversation-1', {
      success: true,
      title: 'New title',
    });
  });
});
