import { getHostnameKey } from '../../utils/env';

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
