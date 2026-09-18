import { AuxiliaryRequestGate } from '@/core/auxiliary/AuxiliaryRequestPolicy';
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

  describe('saving mode gating', () => {
    it('issues no title requests for ten conversations in economy mode and delivers local titles', async () => {
      const createRunner = jest.fn();
      const gate = new AuxiliaryRequestGate({
        resolveSavingMode: () => 'economy',
        resolveDailyLimit: () => null,
      });
      const service = new QueryBackedTitleGenerationService({ createRunner, backgroundRequestGate: gate });
      const callbacks = Array.from({ length: 10 }, () => jest.fn());

      for (let index = 0; index < 10; index++) {
        await service.generateTitle(
          `conversation-${index}`,
          `Please help me debug module ${index}\nsecond line`,
          callbacks[index],
        );
      }

      expect(createRunner).not.toHaveBeenCalled();
      expect(gate.getIssuedToday()).toBe(0);
      for (let index = 0; index < 10; index++) {
        expect(callbacks[index]).toHaveBeenCalledTimes(1);
        expect(callbacks[index]).toHaveBeenCalledWith(`conversation-${index}`, {
          success: true,
          title: `Please help me debug module ${index}`,
        });
      }
    });

    it('issues and counts the request in standard mode', async () => {
      const runner = { query: jest.fn().mockResolvedValue('AI Title'), reset: jest.fn() };
      const createRunner = jest.fn().mockReturnValue(runner);
      const gate = new AuxiliaryRequestGate({
        resolveSavingMode: () => 'standard',
        resolveDailyLimit: () => 5,
      });
      const service = new QueryBackedTitleGenerationService({ createRunner, backgroundRequestGate: gate });
      const callback = jest.fn();

      await service.generateTitle('conversation-1', 'some request', callback);

      expect(runner.query).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('conversation-1', { success: true, title: 'AI Title' });
      expect(gate.getIssuedToday()).toBe(1);
      expect(gate.getInFlightCount()).toBe(0);
    });

    it('delivers a local title instead of an error when the daily budget is exhausted', async () => {
      const createRunner = jest.fn();
      const gate = new AuxiliaryRequestGate({
        resolveSavingMode: () => 'standard',
        resolveDailyLimit: () => 1,
      });
      gate.tryBegin();
      gate.end();
      const service = new QueryBackedTitleGenerationService({ createRunner, backgroundRequestGate: gate });
      const callback = jest.fn();

      await service.generateTitle('conversation-1', 'First non-empty line\nsecond', callback);

      expect(createRunner).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('conversation-1', {
        success: true,
        title: 'First non-empty line',
      });
    });

    it('still counts a title request whose runner fails after being issued', async () => {
      const runner = { query: jest.fn().mockRejectedValue(new Error('offline')), reset: jest.fn() };
      const createRunner = jest.fn().mockReturnValue(runner);
      const gate = new AuxiliaryRequestGate({
        resolveSavingMode: () => 'standard',
        resolveDailyLimit: () => 1,
      });
      const service = new QueryBackedTitleGenerationService({ createRunner, backgroundRequestGate: gate });
      const failedCallback = jest.fn();

      await service.generateTitle('conversation-1', 'first request', failedCallback);

      expect(failedCallback).toHaveBeenCalledWith('conversation-1', expect.objectContaining({ success: false }));
      expect(gate.getIssuedToday()).toBe(1);

      const secondCallback = jest.fn();
      await service.generateTitle('conversation-2', 'second request', secondCallback);

      expect(createRunner).toHaveBeenCalledTimes(1);
      expect(secondCallback).toHaveBeenCalledWith('conversation-2', {
        success: true,
        title: 'second request',
      });
    });

    it('keeps the superseded-generation guard while the gate is active', async () => {
      const firstResponse = createDeferred<string>();
      const firstRunner = { query: jest.fn().mockReturnValue(firstResponse.promise), reset: jest.fn() };
      const secondRunner = { query: jest.fn().mockResolvedValue('Newer title'), reset: jest.fn() };
      const createRunner = jest.fn()
        .mockReturnValueOnce(firstRunner)
        .mockReturnValueOnce(secondRunner);
      const gate = new AuxiliaryRequestGate({
        resolveSavingMode: () => 'standard',
        resolveDailyLimit: () => null,
      });
      const service = new QueryBackedTitleGenerationService({ createRunner, backgroundRequestGate: gate });
      const firstCallback = jest.fn();
      const secondCallback = jest.fn();

      const first = service.generateTitle('conversation-1', 'old request', firstCallback);
      const second = service.generateTitle('conversation-1', 'new request', secondCallback);
      firstResponse.resolve('Old title');
      await Promise.all([first, second]);

      expect(firstCallback).not.toHaveBeenCalled();
      expect(secondCallback).toHaveBeenCalledWith('conversation-1', { success: true, title: 'Newer title' });
      expect(gate.getIssuedToday()).toBe(2);
      expect(gate.getInFlightCount()).toBe(0);
    });

    it('runs the runner for an explicitly manual regeneration in economy mode', async () => {
      const runner = { query: jest.fn().mockResolvedValue('Manual title'), reset: jest.fn() };
      const createRunner = jest.fn().mockReturnValue(runner);
      const gate = new AuxiliaryRequestGate({
        resolveSavingMode: () => 'economy',
        resolveDailyLimit: () => null,
      });
      const service = new QueryBackedTitleGenerationService({ createRunner, backgroundRequestGate: gate });
      const callback = jest.fn();

      await service.generateTitleManually('conversation-1', 'manual request', callback);

      expect(createRunner).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('conversation-1', { success: true, title: 'Manual title' });
      expect(gate.getIssuedToday()).toBe(0);
    });
  });
});

