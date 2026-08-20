# M6: Outline Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Extend the floating conversation outline from prompts+headings to four node kinds (prompts, headings, tool calls, thinking) with type filter chips, and link it to M4's reading mode — per design doc §4.

**Architecture:** `NavigationSidebar` (`src/features/chat/ui/NavigationSidebar.ts`) already renders a "Wave TOC" tick rail with `ConversationOutlineEntry { kind: 'prompt' | 'heading' }`, hover preview, and jump. This milestone widens `kind` to `'tool' | 'thinking'`, extends the existing DOM-scan extraction to register tool-call and thinking elements, adds a filter-chip row controlling which kinds appear (default: prompt+heading = current behavior), and auto-filters to Q&A when M4 reading mode is on. One shared extraction pass — renderers' DOM markers are the single source, no second traversal.

**Tech Stack:** TypeScript, Obsidian DOM API, Jest (node env — extraction logic must be a pure/testable seam).

**Reference:** `docs/plans/2026-08-19-v3-ux-overhaul-design.md` §4. **Depends on M4** (reading-mode linkage); the outline-only parts (Tasks 1–3) can start before M4 lands.

**Environment gotchas (Windows sandbox):**
- Jest single-process: `node scripts/run-jest.js --runInBand <path>`
- `npm run build` spawns esbuild; EPERM → run outside sandboxed shell
- Full-suite baseline: 1 failing suite (`tests/unit/utils/path.test.ts`). Must not grow.
- Commit only plan-listed files; `git status` before each commit. English commits.

---

### Task 1: Four-kind outline extraction (TDD)

**Files:**
- Modify: `src/features/chat/ui/NavigationSidebar.ts` (extraction internals)
- Modify: `src/features/chat/rendering/ToolCallRenderer.ts` + `ThinkingBlockRenderer.ts` (stable DOM marker classes if missing, e.g. `claudian-plus-tool-call`, `claudian-plus-thinking`)
- Test: `tests/unit/features/chat/ui/outlineExtraction.test.ts`

**Step 1: Failing test** — extraction as a pure function over a message-element tree:

```ts
import { extractOutlineEntries } from '@/features/chat/ui/outlineExtraction';

it('extracts prompts, headings, tool calls, and thinking blocks in document order', () => {
  const root = buildTranscriptFixture(); // helper: user msg, assistant with h2 + tool call + thinking
  const entries = extractOutlineEntries(root);
  expect(entries.map(e => e.kind)).toEqual(['prompt', 'heading', 'tool', 'thinking']);
});

it('summarizes tool entries by tool name and thinking entries by duration', () => { /* ... */ });
```

**Step 2: Run → FAIL.**

**Step 3: Implement**

- New module `src/features/chat/ui/outlineExtraction.ts`: pure `extractOutlineEntries(rootEl)` returning `{ kind, level, title, excerpt, badge }[]`. Move the existing prompt/heading scan into it, add tool (marker class + tool name + status) and thinking (duration) extraction.
- `NavigationSidebar` consumes it, replacing its inline scan; widen `ConversationOutlineKind` to `'prompt' | 'heading' | 'tool' | 'thinking'`.
- Renderers guarantee stable marker classes on their root elements (add if absent — check first).

**Step 4: Run → PASS; existing NavigationSidebar tests (if any) stay green.**

**Step 5: Commit**

```bash
git add src/features/chat/ui/outlineExtraction.ts src/features/chat/ui/NavigationSidebar.ts src/features/chat/rendering/ToolCallRenderer.ts src/features/chat/rendering/ThinkingBlockRenderer.ts tests/unit/features/chat/ui/outlineExtraction.test.ts
git commit -m "feat(chat): extract four-kind outline entries from the transcript"
```

---

### Task 2: Type filter chips in the rail

**Files:**
- Modify: `src/features/chat/ui/NavigationSidebar.ts`
- Modify: `src/style/components/nav-sidebar.css`
- Modify: all 10 `src/i18n/locales/*.json` (filter labels)
- Test: extend `tests/unit/features/chat/ui/outlineExtraction.test.ts` or add `NavigationSidebar.filter.test.ts`

**Step 1: Failing test**

```ts
it('filters outline entries by enabled kinds', () => {
  expect(filterEntriesByKinds(entries, new Set(['prompt', 'heading'])))
    .toEqual(entries.filter(e => e.kind === 'prompt' || e.kind === 'heading'));
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement**

- Pure `filterEntriesByKinds(entries, enabled)` + chip row at the rail top: four chips (Prompts / Headings / Tools / Thinking), `aria-pressed` toggles. Default enabled = prompt + heading (current behavior preserved).
- Tool/thinking ticks get distinct styling (smaller, `--claudian-plus-text-faint`) so the rail stays quiet even when enabled.
- Filter state persisted per conversation alongside tab state (extend the ChatState serialization used for M4 readingMode).
- i18n keys `outline.filter.prompts|headings|tools|thinking` in all 10 locales.

**Step 4: Run → PASS; CSS build + ratchet PASS; locales test PASS.**

**Step 5: Commit**

```bash
git add src/features/chat/ui/NavigationSidebar.ts src/style/components/nav-sidebar.css src/features/chat/state/ChatState.ts src/i18n/locales styles.css tests
git commit -m "feat(chat): add outline kind filter chips with per-conversation persistence"
```

---

### Task 3: Reading-mode linkage (requires M4 merged)

**Files:**
- Modify: `src/features/chat/ui/NavigationSidebar.ts`
- Modify: `src/features/chat/ClaudianPlusView.ts` (reading-mode toggle notifies the sidebar)
- Test: extend the M4 MessageRenderer test file or a sidebar test

**Step 1: Failing test**

```ts
it('auto-filters outline to prompts+headings while reading mode is on', () => {
  // enable reading mode on the state, notify sidebar, assert tool/thinking ticks hidden
});
it('restores the user filter selection when reading mode turns off', () => { /* ... */ });
```

**Step 2: Run → FAIL.**

**Step 3: Implement** — the reading-mode toggle (M4 Task 3) calls `navigationSidebar.setReadingModeActive(bool)`: while active, the sidebar forces the Q&A filter and visually dims the Tools/Thinking chips (disabled, not hidden); on exit, the user's saved chip selection is restored.

**Step 4: Run → PASS.**

**Step 5: Commit**

```bash
git add src/features/chat/ui/NavigationSidebar.ts src/features/chat/ClaudianPlusView.ts tests
git commit -m "feat(chat): link outline filtering to reading mode"
```

---

### Task 4: Final verification + docs

**Step 1: Full gate**

Run: `npm run typecheck && npm run lint && node scripts/run-jest.js --runInBand && npm run build`
Expected: only baseline `path.test.ts` failure.

**Step 2: Manual acceptance (human)**
- Long session with tool calls: default rail unchanged; enable Tools chip → tool ticks appear with name/status preview; reading mode on → rail collapses to Q&A and back on exit. Wave/hover/jump behavior unchanged for all kinds.

**Step 3: Update `src/features/chat/AGENTS.md`** — outline extraction ownership in `ui/outlineExtraction.ts`, four kinds + filter chips + reading-mode linkage.

**Step 4: Commit**

```bash
git add src/features/chat/AGENTS.md
git commit -m "docs(chat): document four-kind outline and filters"
```
