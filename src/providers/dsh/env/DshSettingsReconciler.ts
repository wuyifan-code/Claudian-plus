import { createHash } from 'node:crypto';

import { getRuntimeEnvironmentVariables } from '../../../core/providers/providerEnvironment';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import { getDshProviderSettings, updateDshProviderSettings } from '../settings';

export const dshSettingsReconciler: ProviderSettingsReconciler = {
  handleEnvironmentChange(settings) {
    if (!getDshProviderSettings(settings).models.length) return false;
    updateDshProviderSettings(settings, { models: [] });
    return true;
  },

  // Native bindings survive configuration changes; the runtime checks their recorded home on resume.
  invalidateConversationSessions() { return []; },

  reconcileModelWithEnvironment(settings) {
    const home = getRuntimeEnvironmentVariables(settings, 'dsh').DSH_HOME ?? '';
    const fingerprint = home ? createHash('sha256').update(home).digest('hex') : '';
    if (getDshProviderSettings(settings).environmentHash === fingerprint) {
      return { changed: false, invalidatedConversations: [] };
    }
    updateDshProviderSettings(settings, { environmentHash: fingerprint });
    return { changed: true, invalidatedConversations: [] };
  },

  normalizeModelVariantSettings() { return false; },
};
