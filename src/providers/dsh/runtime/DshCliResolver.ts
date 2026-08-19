import { createStandardCliResolverClass } from '../../../core/providers/CachedCliResolver';
import { getDshProviderSettings } from '../settings';

export const DshCliResolver = createStandardCliResolverClass({
  providerId: 'dsh',
  binaryName: 'dsh',
  getProviderSettings: getDshProviderSettings,
});
