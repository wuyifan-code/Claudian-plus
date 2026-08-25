import type { ProviderId } from '@/core/providers/types';
import {
  buildSettingsTree,
  resolveSelectedCategory,
} from '@/features/settings/settingsTree';

describe('settingsTree', () => {
  const mockOptions = {
    enabledProviderIds: ['codex', 'claude', 'opencode'] as ProviderId[],
    getProviderDisplayName: (id: ProviderId) => {
      switch (id) {
        case 'codex': return 'Codex';
        case 'claude': return 'Claude';
        case 'opencode': return 'OpenCode';
        case 'kimi': return 'Kimi';
        case 'pi': return 'Pi';
        default: return id;
      }
    },
  };

  it('builds the fixed category order with providers nested under Providers', () => {
    const tree = buildSettingsTree(mockOptions);
    expect(tree.map(c => c.id)).toEqual([
      'general',
      'appearance',
      'memory',
      'providers',
      'agents-skills',
      'workspace',
      'advanced',
    ]);

    const providersNode = tree.find(c => c.id === 'providers');
    expect(providersNode).toBeDefined();
    expect(providersNode?.children?.map(p => p.providerId)).toEqual([
      'codex',
      'claude',
      'opencode',
    ]);
  });

  it('resolves a valid top-level or child category', () => {
    const tree = buildSettingsTree(mockOptions);

    expect(resolveSelectedCategory('general', tree)).toBe('general');
    expect(resolveSelectedCategory('providers:claude', tree)).toBe('providers:claude');
  });

  it('falls back to "general" if selection is invalid or empty', () => {
    const tree = buildSettingsTree(mockOptions);

    expect(resolveSelectedCategory(undefined, tree)).toBe('general');
    expect(resolveSelectedCategory('nonexistent', tree)).toBe('general');
  });

  it('falls back to "providers" when a disabled provider subpage was previously selected', () => {
    const tree = buildSettingsTree(mockOptions); // kimi is disabled

    expect(resolveSelectedCategory('providers:kimi', tree)).toBe('providers');
  });
});
