# Antigravity JSONL parser fixtures (task A1b)

Offline protocol samples for `src/providers/antigravity/runtime/AntigravityJsonl.ts` and its
mirrored test. Provenance: sanitized captures from the A0 probe of the official `agy` CLI
**1.1.27** on Windows, 2026-09-18 (see `.context/antigravity/compatibility.md` §3/§8 for the
capture record and the sanitization rules). No live model calls are made by any test here.

| File | Origin | Contents |
| --- | --- | --- |
| `turn1-ready.ndjson` | Verbatim copy of `.context/antigravity/fixtures/turn1-ready-stdout.txt` | Full successful turn: `init` → 3×`step_update` → `result` (`status:"SUCCESS"`, `response:"READY\n"`). |
| `stdin-startup.ndjson` | Verbatim copy of `.context/antigravity/fixtures/stdin-startup-stdout.txt` | Persistent-mode startup: single `init` event, no result. |
| `error-envelope.ndjson` | Verbatim copy of `.context/antigravity/fixtures/mock-unknown-model-stdout.txt` | json-format ERROR envelope with **no `event` field** — must pass through as a parsed record; event semantics are not the parser's concern. |
| `malformed.ndjson` | Rebuilt without trailing newline (same content as the capture) | Truncated JSON line — must yield a parse-error record, never a fabricated record. |
| `synthetic-unicode.ndjson` | Synthetic (clearly marked zero conversation id / `future_event`) | Multibyte UTF-8 payload and an unknown event type for pass-through coverage. |

The parser validates JSON syntax and the top-level object shape only. It must not interpret
`event` types or required fields — that is task A2 (`normalizations/**`, `AntigravityTurnState.ts`).
