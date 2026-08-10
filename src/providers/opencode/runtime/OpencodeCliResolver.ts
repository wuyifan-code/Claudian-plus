import { CachedCliResolver } from '../../../core/providers/CachedCliResolver';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { findCliBinaryPath, resolveConfiguredCliPath } from '../../../utils/cliBinaryLocator';
import { parseEnvironmentVariables } from '../../../utils/env';
import { getOpencodeProviderSettings } from '../settings';

export class OpencodeCliResolver extends CachedCliResolver {
  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const opencodeSettings = getOpencodeProviderSettings(settings);
    const cliPath = opencodeSettings.cliPath.trim();
    const hostnamePath = (opencodeSettings.cliPathsByHost[this.cachedHostname] ?? '').trim();
    const envText = getRuntimeEnvironmentText(settings, 'opencode');

    return this.resolveMemoized(cliPath, hostnamePath, envText, () => (
      this.resolve(opencodeSettings.cliPathsByHost, cliPath, envText)
    ));
  }

  resolve(
    hostnamePaths: Record<string, string> | undefined,
    legacyPath: string,
    envText: string,
  ): string | null {
    const hostnamePath = (hostnamePaths?.[this.cachedHostname] ?? '').trim();
    const customEnv = parseEnvironmentVariables(envText || '');
    return resolveConfiguredCliPath(hostnamePath)
      ?? resolveConfiguredCliPath(legacyPath.trim())
      ?? findCliBinaryPath('opencode', customEnv.PATH);
  }
}
