import { CachedCliResolver } from '../../../core/providers/CachedCliResolver';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { findCliBinaryPath, resolveConfiguredCliPath } from '../../../utils/cliBinaryLocator';
import { parseEnvironmentVariables } from '../../../utils/env';
import { getKimiProviderSettings } from '../settings';

export class KimiCliResolver extends CachedCliResolver {
  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const kimiSettings = getKimiProviderSettings(settings);
    const cliPath = kimiSettings.cliPath.trim();
    const hostnamePath = (kimiSettings.cliPathsByHost[this.cachedHostname] ?? '').trim();
    const envText = getRuntimeEnvironmentText(settings, 'kimi');

    return this.resolveMemoized(cliPath, hostnamePath, envText, () => (
      this.resolve(kimiSettings.cliPathsByHost, cliPath, envText)
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
      ?? findCliBinaryPath('kimi', customEnv.PATH);
  }
}
