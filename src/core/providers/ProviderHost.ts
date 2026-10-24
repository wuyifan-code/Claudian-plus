import type { App } from 'obsidian';

import type { SharedAppStorage } from '../bootstrap/storage';
import type { ObsidianToolBridgeHandle } from '../obsidian';
import type { ChatRuntime } from '../runtime/ChatRuntime';
import type { ClaudianPlusSettings } from '../types';
import type { EnvironmentScope } from '../types/settings';
import type { ProviderCliResolutionContext, ProviderId } from './types';

/**
 * Application capabilities available to provider adapters.
 *
 * The host deliberately excludes plugin lifecycle, command registration, and
 * conversation ownership. Providers receive only the settings, environment,
 * path, CLI, storage, and interaction capabilities they currently consume.
 */
export interface ProviderHost {
  readonly app: App;
  readonly settings: ClaudianPlusSettings;
  readonly storage: SharedAppStorage;
  readonly manifest?: { version?: string };

  saveSettings(): Promise<void>;
  mutateSettings(
    mutation: (settings: ClaudianPlusSettings) => void | Promise<void>,
  ): Promise<void>;
  mutateSettingsConditionally(
    mutation: (settings: ClaudianPlusSettings) => boolean | Promise<boolean>,
  ): Promise<void>;
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
  normalizeModelVariantSettings(): boolean;

  getActiveEnvironmentVariables(providerId: ProviderId): string;
  getEnvironmentVariablesForScope(scope: EnvironmentScope): string;
  applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void>;
  applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void>;
  getResolvedProviderCliPath(
    providerId: ProviderId,
    context?: ProviderCliResolutionContext,
  ): Promise<string | null>;

  /**
   * Get the memory injection text for system prompt, or null if disabled/empty.
   * The optional prompt is the current user message and drives retrieval.
   */
  getMemoryInjectionText(userPrompt?: string): Promise<string | null>;

  /** Get the consciousness injection text for system prompt, or null if disabled. */
  getConsciousnessInjectionText(): Promise<string | null>;

  /**
   * Get the response-format instructions (generative UI) for this turn, or null
   * when the capability is off.
   *
   * Providers without a system-prompt slot inject this per turn instead, so it
   * lives on the host contract rather than in a single provider.
   */
  getResponseFormatInjectionText?(): Promise<string | null>;

  /** Start the loopback native Obsidian bridge for external providers, when available. */
  ensureObsidianToolBridge?(): Promise<ObsidianToolBridgeHandle>;

  refreshModelSelectors?(): void;
  broadcastToActiveViewRuntimes?(
    action: (runtime: ChatRuntime) => Promise<void> | void,
  ): Promise<void>;
  broadcastToAllViewRuntimes?(
    action: (runtime: ChatRuntime) => Promise<void> | void,
  ): Promise<void>;
  recycleProviderRuntimes?(providerId: ProviderId): Promise<void>;
}
