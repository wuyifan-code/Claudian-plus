import { createStandardCliResolverClass } from '../../../core/providers/CachedCliResolver';
import { getPiProviderSettings } from '../settings';

export const PiCliResolver = createStandardCliResolverClass({
  providerId: 'pi',
  binaryName: 'pi',
  getProviderSettings: getPiProviderSettings,
});
