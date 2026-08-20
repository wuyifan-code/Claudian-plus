# M5: Session Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Rebuild session management on Obsidian's mental model — tab bar = open sessions, sessions view = file explorer — per design doc §3.

**Architecture:** Two workstreams. (1) Upgrade `TabBar` (currently minimal numbered badges, `src/features/chat/tabs/TabBar.ts`) with drag-to-reorder, middle-click close, and overflow dropdown; tab order lives in `TabManager`. (2) Promote the history dropdown (currently in `ConversationController.renderHistoryDropdown`, mounted from `ClaudianPlusView`) into a first-class Sessions view with a header view-switcher. `TabManager`/`ChatState` contracts unchanged — tabs stay cold-start, per-tab state.

**Tech Stack:** TypeScript, Obsidian DOM API, Jest (node env). No new dependencies (drag via Pointer Events, not a library).

**Reference:** `docs/plans/2026-08-19-v3-ux-overhaul-design.md` §3. Per-tab blob status indicators already exist (`tabs/TabBlobIndicator.ts`, M3) — this milestone surfaces runtime state on tabs; do not rebuild them.

**Environment gotchas (Windows sandbox):**
- Jest single-process: `node scripts/run-jest.js --runInBand <path>`
- `npm run build` spawns esbuild; EPERM → run outside sandboxed shell
- Full-suite baseline: 1 failing suite (`tests/unit/utils/path.test.ts`). Must not grow.
- Commit only plan-listed files; `git status` before each commit. English commits.

---

### Task 1: Tab order model in TabManager (TDD)

**Files:**
- Modify: `src/features/chat/tabs/TabManager.ts`
- Test: extend the existing TabManager test under `tests/unit/features/chat/tabs/`

**Step 1: Failing test**

```ts
it('reorders tabs and persists the order', () => {
  const mgr = createTabManager(); // existing helper
  // open three tabs A B C
  mgr.moveTab(tabC.id, 0);
  expect(mgr.getOrderedTabs().map(t => t.id)).toEqual([tabC.id, tabA.id, tabB.id]);
  // persisted order survives a serialize/hydrate round trip
});

it('clamps moveTab indices and no-ops on unknown tab ids', () => { /* ... */ });
```

**Step 2: Run → FAIL** (`moveTab` not defined).

**Step 3: Implement `moveTab(tabId, toIndex)`** in TabManager with clamping + order persistence in the existing tab-session serialization. No other behavior changes.

**Step 4: Run → PASS.**

**Step 5: Commit**

```bash
git add src/features/chat/tabs/TabManager.ts tests/unit/features/chat/tabs
git commit -m "feat(chat): add persistent tab reordering to TabManager"
```

---

### Task 2: TabBar interactions — drag reorder, middle-click close, overflow dropdown

**Files:**
- Modify: `src/features/chat/tabs/TabBar.ts`
- Modify: `src/features/chat/tabs/types.ts` (callback additions)
- Modify: `src/style/components/tabs.css`
- Test: extend `tests/unit/features/chat/tabs/TabBar.test.ts` if present, else create it

**Step 1: Failing tests**

```ts
it('emits onTabReorder with source and target index on drag drop', () => { /* dispatch pointer events on badges */ });
it('closes tab on middle-click without activating it', () => { /* auxclick button===1 */ });
it('renders overflow dropdown button when tabs exceed container width', () => { /* mock offsetWidth/scrollWidth */ });
```

**Step 2: Run → FAIL.**

**Step 3: Implement**

- Drag: `pointerdown` on a badge records drag intent; past 6px threshold the badge gets `claudian-plus-tab-badge--dragging`; `pointerover` on siblings marks insertion indicator; `pointerup` emits `onTabReorder(fromId, toIndex)` → `TabManager.moveTab`.
- Middle-click: `auxclick` with `button === 1` → `onTabClose`, suppress activation.
- Overflow: when `scrollWidth > clientWidth`, show a trailing `▾` button listing non-visible tabs in a dropdown (Obsidian `Menu`); clicking an item activates the tab. Keep fixed dimensions stable (style AGENTS.md gotcha).
- New callbacks: `onTabReorder` in `TabBarCallbacks`; wire in the view.

**Step 4: Run → PASS; build CSS; ratchet PASS.**

**Step 5: Commit**

```bash
git add src/features/chat/tabs/TabBar.ts src/features/chat/tabs/types.ts src/style/components/tabs.css styles.css tests/unit/features/chat/tabs
git commit -m "feat(chat): add drag reorder, middle-click close, and overflow dropdown to tab bar"
```

---

### Task 3: Sessions view (promote history dropdown to first-class view)

**Files:**
- Create: `src/features/chat/ui/SessionsView.ts`
- Modify: `src/features/chat/controllers/ConversationController.ts` (extract row rendering for reuse)
- Modify: `src/features/chat/ClaudianPlusView.ts` (mount + view switching)
- Create: `src/style/components/sessions-view.css` (register in `src/style/index.css`)
- Test: `tests/unit/features/chat/ui/SessionsView.test.ts`

**Step 1: Failing tests** (pure seams: sorting + filtering)

```ts
it('sorts sessions by last activity descending', () => { /* pure fn sortSessions */ });
it('filters by title and first-message preview, case-insensitive', () => { /* filterSessions */ });
```

**Step 2: Run → FAIL.**

**Step 3: Implement**

- `SessionsView.ts`: full-pane list view. Row = provider icon + title + first-message preview + relative time (reuse date utils). Sorted last-active desc. Top filter input (reuse the M2-delivered title-search logic from `ConversationController` — extract shared pure helpers `sortSessions`/`filterSessions` so dropdown and view share one implementation).
- Context menu per row (Obsidian `Menu` on `contextmenu`): Open / Fork / Rewind / Export / Delete — rewire to the existing actions currently scattered in the history dropdown item buttons. No new backend capabilities.
- The existing history dropdown stays as-is (quick access); SessionsView is the full view.

**Step 4: Run → PASS; build CSS; ratchet PASS.**

**Step 5: Commit**

```bash
git add src/features/chat/ui/SessionsView.ts src/features/chat/controllers/ConversationController.ts src/style/components/sessions-view.css src/style/index.css styles.css tests/unit/features/chat/ui/SessionsView.test.ts
git commit -m "feat(chat): add sessions view with sort, filter, and context-menu actions"
```

---

### Task 4: Header reorganization — view switcher + pinned new-session button

**Files:**
- Modify: `src/features/chat/ClaudianPlusView.ts`
- Modify: `src/style/components/header.css`
- Modify: all 10 `src/i18n/locales/*.json` (view labels)
- Test: extend `tests/unit/features/chat/` view-level tests if present (else cover via SessionsView tests)

**Step 1: Implement**

- Header left: a two-state view toggle (Chat / Sessions) mirroring Obsidian's sidebar switcher; persists last view in settings (add `chatHomeView?: 'chat' | 'sessions'` to `src/core/types/settings.ts` + `src/app/settings/defaultSettings.ts`, default `'chat'`).
- New-session button pinned at header right (existing new-tab action, restyled as primary).
- Switching to Sessions hides the conversation pane + composer, shows SessionsView; switching back restores the active tab untouched (no runtime teardown).
- i18n keys `chat.view.chat` / `chat.view.sessions` in all 10 locales; keep JSON formatting identical.

**Step 2: Verify** — typecheck, lint, `tests/unit/i18n/locales.test.ts`, affected chat tests, CSS build + ratchet.

**Step 3: Commit**

```bash
git add src/features/chat/ClaudianPlusView.ts src/style/components/header.css src/core/types/settings.ts src/app/settings/defaultSettings.ts src/i18n/locales styles.css tests
git commit -m "feat(chat): add chat/sessions view switcher and pinned new-session button"
```

---

### Task 5: Final verification + docs

**Step 1: Full gate**

Run: `npm run typecheck && npm run lint && node scripts/run-jest.js --runInBand && npm run build`
Expected: only baseline `path.test.ts` failure.

**Step 2: Manual acceptance (human)**
- Drag tabs, middle-click close, overflow dropdown at narrow width; sessions view sort/filter/context menu; view switch persistence; confirm `fc2f1a8`-era tab-bar startup layout stays correct.

**Step 3: Update `src/features/chat/AGENTS.md`** Main Parts table: TabBar behaviors, SessionsView ownership.

**Step 4: Commit**

```bash
git add src/features/chat/AGENTS.md
git commit -m "docs(chat): document tab bar behaviors and sessions view"
```
