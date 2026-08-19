# DSH Provider

`src/providers/dsh/` adapts DeepSeek Harness (DSH) through Agent Client Protocol over a dsh ACP subprocess. It shares the ACP plumbing with the OpenCode and Kimi providers through `src/providers/acp/`.

## Ownership

- Runtime process management, prompt encoding (via `acp/buildAcpPrompt`), stream normalization, model discovery, command discovery, settings UI, and DSH-specific settings reconciliation live here.
- Shared ACP behavior lives in `src/providers/acp/`; keep provider-specific deltas in this directory.

## Protocol Rules

- Live output comes from ACP session notifications normalized through `AcpSessionUpdateNormalizer` plus DSH tool normalization.
- CLI resolution is the shared standard resolver (`core/providers/CachedCliResolver`); only provider id, binary name, and settings getter are DSH-specific.
- The permission presentation mapper uses the extended tool cases (workflow/goal/subagent).

## Gotchas

- `DshAuxQueryRunner` owns its own process and is independent from the chat runtime.
- Environment keys that affect DSH data or config invalidate existing DSH sessions (`DSH_HOME`, `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`).
