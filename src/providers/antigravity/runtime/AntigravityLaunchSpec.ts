export const ANTIGRAVITY_PROVIDER_ID = 'antigravity';
export const ANTIGRAVITY_BINARY_NAME = 'agy';

/**
 * Print-timeout default matching the A0-verified invocation shape
 * (`agy -p ... --output-format stream-json --print-timeout 30s`).
 */
export const DEFAULT_ANTIGRAVITY_PRINT_TIMEOUT = '30s';

/**
 * Flags the provider must never emit:
 * - `--dangerously-skip-permissions` bypasses the CLI's permission policy.
 * - `-c` / `--continue` resume the most recent conversation, which cross-talks
 *   between tabs. Resume only via an explicit `--conversation <id>`.
 */
export const ANTIGRAVITY_FORBIDDEN_FLAGS: readonly string[] = [
  '--dangerously-skip-permissions',
  '-c',
  '--continue',
];

/**
 * Docs-only/unverified (A0 2026-09-18):
 * - `print` — `agy -p <prompt> --output-format stream-json ...`, one process per
 *   turn; every piece verified live against agy 1.1.27. Default mode.
 * - `persistent-stdin` — `--input-format stream-json` multi-turn stdin. Only the
 *   init-before-input + clean-stdin-close behavior was observed; multi-turn
 *   emission is docs-only. Do not enable without fresh protocol evidence.
 */
export type AntigravityLaunchMode = 'print' | 'persistent-stdin';

export class AntigravityLaunchSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AntigravityLaunchSpecError';
  }
}

export class AntigravityCliMissingError extends Error {
  constructor() {
    super(
      'Antigravity CLI (agy) was not found. Install the official CLI or set the Antigravity CLI path in provider settings.',
    );
    this.name = 'AntigravityCliMissingError';
  }
}

export interface BuildAntigravityLaunchSpecParams {
  /** Resolved CLI path (e.g. from AntigravityCliResolver); blank means unresolved. */
  command: string;
  cwd: string;
  /** User prompt; required for print mode, forbidden for persistent-stdin mode. */
  prompt?: string;
  /** Conversation id extracted from a prior turn's own events; omit for a new session. */
  conversationId?: string | null;
  model?: string | null;
  printTimeout?: string | null;
  mode?: AntigravityLaunchMode;
  env?: NodeJS.ProcessEnv;
}

export interface AntigravityLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  mode: AntigravityLaunchMode;
  /** Conversation bound via `--conversation`, or null for a fresh session. */
  conversationId: string | null;
}

/**
 * Scans every argv token for forbidden flags. Runs over the final argument
 * array (fail-closed: even a prompt whose entire value equals a forbidden
 * token is rejected) before any spawn happens.
 */
export function assertNoForbiddenAntigravityFlags(args: readonly string[]): void {
  for (const arg of args) {
    const name = arg.split('=', 1)[0] ?? arg;
    if (ANTIGRAVITY_FORBIDDEN_FLAGS.includes(name)) {
      throw new AntigravityLaunchSpecError(`forbidden Antigravity flag in launch arguments: ${name}`);
    }
  }
}

/**
 * Converts the resolver's `null` result into a typed error at the launch
 * boundary. The shared `ProviderCliResolver` contract returns `null`; callers
 * that are about to launch should route through this helper.
 */
export function requireAntigravityCliPath(resolved: string | null | undefined): string {
  const trimmed = (resolved ?? '').trim();
  if (!trimmed) {
    throw new AntigravityCliMissingError();
  }
  return trimmed;
}

function requirePairedValue(value: string | null | undefined, label: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    throw new AntigravityLaunchSpecError(`Antigravity launch spec: ${label} is required`);
  }
  if (trimmed.startsWith('-')) {
    throw new AntigravityLaunchSpecError(`Antigravity launch spec: ${label} must not start with '-'`);
  }
  if (/\s/.test(trimmed)) {
    throw new AntigravityLaunchSpecError(`Antigravity launch spec: ${label} must not contain whitespace`);
  }
  return trimmed;
}

/**
 * Builds the launch specification for one Antigravity CLI invocation. Always
 * returns an argument array (never a shell command string) and never includes
 * permission-bypass or most-recent-conversation flags.
 */
export function buildAntigravityLaunchSpec(
  params: BuildAntigravityLaunchSpecParams,
): AntigravityLaunchSpec {
  const command = requireAntigravityCliPath(params.command);
  if (!params.cwd || !params.cwd.trim()) {
    throw new AntigravityLaunchSpecError('Antigravity launch spec: cwd is required');
  }

  const mode: AntigravityLaunchMode = params.mode ?? 'print';
  // `null`/`undefined` mean "fresh session"; an empty string is an explicit
  // but invalid binding and must fail loudly instead of silently starting a
  // new conversation.
  const conversationId = params.conversationId != null
    ? requirePairedValue(params.conversationId, 'conversationId')
    : null;
  const model = params.model
    ? requirePairedValue(params.model, 'model')
    : null;

  let args: string[];
  if (mode === 'persistent-stdin') {
    if (params.prompt !== undefined) {
      throw new AntigravityLaunchSpecError(
        'Antigravity launch spec: prompt is not supported in persistent-stdin mode',
      );
    }
    // Docs-only shape (A0 observed init emission + clean stdin close only).
    args = ['--input-format', 'stream-json', '--output-format', 'stream-json'];
  } else {
    const prompt = params.prompt ?? '';
    if (!prompt.trim()) {
      throw new AntigravityLaunchSpecError('Antigravity launch spec: prompt is required in print mode');
    }
    const printTimeout = params.printTimeout
      ? requirePairedValue(params.printTimeout, 'printTimeout')
      : DEFAULT_ANTIGRAVITY_PRINT_TIMEOUT;
    args = ['-p', prompt, '--output-format', 'stream-json', '--print-timeout', printTimeout];
  }

  if (conversationId) {
    args.push('--conversation', conversationId);
  }
  if (model) {
    args.push('--model', model);
  }

  assertNoForbiddenAntigravityFlags(args);

  return {
    args,
    command,
    cwd: params.cwd,
    env: params.env ?? process.env,
    mode,
    conversationId,
  };
}
