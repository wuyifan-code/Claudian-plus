# Claudian Plus 3.0 UX Overhaul — Design

Date: 2026-08-19
Status: Approved (design phase)
Target: major version 3.0

## Concept

Claudian Plus 3.0 = "a living agent that lives inside Obsidian".

The chrome disappears: layout, colors, typography, and spacing are fully driven by
Obsidian theme variables, so the plugin is indistinguishable from native UI and follows
any community theme. On top of that invisible skeleton sits exactly one memorable visual
asset: a blob mascot character that embodies the "consciousness" positioning.

### Design principles

1. **Invisible chrome, visible character.** All surfaces consume Obsidian CSS variables.
   The only branded visual is the blob character, shown on the welcome page and as the
   agent working indicator.
2. **Character state = agent state.** The blob is a state-machine-driven functional
   component, not decoration: idle rotation, listening on user input, thinking while the
   model reasons, writing while streaming, error (bang) on failure, celebrate on
   completion. It replaces/augments textual status hints.
3. **Refactor without breaking provider boundaries.** All changes land in
   `features/chat` UI, `features/settings`, and `style/`. `ChatRuntime`, provider
   contracts, and storage formats are untouched. Conversations, history, and memory stay
   fully compatible with 2.x.

## Decisions log

| Question | Decision |
| --- | --- |
| Visual direction | Obsidian-native fusion (not a distinct brand aesthetic) |
| Interaction pain points | Session/tab management, long-conversation navigation, settings organization (composer IA is out of scope) |
| Session model | Obsidian's own: tabs = open sessions, session list = file-explorer-like view |
| Settings model | Obsidian settings clone: left category tree + top search, providers as subpages |
| Long-conversation navigation | Reading mode + enhanced outline rail |
| Welcome/working animation | Blob character (state machine, spring physics, eye morphs, overlays), inspired by the grok_bot-icon-study replica architecture; geometry drawn original |
| Version | 3.0 major bump |

Note on the reference repo (grok_bot-icon-study): its engine architecture (state
machine, spring math, eye polygon morphs, overlay system) is reused as a pattern; all
character geometry and paths are authored originally, which is also a prerequisite for
theme-variable coloring.

## §2 Visual layer (native fusion)

**Design tokens.** New `src/style/base/tokens.css` collects hard-coded values (radii,
spacing, shadows, type scale, motion durations) scattered across the 50+ style modules
into one semantic variable set mapped onto Obsidian variables:
`--claudian-radius-* → --radius-*`, `--claudian-surface-* → --background-*`,
`--claudian-accent → --interactive-accent`. Community themes (Minimal, Things,
AnuPpuccin…) then re-skin the plugin automatically. This is the technical foundation of
the whole visual overhaul. New modules must register in `src/style/index.css` per the
style build rules.

**Four surfaces:**

- **Welcome page.** Day-to-day empty session = native-style empty state (centered blob,
  greeting, 3 recent conversations, quick actions) with the blob playing its idle
  rotation. A full onboarding sequence (starting from `curious`) plays once on first
  install / upgrade to 3.0.
- **Message stream.** Hierarchy re-tiered: user messages heavier, assistant prose gets
  more line-height, thinking/tool calls visually demoted (smaller type, muted color,
  hairline dividers) — groundwork for reading mode. Code blocks and diffs keep their
  current maturity; only spacing and radii are unified.
- **Composer.** No IA change; visual tightening only — unified toolbar icon stroke,
  context chips rebuilt on tokens, focus ring in accent.
- **Blob working indicator.** Small (~20px) blob instances near the composer and on
  tabs; plays thinking/writing states while the agent works, replacing text-only
  "Generating…".

**Blob engine.** Following the reference architecture (state machine / springs / eye
morphs / overlays) with original paths: 6–8 states at launch (idle, listening, thinking,
writing, error, celebrate), eye shape set per state, colors read from
`--background-primary` / `--text-normal` for native light/dark support.

## §3 Session management (Obsidian mental model)

Tabs = open sessions; session list = file explorer.

- **Tab bar** keeps its top position, behavior aligned with Obsidian tabs: drag to
  reorder, middle-click to close, overflow collapses into a dropdown instead of
  squeezing, active-tab underline in `--interactive-accent`. Mini blob per tab shows
  that session's runtime state (working/idle).
- **History panel upgraded to a Sessions view**: a first-class view isomorphic to the
  Obsidian file explorer — sorted by last active; each row shows title, provider icon,
  first-message preview, relative time; instant filter on top (reuses the delivered M2
  title search); right-click context menu consolidates fork / rewind / export / delete.
- **View switching**: a header toggle (Conversation / Sessions), mirroring Obsidian's
  sidebar Files/Search switcher. New-session button pinned in the header.
- **Engineering**: behavior extensions in `tabs/`, history renderer upgraded to a full
  view, header reorganization. `TabManager` / `ChatState` contracts unchanged — tabs
  still cold-start, still per-tab state. Layout debts from `fc2f1a8` (tab bar startup
  layout) and `4cdac2e` (panel width tracking) are cleaned up in the tab-bar rewrite.

## §4 Long-conversation navigation

**Reading mode.** Header toggle (book icon) switches to a clean view: tool calls
collapse to a one-line summary (name + status + duration, click to expand); thinking
collapses to a single line; diffs / plan approvals / ask-user prompts stay expanded
(they are decision points, not noise). State is remembered per conversation, default
off. Implemented as a collapsed form in the existing tools/thinking renderers — no
render-pipeline rewrite.

**Outline rail enhancement.** Outline nodes expand from "prompts + headings" to four
kinds — prompts, headings, tool calls, thinking — each with a distinguishing icon. Type
filter chips on top (default: prompts + headings only, i.e. current behavior). Linked
with reading mode: when reading mode is on, the outline auto-filters to Q&A. Keeps
hover preview, jump, side choice.

Both changes share one node-extraction pass: renderers register navigation nodes as
they emit messages, avoiding two traversals.

**Engineering**: `NavigationSidebar`, tools/thinking renderers in `rendering/`, and a
per-tab `readingMode` state field.

## §5 Settings reorganization

Obsidian-settings clone: left category tree + top search.

```text
┌─────────────┬──────────────────────┐
│ 🔍 Search…   │                      │
│─────────────│  Current category     │
│ General      │                      │
│ Appearance   │                      │
│ Memory       │                      │
│ Providers  ▸ │  ← one category       │
│   Codex      │    subpage per        │
│   Claude     │    provider           │
│   OpenCode   │                      │
│   Kimi/Pi/DSH│                      │
│ Agents & Skills                    │
│ Workspace    │                      │
│ Advanced     │                      │
└─────────────┴──────────────────────┘
```

- The six provider tabs move under `Providers` as subpages. Existing per-provider
  settings tab registration (`ProviderWorkspaceRegistry`) is unchanged — only the
  mount point changes from flat tab to subpage.
- Search filters instantly with highlight + jump; index is built in-memory from
  registered setting descriptions when settings open; nothing persisted.
- Categories: General (default provider, title generation), Appearance (blob toggle,
  reading-mode default, outline side), Memory (existing consciousness settings),
  Advanced (debug, CLI path overrides).
- **Engineering**: `ClaudianPlusSettings` shell refactor from tab container to
  tree+content split; provider settings content components reused as-is with a new
  mount protocol; spacing/type follow the token layer.

## §6 Milestones & verification

| Milestone | Content | Depends on |
| --- | --- | --- |
| 3.0-M1 Token foundation | `tokens.css` + migration of hard-coded values across style modules | — |
| 3.0-M2 Blob engine | Original geometry + state machine (6 states), theme colors, rAF perf validation in sidebar | M1 |
| 3.0-M3 Welcome + indicators | Empty-state welcome, first-run onboarding, composer/tab mini blobs | M2 |
| 3.0-M4 Message stream + reading mode | Hierarchy re-tier, collapsed tools/thinking, reading-mode toggle | M1 |
| 3.0-M5 Session management | Tab-bar behaviors, sessions view, header reorganization | M1 |
| 3.0-M6 Outline enhancement | Four node kinds, type filters, reading-mode linkage | M4 |
| 3.0-M7 Settings reorganization | Tree+content split, search, provider subpage mounting | M1 |

M4/M5 can run in parallel. M2→M3 carries most of the perceived "upgrade".

**Verification:**

- TDD per repo rules: navigation-node extraction, reading-mode collapse, settings
  search index, session-list filtering get failing tests first under `tests/unit/`.
  Blob state-transition table is pure logic and testable; rendering is excluded with a
  documented reason.
- Per milestone: `npm run typecheck && npm run lint && npm run test && npm run build`,
  without growing the known Windows baseline failure set.
- Visual acceptance: light + dark themes plus at least one community theme (Minimal)
  reviewed by hand.
- Performance: the blob rAF loop pauses when the sidebar is hidden
  (`visibilitychange` + IntersectionObserver); idle CPU usage measured.

**Out of scope (YAGNI):** composer IA rework, full-text search index (stays on the 2.x
roadmap), mobile (plugin is `isDesktopOnly`).
