# Kimi Provider

`src/providers/kimi/` adapts Kimi through Agent Client Protocol over a kimi ACP subprocess. It shares the ACP plumbing with the OpenCode and DSH providers through `src/providers/acp/`.

## Ownership

- Runtime process management, prompt encoding (via `acp/buildAcpPrompt`), stream normalization, model discovery, command discovery, settings UI, and Kimi-specific settings reconciliation live here.
- Shared ACP behavior lives in `src/providers/acp/`; keep provider-specific deltas in this directory.

## Protocol Rules

- Live output comes from ACP session notifications normalized through `AcpSessionUpdateNormalizer` plus Kimi tool normalization.
- CLI resolution is the shared standard resolver (`core/providers/CachedCliResolver`); only provider id, binary name, and settings getter are Kimi-specific.
- Runtime commands come from the Kimi session and are read-only from Claudian Plus (not editable or deletable).

## Gotchas

- The Kimi model selection id may carry a `,thinking` suffix; the suffix is part of the selection, not a separate effort setting.
- `KimiAuxQueryRunner` owns its own process and is independent from the chat runtime.
- Environment keys that affect Kimi data or config invalidate existing Kimi sessions (`KIMI_CONFIG`, `KIMI_HOME`, `KIMI_DATA_DIR`, `XDG_DATA_HOME`).
