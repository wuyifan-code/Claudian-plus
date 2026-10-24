import type { App, EventRef } from 'obsidian';

/**
 * Idle observation: while the user is away from the keyboard, vault activity
 * (file opens, leaf switches, edits) keeps accumulating. After a sustained
 * idle window with enough accumulated activity, the observer emits one
 * summary that the caller turns into a V2 memory episode.
 *
 * The observer never talks to a model and never notifies the user; its only
 * output is the callback, which the plugin gates behind the consciousness
 * opt-in and the auxiliary request policy.
 */

export interface IdleActivityObserverOptions {
  app: App;
  onIdleObservation: (summary: string) => void;
  /** Idle threshold in ms before an observation fires. Default 15 minutes. */
  idleThresholdMs?: number;
  /** Minimum distinct touched files before an observation fires. Default 2. */
  minTouchedFiles?: number;
  /** Poll cadence in ms. Default 60 seconds. */
  checkIntervalMs?: number;
  /** Extra kill-switch consulted before emitting. */
  isEnabled?: () => boolean;
  /** Clock injection for tests. */
  now?: () => number;
}

interface FileActivity {
  path: string;
  opens: number;
  edits: number;
  lastAt: number;
}

export class IdleActivityObserver {
  private readonly app: App;
  private readonly onIdleObservation: (summary: string) => void;
  private readonly idleThresholdMs: number;
  private readonly minTouchedFiles: number;
  private readonly checkIntervalMs: number;
  private readonly isEnabled?: () => boolean;
  private readonly now: () => number;

  private readonly activity = new Map<string, FileActivity>();
  private lastActivityAt: number;
  private intervalId: number | null = null;
  private readonly eventRefs: EventRef[] = [];

  constructor(options: IdleActivityObserverOptions) {
    this.app = options.app;
    this.onIdleObservation = options.onIdleObservation;
    this.idleThresholdMs = options.idleThresholdMs ?? 15 * 60 * 1000;
    this.minTouchedFiles = options.minTouchedFiles ?? 2;
    this.checkIntervalMs = options.checkIntervalMs ?? 60 * 1000;
    this.isEnabled = options.isEnabled;
    this.now = options.now ?? (() => Date.now());
    this.lastActivityAt = this.now();
  }

  start(): void {
    if (this.intervalId !== null) return;
    this.eventRefs.push(
      this.app.workspace.on('active-leaf-change', () => this.noteActivity(null)),
      this.app.workspace.on('file-open', (file) => this.noteActivity(file?.path ?? null)),
    );
    this.app.vault.on('modify', (file) => this.noteActivity(file.path, true));
    this.intervalId = window.setInterval(() => this.check(), this.checkIntervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    for (const ref of this.eventRefs) {
      this.app.workspace.offref(ref);
    }
    this.eventRefs.length = 0;
    this.activity.clear();
  }

  /** Number of distinct files touched since the last emission (for tests). */
  touchedFileCount(): number {
    return this.activity.size;
  }

  private noteActivity(path: string | null, isEdit = false): void {
    const now = this.now();
    this.lastActivityAt = now;
    if (!path) return;
    const existing = this.activity.get(path) ?? { path, opens: 0, edits: 0, lastAt: now };
    if (isEdit) {
      existing.edits += 1;
    } else {
      existing.opens += 1;
    }
    existing.lastAt = now;
    this.activity.set(path, existing);
  }

  private check(): void {
    if (this.isEnabled && !this.isEnabled()) {
      this.activity.clear();
      return;
    }
    const now = this.now();
    if (now - this.lastActivityAt < this.idleThresholdMs) return;
    if (this.activity.size < this.minTouchedFiles) return;

    const files = Array.from(this.activity.values()).sort((a, b) => b.lastAt - a.lastAt);
    const windowStart = new Date(Math.min(...files.map((f) => f.lastAt)));
    const parts = files.slice(0, 10).map((f) => {
      const verb = f.edits > 0 ? (f.edits > 1 ? `edited ${f.edits}x` : 'edited') : 'read';
      return `${f.path} (${verb})`;
    });
    const summary = [
      `From ${windowStart.toLocaleTimeString()} to ${new Date(this.lastActivityAt).toLocaleTimeString()}, the user worked on:`,
      ...parts.map((p) => `- ${p}`),
    ].join('\n');

    // Reset before emitting so a slow consumer cannot cause duplicate fires.
    this.activity.clear();
    this.lastActivityAt = now;
    try {
      this.onIdleObservation(summary);
    } catch {
      // Consumer errors must not kill the observer loop.
    }
  }
}
