import { findCliBinaryPath, resolveConfiguredCliPath } from '../../utils/cliBinaryLocator';
import { getHostnameKey } from '../../utils/env';
import { parseEnvironmentVariables } from '../../utils/env';
import { getRuntimeEnvironmentText } from './providerEnvironment';

/**
 * Configuration for the shared standard CLI resolver. Providers that only vary
 * by id, binary name, and settings getter share one implementation.
 */
export interface StandardCliResolverConfig {
  providerId: string;
  binaryName: string;
  getProviderSettings: (settings: Record<string, unknown>) => {
    cliPath: string;
    cliPathsByHost: Record<string, string>;
  };
}

/**
 * Builds a concrete CachedCliResolver class for a provider. The returned
 * constructor is exported under the provider's own name so `new XxxCliResolver()`
 * call sites stay unchanged.
 */
export function createStandardCliResolverClass(
  config: StandardCliResolverConfig,
): new () => CachedCliResolver & {
  resolveFromSettings(settings: Record<string, unknown>): string | null;
  resolve(
    hostnamePaths: Record<string, string> | undefined,
    legacyPath: string,
    envText?: string,
  ): string | null;
} {
  const { providerId, binaryName, getProviderSettings } = config;

  return class extends CachedCliResolver {
    resolveFromSettings(settings: Record<string, unknown>): string | null {
      const providerSettings = getProviderSettings(settings);
      const cliPath = providerSettings.cliPath.trim();
      const hostnamePath = (providerSettings.cliPathsByHost[this.cachedHostname] ?? '').trim();
      const envText = getRuntimeEnvironmentText(settings, providerId);

      return this.resolveMemoized(cliPath, hostnamePath, envText, () => (
        this.resolve(providerSettings.cliPathsByHost, cliPath, envText)
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
        ?? findCliBinaryPath(binaryName, customEnv.PATH);
    }
  };
}
/**
 * Shared memoization for provider CLI resolvers.
 *
 * Subclasses extract the hostname-scoped CLI path, legacy path, and provider
 * environment text from settings, then delegate the actual lookup to their own
 * provider-specific resolution.
 */
export abstract class CachedCliResolver {
  protected readonly cachedHostname = getHostnameKey();
  protected lastCliPath = '';
  protected lastHostnamePath = '';
  protected lastEnvText = '';
  protected resolvedPath: string | null = null;

  protected resolveMemoized(
    cliPath: string,
    hostnamePath: string,
    envText: string,
    resolve: () => string | null,
  ): string | null {
    if (
      this.resolvedPath !== null
      && cliPath === this.lastCliPath
      && hostnamePath === this.lastHostnamePath
      && envText === this.lastEnvText
    ) {
      return this.resolvedPath;
    }

    this.lastCliPath = cliPath;
    this.lastHostnamePath = hostnamePath;
    this.lastEnvText = envText;
    this.resolvedPath = resolve();
    return this.resolvedPath;
  }

  reset(): void {
    this.lastCliPath = '';
    this.lastHostnamePath = '';
    this.lastEnvText = '';
    this.resolvedPath = null;
  }
}
