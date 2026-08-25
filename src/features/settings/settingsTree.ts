import type { ProviderId } from '../../core/providers/types';
import { t } from '../../i18n/i18n';

export interface SettingsCategoryNode {
  id: string;
  label: string;
  icon?: string;
  providerId?: ProviderId;
  children?: SettingsCategoryNode[];
}

export interface BuildSettingsTreeOptions {
  enabledProviderIds: ProviderId[];
  getProviderDisplayName: (id: ProviderId) => string;
  locale?: string;
}

/**
 * Builds the hierarchical settings category tree.
 */
export function buildSettingsTree(options: BuildSettingsTreeOptions): SettingsCategoryNode[] {
  const { enabledProviderIds, getProviderDisplayName } = options;

  const providerChildren: SettingsCategoryNode[] = enabledProviderIds.map((providerId) => ({
    id: `providers:${providerId}`,
    label: getProviderDisplayName(providerId),
    providerId,
  }));

  return [
    {
      id: 'general',
      label: t('settings.category.general') || 'General',
      icon: 'settings',
    },
    {
      id: 'appearance',
      label: t('settings.category.appearance') || 'Appearance',
      icon: 'palette',
    },
    {
      id: 'memory',
      label: t('settings.category.memory') || 'Memory & Consciousness',
      icon: 'brain',
    },
    {
      id: 'providers',
      label: t('settings.category.providers') || 'Providers',
      icon: 'cpu',
      children: providerChildren,
    },
    {
      id: 'agents-skills',
      label: t('settings.category.agentsSkills') || 'Agents & Skills',
      icon: 'bot',
    },
    {
      id: 'workspace',
      label: t('settings.category.workspace') || 'Workspace',
      icon: 'folder',
    },
    {
      id: 'advanced',
      label: t('settings.category.advanced') || 'Advanced',
      icon: 'sliders',
    },
  ];
}

/**
 * Resolves a selected category ID, falling back to 'providers' or 'general' if invalid.
 */
export function resolveSelectedCategory(
  selectedId: string | undefined,
  tree: SettingsCategoryNode[]
): string {
  if (!selectedId) return 'general';

  for (const node of tree) {
    if (node.id === selectedId) return selectedId;
    if (node.children) {
      for (const child of node.children) {
        if (child.id === selectedId) return child.id;
      }
    }
  }

  if (selectedId.startsWith('providers:')) {
    return 'providers';
  }

  return 'general';
}
