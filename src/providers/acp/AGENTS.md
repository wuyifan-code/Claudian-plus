# ACP Shared Layer

`src/providers/acp/` is the shared Agent Client Protocol layer consumed by the OpenCode, Kimi, and DSH providers. It is provider-neutral protocol plumbing, not a provider itself.

## Ownership

- ACP transport (`AcpClientConnection`, `AcpJsonRpcTransport`, `AcpSubprocess`), session update normalization (`AcpSessionUpdateNormalizer`), session config, usage info, and permission mapping live here.
- Shared prompt assembly (`buildAcpPrompt`) and permission presentation (`permissionPresentation`) live here because they operate on ACP content-block types.

## Rules

- The ACP-based providers should reuse the shared builders here instead of duplicating protocol glue.
- Provider-specific behavior (tool-name maps, settings schemas, model id encoding) stays in the owning provider directory and is injected into shared builders via config.
