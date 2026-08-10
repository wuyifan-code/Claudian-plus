import { CachedCliResolver } from '../../../core/providers/CachedCliResolver';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../../core/types/settings';
import { resolveConfiguredCliPath } from '../../../utils/cliBinaryLocator';
import { parseEnvironmentVariables } from '../../../utils/env';
import { findClaudeCLIPath } from '../cli/findClaudeCLIPath';
import { getClaudeProviderSettings } from '../settings';

export class ClaudeCliResolver extends CachedCliResolver {
  /**
   * Resolves CLI path with priority: device-specific -> legacy -> auto-detect.
   * @param settings Full app settings bag
   */
  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const claudeSettings = getClaudeProviderSettings(settings);
    const hostnamePath = (claudeSettings.cliPathsByHost[this.cachedHostname] ?? '').trim();
    const normalizedLegacy = claudeSettings.cliPath.trim();
    const normalizedEnv = getRuntimeEnvironmentText(settings, 'claude');

    return this.resolveMemoized(hostnamePath, normalizedLegacy, normalizedEnv, () => (
      resolveClaudeCliPath(hostnamePath, normalizedLegacy, normalizedEnv)
    ));
  }

  resolve(
    hostnamePaths: HostnameCliPaths | undefined,
    legacyPath: string | undefined,
    envText: string,
  ): string | null {
    return this.resolveFromSettings({
      sharedEnvironmentVariables: envText,
      providerConfigs: {
        claude: {
          cliPath: legacyPath ?? '',
          cliPathsByHost: hostnamePaths ?? {},
        },
      },
    });
  }
}

export function resolveClaudeCliPath(
  hostnamePath: string | undefined,
  legacyPath: string | undefined,
  envText: string,
): string | null {
  return (
    resolveConfiguredCliPath(hostnamePath) ??
    resolveConfiguredCliPath(legacyPath) ??
    findClaudeCLIPath(parseEnvironmentVariables(envText || '').PATH)
  );
}
