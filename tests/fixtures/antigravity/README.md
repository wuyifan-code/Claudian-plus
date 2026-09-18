# Antigravity launch fixtures (task A1a)

Provenance for the whole `tests/fixtures/antigravity/` tree: sanitized captures from the A0 probe
of the official `agy` CLI **1.1.27** on Windows, 2026-09-18. Raw captures and sanitization rules
live in the gitignored `.context/antigravity/` directory (`compatibility.md` §3/§8). No test under
`tests/` makes a live model call; everything here is captured or synthetic evidence for offline
assertions.

## Directory layout

| Path | Owner task | Contents |
| --- | --- | --- |
| `jsonl/` | A1b | Sanitized stream samples (stdout NDJSON) for the JSONL parser. |
| `README.md` (this file) | A1a | Version/provenance notes and the verified launch-argument shapes. |

## Verified launch-argument shapes (agy 1.1.27)

Built exclusively by `src/providers/antigravity/runtime/AntigravityLaunchSpec.ts` as argument
arrays (never shell strings). Flag order is semantically irrelevant; these are the canonical
orders, each matching a live capture recorded by A0:

| Turn | Arguments | Evidence |
| --- | --- | --- |
| Fresh print turn | `-p <prompt> --output-format stream-json --print-timeout 30s` (`--model <model>` optional) | `.context/antigravity/fixtures/turn1-ready-meta.json` — exit 0, one `result`, `status:"SUCCESS"`. |
| Resume print turn | fresh shape + `--conversation <id-from-prior-events>` | `.context/antigravity/fixtures/turn2-resume-meta.json` — init and result echo the requested id, `num_turns:2`. |
| Persistent startup (docs-only, off by default) | `--input-format stream-json --output-format stream-json` (`--model <model>` optional) | `.context/antigravity/fixtures/stdin-startup-meta.json` — init before any input, clean stdin close, no result. |

The `--print-timeout` default of `30s` matches the A0-verified invocation. Persistent-stdin
multi-turn emission is docs-only/unverified — the mode exists in the launch spec but must stay
off by default until re-verified.

## Hard invariants asserted by the mirrored tests

- Never `--dangerously-skip-permissions` (any `=` form included).
- Never `-c` / `--continue`; resume only by explicit `--conversation <id>`.
- Missing CLI path is a typed `AntigravityCliMissingError`, never a spawn attempt.
