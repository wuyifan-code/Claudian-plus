import { CachedCliResolver } from '../../../core/providers/CachedCliResolver';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { findCliBinaryPath, resolveConfiguredCliPath } from '../../../utils/cliBinaryLocator';
import { parseEnvironmentVariables } from '../../../utils/env';
import { getPiProviderSettings } from '../settings';

export class PiCliResolver extends CachedCliResolver {
  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const piSettings = getPiProviderSettings(settings);
    const cliPath = piSettings.cliPath.trim();
    const hostnamePath = (piSettings.cliPathsByHost[this.cachedHostname] ?? '').trim();
    const envText = getRuntimeEnvironmentText(settings, 'pi');

    return this.resolveMemoized(cliPath, hostnamePath, envText, () => (
      this.resolve(piSettings.cliPathsByHost, cliPath, envText)
    ));
  }

  resolve(
    hostnamePaths: Record<string, string> | undefined,
    legacyPath: string,
    envText = '',
  ): string | null {
    const hostnamePath = (hostnamePaths?.[this.cachedHostname] ?? '').trim();
    const customEnv = parseEnvironmentVariables(envText || '');
    return resolveConfiguredCliPath(hostnamePath)
      ?? resolveConfiguredCliPath(legacyPath.trim())
      ?? findCliBinaryPath('pi', customEnv.PATH);
  }
}
