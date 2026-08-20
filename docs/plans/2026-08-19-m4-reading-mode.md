# M4: Message Stream + Reading Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Re-tier message-stream visual hierarchy and add a per-conversation Reading Mode that collapses tool calls and thinking blocks to one-line summaries, per design doc §2/§4.

**Architecture:** Reading mode is a per-tab boolean on `ChatState`, persisted with the conversation. When on, `ToolCallRenderer` and `ThinkingBlockRenderer` render their collapsed forms by default (one-line summary + click to expand), reusing the existing `rendering/collapsible.ts` `setupCollapsible` helper. Diffs, plan approvals, and ask-user prompts never collapse (they are decision points). A header toggle switches the active tab and triggers a re-render.

**Tech Stack:** TypeScript, Obsidian DOM API, Jest (node env — mock DOM-heavy paths like `MessageRenderer.test.ts` does).

**Reference:** `docs/plans/2026-08-19-v3-ux-overhaul-design.md` §2 (message stream re-tier) and §4 (reading mode). M6 depends on this milestone for the outline linkage.

**Environment gotchas (Windows sandbox):**
- Jest must run single-process: `node scripts/run-jest.js --runInBand <path>`
- `npm run build` spawns esbuild; if EPERM, run outside the sandboxed shell
- Full-suite baseline: 1 failing suite (`tests/unit/utils/path.test.ts`, known Windows path-mocking issue). Must not grow.
- Commit only plan-listed files; verify with `git status` before each commit. English commit messages.

---

### Task 1: Per-tab `readingMode` state with persistence

**Files:**
- Modify: `src/features/chat/state/ChatState.ts`
- Test: `tests/unit/features/chat/state/ChatState.readingMode.test.ts`

**Step 1: Write the failing test**

```ts
it('persists readingMode per conversation and defaults to false', () => {
  const state = createChatState(/* existing helper pattern */);
  expect(state.getReadingMode()).toBe(false);
  state.setReadingMode(true);
  expect(state.serialize().readingMode).toBe(true);
  const restored = createChatState();
  restored.hydrate(state.serialize());
  expect(restored.getReadingMode()).toBe(true);
});

it('does not leak readingMode across tabs', () => {
  // two ChatState instances: setting one leaves the other false
});
```

Follow the existing ChatState test patterns under `tests/unit/features/chat/state/`.

**Step 2: Run test to verify it fails**

Run: `node scripts/run-jest.js --runInBand tests/unit/features/chat/state/ChatState.readingMode.test.ts`
Expected: FAIL (`getReadingMode` not defined).

**Step 3: Implement**

Add `readingMode: boolean` (default `false`) to ChatState with `getReadingMode()` / `setReadingMode(v)`, included in the serialize/hydrate contract. Old persisted conversations without the field hydrate to `false` (no migration needed).

**Step 4: Run test to verify it passes.** Same command; expect PASS.

**Step 5: Commit**

```bash
git add src/features/chat/state/ChatState.ts tests/unit/features/chat/state/ChatState.readingMode.test.ts
git commit -m "feat(chat): add per-tab readingMode state with persistence"
```

---

### Task 2: Collapsed forms for tool calls and thinking blocks

**Files:**
- Modify: `src/features/chat/rendering/ToolCallRenderer.ts`
- Modify: `src/features/chat/rendering/ThinkingBlockRenderer.ts`
- Test: `tests/unit/features/chat/rendering/readingModeCollapse.test.ts`

**Step 1: Write the failing test**

Pure-logic seam: extract a summary builder per renderer and test it:

```ts
import { buildToolCallSummary } from '@/features/chat/rendering/ToolCallRenderer';
import { buildThinkingSummary } from '@/features/chat/rendering/ThinkingBlockRenderer';

it('builds a one-line tool call summary with name, status, duration', () => {
  expect(buildToolCallSummary({ toolName: 'Write', status: 'completed', durationMs: 340 }))
    .toBe('Write · completed · 340ms');
});

it('builds a thinking summary line', () => {
  expect(buildThinkingSummary({ durationMs: 1200 })).toContain('Thought');
});
```

**Step 2: Run test → FAIL (functions not exported).**

**Step 3: Implement**

- Add `buildToolCallSummary` / `buildThinkingSummary` pure functions and export them.
- Both renderers accept a new `collapsedByDefault?: boolean` option. When true, render through `setupCollapsible` (existing `rendering/collapsible.ts`) with `initiallyExpanded: false` and the summary line as the header content. When false/absent, behavior is unchanged.
- Never apply to `DiffRenderer`, `InlinePlanApproval`, `InlineAskUserQuestion`.

**Step 4: Run test → PASS.**

**Step 5: Commit**

```bash
git add src/features/chat/rendering/ToolCallRenderer.ts src/features/chat/rendering/ThinkingBlockRenderer.ts tests/unit/features/chat/rendering/readingModeCollapse.test.ts
git commit -m "feat(chat): add collapsed summary forms for tool calls and thinking blocks"
```

---

### Task 3: Reading-mode wiring through MessageRenderer + header toggle

**Files:**
- Modify: `src/features/chat/rendering/MessageRenderer.ts`
- Modify: `src/features/chat/ClaudianPlusView.ts` (header)
- Modify: `src/style/components/header.css` (toggle button)
- Modify: `src/i18n/locales/en.json`, `zh-CN.json`, `zh-TW.json`, `de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `pt.json`, `ru.json` (toggle label — ALL 10 locales; the locales structure test enforces alignment)
- Test: extend `tests/unit/features/chat/rendering/MessageRenderer.test.ts`

**Step 1: Write the failing test** (extend existing file; mock DOM-heavy modules as it already does):

```ts
it('passes collapsedByDefault to tool and thinking renderers when reading mode is on', () => {
  const { renderer } = createRenderer(undefined, 'claude', { /* readingMode: true via state */ });
  // render a conversation containing a tool call and a thinking block
  // assert renderStoredToolCall / renderStoredThinkingBlock received collapsedByDefault: true
});
```

**Step 2: Run test → FAIL.**

**Step 3: Implement**

- `MessageRenderer` reads the tab's `readingMode` from ChatState and threads `collapsedByDefault` into tool/thinking render calls (live and stored paths).
- Header: add a book-icon toggle (`claudian-plus-reading-mode-toggle`, `aria-pressed`) next to the existing nav actions in `ClaudianPlusView`. Clicking flips ChatState.readingMode and calls a full `renderMessages` re-render of the active tab.
- i18n keys `chat.readingMode.on` / `chat.readingMode.off` in ALL 10 locale files (insert adjacent to existing chat keys; keep JSON formatting identical — 2-space indent, LF).

**Step 4: Run test → PASS; also run `tests/unit/i18n/locales.test.ts` → PASS.**

**Step 5: Commit**

```bash
git add src/features/chat/rendering/MessageRenderer.ts src/features/chat/ClaudianPlusView.ts src/style/components/header.css src/i18n/locales styles.css tests/unit/features/chat/rendering/MessageRenderer.test.ts
git commit -m "feat(chat): wire reading mode toggle through renderer and header"
```

---

### Task 4: Message hierarchy visual re-tier (CSS only)

**Files:**
- Modify: `src/style/components/messages.css`, `src/style/components/toolcalls.css`, `src/style/components/thinking.css`

**Step 1: Re-tier using tokens only (ratchet stays green):**
- User message: font-weight 600, slightly larger gap above.
- Assistant prose: `line-height: 1.65` on paragraph blocks.
- Tool calls + thinking: `font-size: var(--font-ui-smaller)`, `color: var(--claudian-plus-text-muted)`, hairline divider `1px solid var(--claudian-plus-border)` between consecutive noise blocks.
- Collapsed summary rows: single-line height, ellipsis, hover raises to `--claudian-plus-surface-hover`.

**Step 2: Build + ratchet**

Run: `npm run build:css && node scripts/run-jest.js --runInBand tests/unit/style/style-tokens.test.ts`
Expected: build exit 0, ratchet PASS (no hard-coded values — tokens only).

**Step 3: Commit**

```bash
git add src/style/components/messages.css src/style/components/toolcalls.css src/style/components/thinking.css styles.css
git commit -m "feat(style): re-tier message stream hierarchy for reading mode"
```

---

### Task 5: Final verification + docs

**Step 1: Full gate**

Run: `npm run typecheck && npm run lint && node scripts/run-jest.js --runInBand && npm run build`
Expected: typecheck/lint/build exit 0; suite has only the baseline `path.test.ts` failure.

**Step 2: Manual acceptance (human)**
- Long conversation → toggle reading mode: tools/thinking collapse to summaries; diffs/plan/ask-user stay expanded; state survives reload; default off.

**Step 3: Document in `src/features/chat/AGENTS.md`** — one line: reading mode collapses tool/thinking via `collapsedByDefault`; diffs/plan/ask-user exempt.

**Step 4: Commit**

```bash
git add src/features/chat/AGENTS.md
git commit -m "docs(chat): document reading mode behavior"
```
