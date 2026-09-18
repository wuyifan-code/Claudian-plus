# Antigravity Provider

`src/providers/antigravity/` adapts the official Antigravity CLI (`agy`) through its headless
stream-json stdio interface. The provider is registered as a built-in module (`registration.ts`)
and is disabled by default; it is never the default chat provider.

## Ownership

| Module | Owns |
| --- | --- |
| `runtime/AntigravityLaunchSpec.ts` | The only place launch arguments are built. Provider/binary identity constants, forbidden-flag guard, typed launch errors. |
| `runtime/AntigravityCliResolver.ts` | CLI path resolution via the shared standard resolver over `providerConfigs.antigravity` (host path → legacy `cliPath` → `PATH` lookup for `agy`). |
| `runtime/AntigravitySubprocess.ts` | Thin `SubprocessRunner` subclass; enforces launch-safety invariants before spawn, owns no process management. |
| `runtime/AntigravityJsonl.ts` | Offline-safe JSONL stream decoding/parse records (task A1b). |
| `normalizations/antigravityEventNormalization.ts` | Turns a parsed stream-json record into provider-neutral `StreamChunk` values; owns the text-accumulation and response-dedupe rules (task A2). |
| `normalizations/antigravityToolNormalization.ts` | Stable tool keys (session + turn + step) and runtime-checked `tool_info` reading (task A2). |
| `runtime/AntigravityTurnState.ts` | Single-turn state machine with process phase kept separate; settles a turn exactly once and rejects foreign-session events (task A2). |
| `runtime/AntigravityChatRuntime.ts` | Per-turn print-mode runtime, one instance per tab/session; also wires the A4 replay cache and exposes `createAntigravityChatRuntime(plugin)`, the only production construction path. |
| `history/` | Provider-owned replay cache (`AntigravityHistoryStore` file mechanics, `AntigravityConversationHistoryService` public API). Never reads or writes the native `~/.gemini/antigravity-cli/` state (task A4). |
| `auxiliary/` | `AntigravityTitleGenerationService` (local, model-free titles) and `AntigravityInstructionRefineService` (explicitly unavailable). |
| `registration.ts` | Provider module assembly: runtime factory, auxiliary services, the history service, settings storage adapter, and the capability statement. |
| `capabilities.ts` | Shipped capabilities, re-exporting the frozen conservative constant from `types.ts`. |
| `settings.ts` | Persisted provider settings: `enabled` (false by default), per-host CLI path, timeout, manual model id, diagnostics refresh token, last failure record (task A5a). |
| `lastFailure.ts` | The bounded failure vocabulary (`cli-missing`, `spawn-failed`, `init-failed`, `timeout`, `malformed-stream`), the create/normalize pair, and the redaction of a failure detail. At most one record exists; it is overwritten in place. |
| `diagnostics/` | Pure redaction and the diagnostics snapshot: `antigravityRedaction.ts` (secret/email/path/free-form stripping) and `redactAntigravityDiagnostics.ts` (whitelist projection + copyable JSON report). Neither resolves, spawns, or issues a model request. |
| `models.ts` | Model-selection encoding and capability statements that stay conservative until verified (task A5a). |
| `env/AntigravitySettingsReconciler.ts` | Provider-owned settings reconciliation; merges, never clobbers, and holds no credential keys (task A5a). |
| `ui/AntigravityChatUIConfig.ts` | Chat UI projection: model options from the manual model id only, no permission/plan/skills/MCP/image entry points. |
| `ui/AntigravitySettingsTab.ts` | Provider settings tab: enable toggle, per-host CLI path, manual model id, timeout, last failure reason (read-only), local-only diagnostics refresh, and a redacted snapshot copy. Must never spawn the CLI or issue a model request. |
| `app/AntigravityWorkspaceServices.ts` | Workspace services: CLI resolver plus settings-tab renderer only; unsupported services stay omitted rather than stubbed. |
| `.context/antigravity/` (gitignored) | A0 evidence: probe harness, raw captures, sanitized fixtures, `compatibility.md` protocol report. |

Shared code must consume Antigravity behavior through `ChatRuntime`, provider capabilities, and
workspace-service contracts; nothing outside this directory may build `agy` argument arrays.

## Protocol Facts (A0 probe, 2026-09-18, agy 1.1.27, Windows)

**Verified live** (sanitized samples: `tests/fixtures/antigravity/jsonl/`):

- `agy -p "<prompt>" --output-format stream-json --print-timeout 30s` emits NDJSON on stdout:
  `init` → `step_update*` → exactly one `result`; exit 0 on success.
- Resume by explicit `--conversation <id>` — the id is extracted from a prior turn's own events,
  never hand-crafted — is verified: `init` and `result` echo the requested id and `num_turns` is
  cumulative.
- Text accumulation rule: concatenate every `agent_response` `text_delta` in stream order.
- Killing the process (win32 `SIGTERM` = TerminateProcess) terminates cleanly for tool-less turns.

**Docs-only / unverified — do not enable without fresh protocol evidence:**

- `--input-format stream-json` multi-turn stdin emission. Exposed as
  `buildAntigravityLaunchSpec({ mode: 'persistent-stdin' })` but **off by default**; A0 observed
  only init-before-input plus a clean stdin close, not a second turn.
- Headless permission policy details, the stderr format of soft-denied tools, in-protocol
  cancellation, `--mode plan` / `--effort` / structured output semantics, and the unknown-model /
  auth-error shapes.
- No public ACP entry point was found in `agy --help`; this is recorded as **unverified, not
  absent**. Do not add `--acp` or reuse `src/providers/acp/` on that basis.

## Safety Rules

- Never pass `--dangerously-skip-permissions` in any form; `assertNoForbiddenAntigravityFlags`
  rejects it in the launch spec and again at subprocess construction.
- Never use `-c` / `--continue` (also guarded): they resume the most recent conversation and would
  cross-talk between tabs. Resume only via an explicit `--conversation <id>`.
- Launch arguments are always an argument array; never build a shell command string.
- Never read or write credential/token files, and never touch the native
  `~/.gemini/antigravity-cli/` state (its conversation `.db` format is not a contract).

## Conventions

- Every production runtime comes from `createAntigravityChatRuntime(plugin)`, which wires the A4
  replay cache; constructing `new AntigravityChatRuntime(...)` directly records no history and is
  for offline tests only. A turn's replay records are durable before its `done` chunk is emitted.
- Replay cache turn indices continue after the highest index already on disk, so a restarted
  runtime appends instead of replacing an earlier turn. `describeHistoryAvailability` surfaces
  partial history (bound CLI session, missing cache) as a warning notice; earlier messages are never
  re-encoded into the prompt.
- Subprocess behavior (windowsHide, Windows `.cmd` shims, bounded stderr snapshot,
  SIGTERM → SIGKILL escalation) comes from `core/runtime/SubprocessRunner`. Do not duplicate
  process management here.
- A missing CLI path surfaces as `AntigravityCliMissingError` at the launch boundary
  (`requireAntigravityCliPath`); the resolver itself returns `null` per the shared
  `ProviderCliResolver` contract.
- The runtime records the last startup failure through `recordAntigravityLastFailure` (settings bag,
  single entry, overwritten). Recording is best-effort: a failed settings write is swallowed rather
  than failing the turn. The tab only reads and displays the record — it never probes the CLI to
  explain a failure.
- Diagnostics text always passes through `redactAntigravityText` before it is persisted or copied:
  secrets, emails, absolute paths (including home directories) are replaced, and free-form prose is
  dropped whole, so prompt content can never enter a recorded failure or an exported snapshot. The
  snapshot is a whitelist projection, so an unknown field is dropped rather than redacted.
- `extractAntigravityCliSettings` reads the raw `providerConfigs.antigravity` projection; when the
  provider settings module (A5a) lands, delegate it to the normalized settings getter.
- Offline tests must make zero live model calls. Launch-shape evidence lives in
  `tests/fixtures/antigravity/README.md`; protocol samples live in `tests/fixtures/antigravity/jsonl/`.
