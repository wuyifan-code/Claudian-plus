import { createStandardCliResolverClass } from '../../../core/providers/CachedCliResolver';
import { getKimiProviderSettings } from '../settings';

export const KimiCliResolver = createStandardCliResolverClass({
  providerId: 'kimi',
  binaryName: 'kimi',
  getProviderSettings: getKimiProviderSettings,
});
