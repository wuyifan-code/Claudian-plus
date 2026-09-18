import {
  AuxiliaryRequestGate,
  setSharedBackgroundRequestGate,
} from '@/core/auxiliary/AuxiliaryRequestPolicy';
import { TitleGenerationService } from '@/providers/claude/auxiliary/ClaudeTitleGenerationService';

jest.mock('@/providers/claude/runtime/claudeColdStartQuery', () => ({
  runColdStartQuery: jest.fn(),
}));

jest.mock('@/utils/env', () => ({
  parseEnvironmentVariables: jest.fn().mockReturnValue({}),
}));

const { runColdStartQuery } = jest.requireMock('@/providers/claude/runtime/claudeColdStartQuery') as {
  runColdStartQuery: jest.Mock;
};

function createPlugin() {
  return {
    settings: { titleGenerationModel: '' },
    getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
  } as never;
}

function createEconomyGate(): AuxiliaryRequestGate {
  return new AuxiliaryRequestGate({
    resolveSavingMode: () => 'economy',
    resolveDailyLimit: () => null,
  });
}

describe('ClaudeTitleGenerationService saving mode', () => {
  afterEach(() => {
    setSharedBackgroundRequestGate(null);
    jest.clearAllMocks();
  });

  it('skips the query for an automatic title in economy mode and delivers a local title', async () => {
    const gate = createEconomyGate();
    setSharedBackgroundRequestGate(gate);
    const callback = jest.fn();
    const service = new TitleGenerationService(createPlugin());

    await service.generateTitle('conversation-1', 'Please fix the sidebar rendering bug', callback);

    expect(runColdStartQuery).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith('conversation-1', {
      success: true,
      title: 'Please fix the sidebar rendering bug',
    });
    expect(gate.getIssuedToday()).toBe(0);
    expect(gate.getInFlightCount()).toBe(0);
  });

  it('still runs the query for an explicitly manual regeneration in economy mode', async () => {
    const gate = createEconomyGate();
    setSharedBackgroundRequestGate(gate);
    runColdStartQuery.mockResolvedValue({ text: 'Sidebar Rendering Fix' });
    const callback = jest.fn();
    const service = new TitleGenerationService(createPlugin());

    await service.generateTitleManually(
      'conversation-1',
      'Please fix the sidebar rendering bug',
      callback,
    );

    expect(runColdStartQuery).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('conversation-1', {
      success: true,
      title: 'Sidebar Rendering Fix',
    });
  });
});
