import '@/providers';

import {
  AuxiliaryRequestGate,
  buildLocalFallbackTitle,
  setSharedBackgroundRequestGate,
} from '@/core/auxiliary/AuxiliaryRequestPolicy';
import { QueryBackedTitleGenerationService } from '@/core/auxiliary/QueryBackedTitleGenerationService';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { AntigravityTitleGenerationService } from '@/providers/antigravity/auxiliary/AntigravityTitleGenerationService';

/**
 * A plugin with no CLI resolution, no settings, and no storage: any code path
 * that tried to reach a model through the host would fail instead of passing.
 */
function createBarePlugin(): ProviderHost {
  return {} as ProviderHost;
}

describe('AntigravityTitleGenerationService', () => {
  afterEach(() => {
    setSharedBackgroundRequestGate(null);
  });

  it('builds the title locally and reports success', async () => {
    const service = new AntigravityTitleGenerationService();
    const callback = jest.fn(async () => {});

    await service.generateTitle('conversation-1', '  Fix the failing build  ', callback);

    expect(callback).toHaveBeenCalledWith('conversation-1', {
      success: true,
      title: buildLocalFallbackTitle('  Fix the failing build  '),
    });
    expect(callback).toHaveBeenCalledWith('conversation-1', {
      success: true,
      title: 'Fix the failing build',
    });
  });

  it('truncates a long first line with the shared local fallback rule', async () => {
    const service = new AntigravityTitleGenerationService();
    const titles: string[] = [];
    const longMessage = `Investigate the ${'very '.repeat(30)}long request`;

    await service.generateTitle('conversation-2', longMessage, async (_conversationId, result) => {
      if (result.success) {
        titles.push(result.title);
      }
    });

    expect(titles).toHaveLength(1);
    expect(titles[0].length).toBeLessThanOrEqual(53);
    expect(titles[0].endsWith('...')).toBe(true);
  });

  it('never consults the shared background request gate', async () => {
    // The gate exists to bound automatic *model* requests: a local string
    // operation is neither blocked by the saving mode nor counted against the
    // background request budget.
    const gate = new AuxiliaryRequestGate({
      resolveDailyLimit: () => 1,
      resolveSavingMode: () => 'economy',
    });
    const allowsAutomaticTask = jest.spyOn(gate, 'allowsAutomaticTask');
    const tryBegin = jest.spyOn(gate, 'tryBegin');
    setSharedBackgroundRequestGate(gate);
    const service = new AntigravityTitleGenerationService();
    const callback = jest.fn(async () => {});

    await service.generateTitle('conversation-3', 'Anything', callback);

    expect(allowsAutomaticTask).not.toHaveBeenCalled();
    expect(tryBegin).not.toHaveBeenCalled();
    expect(gate.getUsageSnapshot().count).toBe(0);
    expect(callback).toHaveBeenCalledWith('conversation-3', { success: true, title: 'Anything' });
  });

  it('never needs a runner or a plugin', async () => {
    const service = new AntigravityTitleGenerationService();
    expect(service).not.toBeInstanceOf(QueryBackedTitleGenerationService);

    // Same construction path the provider registration uses: a provider with no
    // auxiliary runner still produces titles.
    const routed = ProviderRegistry.createTitleGenerationService(
      createBarePlugin(),
      'antigravity',
    );
    expect(routed).toBeInstanceOf(AntigravityTitleGenerationService);

    const callback = jest.fn(async () => {});
    await routed.generateTitle('conversation-4', 'Local title only', callback);
    expect(callback).toHaveBeenCalledWith('conversation-4', {
      success: true,
      title: 'Local title only',
    });
    routed.cancel();
  });
});
