import { Notice } from 'obsidian';

import { t } from '../../i18n/i18n';
import { buildDiagnosticsReport, writeClipboard } from './diagnostics';
import {
  FEEDBACK_BUFFER_LIMIT,
  FEEDBACK_DEDUPE_MS,
  type FeedbackAction,
  type FeedbackEmitInput,
  type FeedbackEntry,
  type FeedbackState,
  type FeedbackSugarOptions,
} from './types';

/** A rendered surface for feedback. `FeedbackHost` implements this. */
export interface FeedbackSink {
  render(state: FeedbackState): void;
  openLog(): void;
}

export interface FeedbackBusConfig {
  /** Opens the Obsidian settings tab; injected by `main.ts` so `shared/` stays host-agnostic. */
  openSettings?: (tabId?: string) => void;
  /** Extra rows for the diagnostics header (version, locale, theme, ...). */
  env?: () => Record<string, string>;
}

/**
 * In-memory feedback log.
 *
 * The bus is the single source of truth: call sites emit, hosts render. When no
 * host is mounted (plugin startup, the command palette, the settings surface)
 * the newest entry falls back to a `Notice` once per de-duplication window, so
 * behaviour degrades to 3.2.6 instead of going silent.
 */
export class FeedbackBus {
  private entries: FeedbackEntry[] = [];
  private readonly listeners = new Set<(state: FeedbackState) => void>();
  private readonly sinks: FeedbackSink[] = [];
  private lastReadAt = 0;
  private sequence = 0;
  private config: FeedbackBusConfig = {};

  configure(config: FeedbackBusConfig): void {
    this.config = config;
  }

  getConfig(): FeedbackBusConfig {
    return this.config;
  }

  /** Registers a rendered host. Returns the unregister callback. */
  registerSink(sink: FeedbackSink): () => void {
    this.sinks.push(sink);
    sink.render(this.snapshot());
    return () => {
      const index = this.sinks.indexOf(sink);
      if (index >= 0) this.sinks.splice(index, 1);
    };
  }

  getState(): FeedbackState {
    return this.snapshot();
  }

  emit(input: FeedbackEmitInput): void {
    const now = Date.now();
    const dedupeMs = input.dedupeMs ?? FEEDBACK_DEDUPE_MS;
    const index = this.entries.findIndex(
      entry => entry.key === input.key && now - entry.at < dedupeMs,
    );

    let entry: FeedbackEntry;
    if (index >= 0) {
      const previous = this.entries[index];
      entry = {
        ...previous,
        level: input.level,
        kind: input.kind,
        title: input.title,
        detail: input.detail ?? previous.detail,
        actions: input.actions ?? previous.actions,
        count: previous.count + 1,
        at: now,
      };
      this.entries.splice(index, 1);
    } else {
      this.sequence += 1;
      entry = {
        id: `fb-${now.toString(36)}-${this.sequence.toString(36)}`,
        level: input.level,
        kind: input.kind,
        key: input.key,
        title: input.title,
        detail: input.detail,
        actions: input.actions,
        scope: input.scope,
        count: 1,
        at: now,
      };
    }

    this.entries.unshift(entry);
    if (this.entries.length > FEEDBACK_BUFFER_LIMIT) {
      this.entries.length = FEEDBACK_BUFFER_LIMIT;
    }

    const isFirstOccurrence = entry.count === 1;
    if (this.sinks.length === 0 && isFirstOccurrence) {
      this.showFallback(entry);
    }

    this.publish();
  }

  /** Acknowledgement. Auto-dismisses unless it carries actions. */
  info(key: string, title: string, options: FeedbackSugarOptions = {}): void {
    this.emit({ ...this.baseInput(key, title, options), level: 'info', kind: 'info' });
  }

  success(key: string, title: string, options: FeedbackSugarOptions = {}): void {
    this.emit({ ...this.baseInput(key, title, options), level: 'success', kind: 'info' });
  }

  /** A failure the user can re-run. Always carries a retry action. */
  retryable(
    key: string,
    title: string,
    retry: () => void | Promise<void>,
    options: FeedbackSugarOptions = {},
  ): void {
    this.emit({
      ...this.baseInput(key, title, options),
      level: 'error',
      kind: 'retryable',
      actions: this.withRetryAction(retry, options.actions),
    });
  }

  /** A failure caused by configuration, permissions, or a provider capability. */
  blocked(key: string, title: string, options: FeedbackSugarOptions = {}): void {
    this.emit({
      ...this.baseInput(key, title, options),
      level: 'error',
      kind: 'blocked',
      actions: this.withSettingsAction(options.actions),
    });
  }

  subscribe(listener: (state: FeedbackState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Marks everything read and opens the drawer on the most recently mounted host. */
  openLog(): void {
    this.lastReadAt = Date.now();
    this.publish();
    this.sinks[this.sinks.length - 1]?.openLog();
  }

  clear(): void {
    this.entries = [];
    this.lastReadAt = Date.now();
    this.publish();
  }

  async copyDiagnostics(): Promise<string> {
    const report = buildDiagnosticsReport({
      entries: this.entries,
      env: this.config.env?.() ?? {},
    });
    const copied = await writeClipboard(report);
    if (copied) {
      this.success('feedback.diagnostics.copied', t('feedback.diagnosticsCopied'));
    } else {
      this.blocked('feedback.diagnostics.failed', t('feedback.diagnosticsFailed'));
    }
    return report;
  }

  private baseInput(
    key: string,
    title: string,
    options: FeedbackSugarOptions,
  ): Pick<FeedbackEmitInput, 'key' | 'title' | 'scope' | 'detail' | 'actions' | 'dedupeMs'> {
    return {
      key,
      title,
      scope: options.scope ?? 'chat',
      detail: options.detail,
      actions: options.actions,
      dedupeMs: options.dedupeMs,
    };
  }

  private withRetryAction(
    retry: () => void | Promise<void>,
    existing: FeedbackAction[] = [],
  ): FeedbackAction[] {
    if (existing.some(action => action.id === 'retry')) return existing;
    return [...existing, { id: 'retry', label: t('feedback.actionRetry'), run: retry }];
  }

  private withSettingsAction(existing: FeedbackAction[] = []): FeedbackAction[] {
    const openSettings = this.config.openSettings;
    if (!openSettings || existing.some(action => action.id === 'open-settings')) {
      return existing;
    }
    return [
      ...existing,
      { id: 'open-settings', label: t('feedback.actionOpenSettings'), run: () => openSettings() },
    ];
  }

  private showFallback(entry: FeedbackEntry): void {
    new Notice(entry.detail ? `${entry.title}\n${entry.detail}` : entry.title);
  }

  private snapshot(): FeedbackState {
    return {
      entries: [...this.entries],
      unread: this.entries.filter(entry => entry.at > this.lastReadAt).length,
    };
  }

  private publish(): void {
    const state = this.snapshot();
    for (const sink of [...this.sinks]) {
      sink.render(state);
    }
    for (const listener of [...this.listeners]) {
      listener(state);
    }
  }
}

/** Process-wide bus. Call sites import this; tests construct their own instance. */
export const feedbackBus = new FeedbackBus();
