# Claudian Plus

[![GitHub release](https://img.shields.io/github/v/release/wuyifan-code/Claudian-plus)](https://github.com/wuyifan-code/Claudian-plus/releases)
[![License](https://img.shields.io/github/license/wuyifan-code/Claudian-plus)](LICENSE)
[![Obsidian](https://img.shields.io/badge/Obsidian-desktop-purple)](https://obsidian.md)

[简体中文](README_ZH.md)

Claudian Plus is a Codex-first AI workspace for Obsidian. It keeps conversations, provider sessions, local memory, and vault context in your vault while supporting Codex, Claude, OpenCode, and Pi as separate provider runtimes.

## What is included

- Multi-tab conversations with search, restore, fork, rewind, provider-native history, and a floating conversation outline.
- Codex as the default provider, with model discovery and a default preference for `gpt-5.6-sol` when available.
- Local memory and awareness files, opt-in automatic memory extraction, and periodic source-backed vault reviews with recurring-topic, open-loop, and link-activity signals.
- Persistent local vault retrieval with incremental invalidation, `/vault-search`, `/insight`, source previews, and automatic context injection.
- Obsidian-native context: `@note`, `@folder`, drag-and-drop files, image attachments, editor selection actions, and File Explorer actions.
- Provider-native Obsidian tools for Canvas, Properties, links, graph neighbors, and read-only Dataview queries. Canvas selections also have a right-click **Suggest neighboring notes** panel with direction, source notes, open, and explicit link-insert actions. Codex and Claude use in-process Obsidian adapters; OpenCode receives a managed local MCP sidecar and Pi receives a managed RPC extension. Writes remain vault-scoped and require provider approval, return a structured diff, and can be undone with **Undo last Canvas write** during the current Obsidian session.
- Vault health diagnostics, retrieval-index rebuild, provider CLI health checks, and actionable missing-CLI errors.
- Provider-specific permissions and capabilities. The plugin does not assume feature parity between runtimes.

The retrieval layer is deliberately local-first: the default index combines lexical matching, CJK n-grams, path/heading/link/recency signals, and a lightweight character n-gram reranker. Optional semantic reranking can be enabled in settings with a local Ollama (`/api/embed`) or OpenAI-compatible (`/v1/embeddings`) service. It is disabled by default, never sends vault content to a remote service automatically, and falls back to lexical search when the local endpoint is unavailable.

OpenCode and Pi run outside Obsidian's JavaScript process. Their managed adapters therefore provide a file-backed compatibility layer: the OpenCode sidecar uses only Node built-ins, while the Pi extension reuses the TypeBox package already shipped by Pi. Frontmatter queries are Dataview-compatible for common `FROM` use cases, but they do not call the Dataview plugin API. When a provider cannot start Node, its native chat remains available and the external tool layer is skipped.

## Requirements

- Obsidian desktop 1.11.4 or newer.
- At least one provider CLI installed and authenticated:
  - [Codex CLI](https://github.com/openai/codex) (`codex`)
  - [Claude Code](https://claude.ai/claude-code) (`claude`)
  - [OpenCode](https://opencode.ai/) (`opencode`)
  - [Pi](https://github.com/badlogic/pi-mono) (`pi`)
- Node.js is required only when building from source.

## Install from a release

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/wuyifan-code/Claudian-plus/releases/latest).
2. Create `<vault>/.obsidian/plugins/claudian-plus/`.
3. Copy the three files into that directory.
4. Enable **Claudian Plus** in Obsidian Settings → Community plugins.

## Build from source

```bash
git clone https://github.com/wuyifan-code/Claudian-plus.git
cd Claudian-plus
npm ci
npm run typecheck
npm run build
```

To copy build output directly into a vault, set `OBSIDIAN_VAULT` in `.env.local`:

```text
OBSIDIAN_VAULT=D:\\Obsidian\\My Vault
```

Then run `npm run build`.

## First run

1. Install and authenticate one provider CLI. Codex is the default provider when it is available.
2. Open Claudian Plus settings and enter an absolute CLI path if Obsidian cannot inherit your shell `PATH`.
3. Keep the permission mode at `normal` until you understand the provider-specific approval flow.
4. Enable memory, automatic vault context, and periodic review only if you want those local features.
5. For semantic retrieval, install an embedding model in a local service (for example `nomic-embed-text` in Ollama), enable **Local semantic search**, and set the endpoint/model in settings. The first indexing pass runs in the background and can be monitored from **Open vault health**.
6. If you want source-backed link candidates after saving the active note, enable **Link suggestions after save**. Suggestions are deduplicated and preview-only; no link is inserted without clicking **Insert link**.
7. To explore a Canvas cluster, select file or linked-note nodes, right-click the Canvas, and choose **Suggest neighboring notes**. The panel reads only Obsidian's resolved link graph and never writes without an explicit click.

## Useful commands

- **Open chat view**
- **Quick agent input**
- **Open vault health**
- **Undo last Canvas write** (current Obsidian session)
- **Rebuild vault retrieval index**
- **Check provider CLI health**
- **Generate vault review**
- **Open memory file**
- **Scan vault knowledge**

Inside the composer, use `/vault-search query` for source search and `/insight topic` for a source-grounded insight prompt. Vault files and folders can also be dragged into the composer or added from the File Explorer context menu.

## Privacy and safety

The plugin has no telemetry service. Provider requests are sent to the selected local CLI/runtime according to that provider's own configuration. Retrieval and memory data are stored locally under `.claudian-plus/`. Vault paths are validated before structure tools run, and Canvas/Properties writes require approval.

Existing `.claudian/` data is read and migrated on first save. Do not run an old Claudian build and Claudian Plus against the same vault at the same time.

## Verification

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:architecture
npm run build
```

## Acknowledgements

Claudian Plus is an enhanced fork of [Claudian](https://github.com/YishenTu/claudian). Thanks to Yishen Tu and the Claudian contributors.

## License

MIT. See [LICENSE](LICENSE).
