import { CachedCliResolver } from '../../../core/providers/CachedCliResolver';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { findCliBinaryPath, resolveConfiguredCliPath } from '../../../utils/cliBinaryLocator';
import { parseEnvironmentVariables } from '../../../utils/env';
import { getDshProviderSettings } from '../settings';

export class DshCliResolver extends CachedCliResolver {
  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const dshSettings = getDshProviderSettings(settings);
    const cliPath = dshSettings.cliPath.trim();
    const hostnamePath = (dshSettings.cliPathsByHost[this.cachedHostname] ?? '').trim();
    const envText = getRuntimeEnvironmentText(settings, 'dsh');

    return this.resolveMemoized(cliPath, hostnamePath, envText, () => (
      this.resolve(dshSettings.cliPathsByHost, cliPath, envText)
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
      ?? findCliBinaryPath('dsh', customEnv.PATH);
  }
}
