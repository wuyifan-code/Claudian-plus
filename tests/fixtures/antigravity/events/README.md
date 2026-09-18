# Antigravity event fixtures (task A2)

Offline protocol samples for `src/providers/antigravity/normalizations/**` and
`src/providers/antigravity/runtime/AntigravityTurnState.ts`. Every test that consumes these
fixtures is offline; no live model calls are made.

Provenance follows `.context/antigravity/compatibility.md` (A0 probe of the official `agy` CLI
**1.1.27** on Windows, 2026-09-18) and the sanitization rules used by `.context/antigravity/fixtures/`.

| File | Origin | Contents |
| --- | --- | --- |
| `turn1-ready.ndjson` | Verbatim copy of `.context/antigravity/fixtures/turn1-ready-stdout.txt` | Real successful turn: `init` → `user_input` → `agent_response` delta ("READY") + DONE fragment ("\n") → `result` (`response:"READY\n"`). Text dedupe group: delta-plus-final. |
| `turn2-resume.ndjson` | Verbatim copy of `.context/antigravity/fixtures/turn2-resume-stdout.txt` | Real resumed turn in the same conversation (step indexes continue at 2, `cache_read_tokens:24483`). Used for consecutive-turn isolation and usage pass-through. |
| `error-envelope.ndjson` | Verbatim copy of `.context/antigravity/fixtures/mock-unknown-model-stdout.txt` | json-format ERROR envelope with **no `event` field**; must be treated as a failed result, never as success. |
| `eof-before-completion.ndjson` | Verbatim copy of `.context/antigravity/fixtures/mock-no-result-stdout.txt` | `init` only, no result — exit 0 without a result is an incomplete result, not a success. |
| `only-final-text.ndjson` | Synthetic (zero conversation id `…a1`) | Text dedupe group: only-final-text. No `agent_response` steps at all; the result response is the only assistant text. |
| `multi-step-tools.ndjson` | Synthetic (`…a2`) | Text dedupe group: multiple assistant steps plus a `tool` step. `tool_info` uses the shape documented in the official headless docs (docs-only; no live tool sample exists). |
| `tool-failure.ndjson` | Synthetic (`…a3`) | Tool step completing with `tool_info.error` (`execution_error`); the turn still ends SUCCESS. |
| `permission-denied-exit0.ndjson` | Synthetic (`…a4`) | Docs-only soft-deny shape: `tool_info.error` with `permission_denied`, the run continues, and the process exits 0. The `permission_denied` type string is synthetic — no live denial was sampled. |
| `duplicate-terminal.ndjson` | Synthetic (`…a5`) | Two identical `result` events; the turn must settle exactly once. |
| `unknown-status.ndjson` | Synthetic (`…a6`) | Result with an undocumented `status` value ("PARKED"); must not be treated as success. |
| `malformed-result.ndjson` | Synthetic (`…b1`) | `result` event whose payload is missing `status`/`response`. |
| `malformed-step.ndjson` | Synthetic (`…b2`) | Malformed `step_update` payloads (string step_index, string payload) followed by valid events and a result. |
| `timeout.ndjson` | Synthetic (`…b3`) | Stream cut off mid-turn with no result; the timeout signal comes from the process layer, not the stream. |
| `cancel-race.ndjson` | Synthetic (`…b4`) | Events for a turn whose cancel request may race the terminal result. |
| `unknown-event.ndjson` | Synthetic (`…b5`) | An unknown event type between valid events; must be skipped without affecting the turn. |

Conversation ids in synthetic fixtures are `00000000-0000-4000-8000-0000000000xx` style placeholders;
real captured conversation ids are retained verbatim in the copied fixtures (opaque identifiers, kept
by A0 as session-binding evidence).
