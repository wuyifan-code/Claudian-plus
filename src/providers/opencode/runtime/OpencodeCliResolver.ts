import { createStandardCliResolverClass } from '../../../core/providers/CachedCliResolver';
import { getOpencodeProviderSettings } from '../settings';

export const OpencodeCliResolver = createStandardCliResolverClass({
  providerId: 'opencode',
  binaryName: 'opencode',
  getProviderSettings: getOpencodeProviderSettings,
});
