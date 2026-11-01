# Changelog

Release history for Claudian Plus, from 3.0.2 onward. The [Releases page](https://github.com/wuyifan-code/Claudian-plus/releases) carries a commit-level note for every tag; this file keeps the detail a commit subject cannot hold.

English | [简体中文](CHANGELOG_ZH.md)

Releases before 3.0.2 live in the git tags and the Releases page.

## [3.2.4] - 2026-10-31

### Changed

- The conversation navigator models a conversation as one tick per question, keyed by message id, so a tick keeps its position, preview and focus while the answer below it streams.
- Hover is a peak: the hovered tick scales to 2.6×, its two neighbours to 1.7× and 1.25×, everything else rests at 1×, with opacity stepping 1 / 0.86 / 0.72 / 0.58. Only the peak takes the body colour.
- The rail is virtualized — only ticks inside the rail viewport are mounted, so a thousand questions cost the same DOM as ten.
- The active tick is resolved by binary search over measured row positions instead of a per-pixel scan.
- The preview card shows the question and the reply, and distinguishes a reply that is still streaming from one that produced no text.
- Jumping respects `prefers-reduced-motion`.
- Ported from ZCode's `ConversationTurnNavigator` (Apache-2.0) and re-expressed in plain DOM; attribution is recorded in `NOTICE`.

### Added

- Settings → Appearance gains left and right transcript padding sliders, 0–80 px in steps of 4, applied live. The two sides are independent because the navigator reserves a gutter on whichever side it sits; the gutter is added on top of your inset rather than replacing it.

### Performance

- Streaming no longer re-parses the whole answer every frame. Closed blocks render once and keep their DOM, so each 100 ms frame re-renders only the open tail and per-frame work drops from O(whole message) to O(open block).
- The navigator no longer measures every message on each streaming refresh; only the last message can change height while a reply lands.

### Fixed

- Rail ticks are `div role="button"` instead of `<button>`, so Obsidian's themed button background no longer wraps each tick in a capsule. Enter and Space still activate them.
- The rail's slower streaming refresh interval now applies instead of silently falling back to the fast one.

### Removed

- The old outline extractor, its unused kind enum, the kind filter chips, and ~1.5k lines of tests for behaviour that no longer exists.

## [3.2.3] - 2026-10-29

### Changed

- The reasoning-effort gear list is replaced by a slider (`356494d9`).

## [3.2.2] - 2026-10-26

### Fixed

- A timeline item without a timestamp no longer collapses. Grid tracks are driven by a row attribute instead of by how many cells a row happened to emit, and the connector is drawn by a rail that stretches with the row — the same content that rendered one glyph per line in a 10px column (1064px tall) now renders at full width in 161px.
- Obsidian's element styles stop leaking into generated-UI widgets. Every button and form-control rule is element-qualified, with a reset for the properties no component owns.
- Radii, spacing, type and control height each use one scale. Title sizes collapse from five to three rendered steps: `md` and `lg` used to render at 20px and 19.8px, and `2xl` and `3xl` were identical. A panel nested inside another panel degrades to a tint instead of drawing a second border.
- Widgets get a markdown reading layer. `MarkdownRenderer.render()` does not add Obsidian's `.markdown-rendered` wrapper, so code blocks, tables, quotes and rules inside a widget had no reading polish; widget roots are excluded by class so a Table component never inherits markdown-table rules.
- The 361–479px sidebar tier exists: three- and four-column grids degrade to two, table headers may wrap, badges may break.

### Performance

- The production bundle is 3.42 MiB instead of 3.68 MiB, and median cold module evaluation drops from 286.8 ms to about 260–272 ms. CJK locale bundles now emit UTF-8 instead of `\uXXXX` escapes, and the build targets ES2022.

### Internal

- Onboarding state and the per-install device key live in the plugin data file instead of renderer storage. A device key left by an earlier build is adopted when it is unambiguous.
- Zero production dependency advisories: `@modelcontextprotocol/sdk` 1.32.2, `smol-toml` 1.9.1, `zod` 4.6.7 and the pinned `hono` override moved off the vulnerable ranges — `npm audit --omit=dev` reports none.
- Promise rejections carry `Error` reasons, and a duplicated CSS declaration is gone.

## [3.2.1] - 2026-10-25

### Fixed

- The generative-UI renderer no longer writes inline styles. Static styling goes through CSS classes (`is-bordered`, `is-align-*`, `is-italic`, …) and dynamic values (gap, padding, colours) through `setCssProps`, clearing `obsidianmd/no-static-styles-assignment` for `src/features/chat/rendering/ui/components.ts`.

### Internal

- The same lint rule now runs at error level in local CI.

## [3.2.0] - 2026-10-24

### Added

- Intelligent UI. A provider may reply with a fenced ` ```claudian-ui ` program that renders as native Obsidian DOM — never an iframe, never `innerHTML` — with byte-for-byte transcript replay on every provider.
- A declarative language of 54 components: layout, text, data, inputs, structure, learning and Obsidian-native widgets; 24 pure `@functions`; 8 actions (`@Set`, `@Reset`, `@Toggle`, `@ToAssistant`, `@OpenUrl`, `@Copy`, `@OpenNote`, `@InsertToNote`) plus `Action([...])` sequences.
- `Form` bundles every bound field into exactly one assistant turn; `Quiz` and `Checklist` grade or track progress locally without a model round-trip.
- Settled blocks fade in once, early streaming frames show a skeleton, and a hover toolbar copies the program, resets widget state or expands the interface. Generated blocks appear in the conversation outline with `UI` markers.
- Widget state — slider positions, selections, checkboxes — is persisted per conversation (16 KiB per block, 64 KiB per session) under a message-content key, so history replay and a vault reload find the same state.
- Rebuilds triggered by your own keystrokes restore focus and caret on the exact control.
- Every reasoning-and-tool run folds into a single `Execution details` line with an aggregate summary: tool count, names, failures and thinking time.

### Changed

- The memory subsystem is rewritten as a single V2 pipeline (dream jobs, repository maintenance, claim keys, export views) with no new dependencies, and injection budgets are token-aware.

### Fixed

- A DeepSeek Harness native catalog that returns nothing or fails per provider now reports diagnostics instead of silently wiping saved models.

### Internal

- `scripts/sync-dsh-profiles.mjs` syncs model-provider config between DSH profiles (Desktop ⇄ web) without touching credentials.
- `npm run build` deploys the built artifacts into a sibling vault checkout's `.obsidian/plugins/claudian-plus/` (no-op outside that layout).
- The bundle budget is raised to 3.85 MB for the new surface; the release build stays at 3.62 MiB.

## [3.1.1] - 2026-10-19

### Fixed

- A prompt sent from the file menu, a command or the quick-input modal while the tab limit was reached wrote into whatever conversation was active. It now stops and explains the limit.
- Context usage was wrong for several providers. Antigravity's Gemini models reported against a 200K denominator while running a 1M window; the window is now resolved per model family, and an unrecognised model id keeps the safe default.
- The context-capacity selector was a no-op for Antigravity because the value was stored under one model-id spelling and looked up under another; both spellings now resolve to the same setting.
- A capacity you picked could not be undone. The meter menu gained **Provider's default**.
- "Obsidian tools unavailable" was retried and reported once per message when the MCP SDK was absent; it is now reported once and re-attempted only on an explicit MCP reload.
- Local `!` command execution on Windows is spawned hidden, like every other subprocess the plugin starts.
- A permission error while probing the npm global prefix escaped as an exception and aborted Claude CLI resolution; it now degrades to "not found there" and keeps searching.
- A contiguous run of reasoning and tool calls is one execution phase with a single summary line, instead of one collapsed block per step.
- Reference material injected into the user turn no longer appears as your own words when a conversation is replayed, for the ACP providers (Kimi, OpenCode, Pi), DeepSeek, Antigravity and Codex.
- The header provider icon is monochrome for every provider except Claude, which keeps its brand colour.

### Known issues

- #11 (terminal console flash) is still open. 3.1.0 removed the plugin's own proxy-probe leak; the `where.exe` call visible in the bundle is inlined from the upstream Claude Agent SDK.
- The tab strip stays hidden by design. The new-tab button remains visible and disabled at the limit, and the limit is explained in a notice.

## [3.1.0] - 2026-10-17

### Added

- DeepSeek Harness as a provider, implemented against the official HTTP Remote and WebSocket mux contracts: `DshHost` owns the `dsh serve` process, `DshSubprocess` owns its stdio, `DshNativeConnection` speaks the mux, and `DshRemoteClient` puts a typed surface on both.
- Sessions bind to the harness's own history, so a reload, a tab switch or a process restart resumes the same conversation with its full turn history.
- Models are read from the native catalog and refreshed on demand from the settings tab; reasoning effort is exposed per model.
- One process per workspace, shared by every tab in the same vault.
- Boundaries stated up front: images, fork, rewind, steering, slash commands, shared MCP/skill management and background subagents are not exposed, and unknown context capacity is reported as unknown rather than invented as a token count.

### Fixed

- Caret colour in dark themes (#9): the composer and the live-preview editor inherit `--text-normal` for `caret-color`.
- Scrambled history layout (#10): opening a session from the conversation list no longer creates a second tab for the same id, and consecutive Antigravity assistant messages merge into one content block.
- Terminal flash on every turn (#11): registry probing for the system proxy passes `windowsHide`.
- Codex fork on long threads: forking passes an inclusive `lastTurnId` checkpoint to `thread/fork` instead of forking the whole thread and rolling back, which paginated threads reject (`5ac19e8e`, diagnosed in PR #5 by Mofusigil).

## [3.0.3] - 2026-10-04

### Fixed

- Removed the prohibited default hotkey for inline edit (`4de4eebc`).

### Internal

- Obsidian review findings, CSS warnings and memory V2 enhancements (`43f370c2`).

## [3.0.2] - 2026-09-21

### Added

- Smart Tool Grouping. Consecutive tool calls expand during streaming and collapse into a ~28px summary bar showing the call count (e.g. `13 calls`), the distinct tool names and an aggregated health indicator. A single call stays a one-line item.
- Antigravity system proxy tunneling. `resolveSystemProxyEnvironment` reads the Windows Registry and injects `HTTP_PROXY` into the child process, which fixes `WSAECONNRESET 10054` on Clash/Mihomo TUN Fake-IP routing after a 4m 30s idle timeout.
- Official Antigravity SVG icons, multi-model selection across Gemini 3.1 Pro, 3.7 Flash and 3.8, and thinking-budget tuning.
- A circular stop button, 28px × 28px, replacing the rectangular Stop badge: white circle with a dark square in dark mode, inverted in light mode, `scale(1.06)` on hover, `scale(0.94)` on press, `Stop generation (Esc)` tooltip.

### Fixed

- The header provider icon no longer drifts vertically and clips at the top edge of the window.
