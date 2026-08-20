# M7: Settings Reorganization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the settings shell as an Obsidian-settings clone — left category tree + top search, providers as subpages — per design doc §5.

**Architecture:** `ClaudianPlusSettings` (`src/features/settings/ClaudianPlusSettings.ts`, ~938 lines, currently a segmented pill tab bar) becomes a tree+content split. Provider settings tabs keep their existing registration through `ProviderWorkspaceRegistry`; only the mount point changes (flat tab → Providers subpage), so provider boundaries stay intact. Search is an in-memory index over registered setting names/descriptions, built when settings open; nothing persisted.

**Tech Stack:** TypeScript, Obsidian `PluginSettingTab`/`Setting` API, Jest (node env — search index and tree model are pure/testable).

**Reference:** `docs/plans/2026-08-19-v3-ux-overhaul-design.md` §5. Independent of M4–M6.

**Environment gotchas (Windows sandbox):**
- Jest single-process: `node scripts/run-jest.js --runInBand <path>`
- `npm run build` spawns esbuild; EPERM → run outside sandboxed shell
- Full-suite baseline: 1 failing suite (`tests/unit/utils/path.test.ts`). Must not grow.
- Commit only plan-listed files; `git status` before each commit. English commits.
- i18n: new strings go in ALL 10 `src/i18n/locales/*.json` files (`tests/unit/i18n/locales.test.ts` enforces alignment).

---

### Task 1: Category tree model (TDD)

**Files:**
- Create: `src/features/settings/settingsTree.ts`
- Test: `tests/unit/features/settings/settingsTree.test.ts`

**Step 1: Failing tests**

```ts
import { buildSettingsTree } from '@/features/settings/settingsTree';

it('builds the fixed category order with providers nested under Providers', () => {
  const tree = buildSettingsTree({ providerTabs: fakeProviderTabs });
  expect(tree.map(c => c.id)).toEqual([
    'general', 'appearance', 'memory', 'providers', 'agents-skills', 'workspace', 'advanced',
  ]);
  expect(tree.find(c => c.id === 'providers')!.children!.map(p => p.providerId))
    .toEqual(['codex', 'claude', 'opencode', 'kimi', 'pi', 'dsh'].filter(hasEnabledTab));
});

it('keeps a valid selection when the active provider is disabled', () => {
  // selected providers/kimi, kimi tab removed → selection falls back to 'providers'
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** `settingsTree.ts`: pure tree model — fixed categories (General, Appearance, Memory, Providers, Agents & Skills, Workspace, Advanced), provider children derived from `ProviderWorkspaceRegistry` settings-tab registrations (enabled providers only), selection state with fallback rules. No DOM.

**Step 4: Run → PASS.**

**Step 5: Commit**

```bash
git add src/features/settings/settingsTree.ts tests/unit/features/settings/settingsTree.test.ts
git commit -m "feat(settings): add pure settings category tree model"
```

---

### Task 2: Tree+content shell in ClaudianPlusSettings

**Files:**
- Modify: `src/features/settings/ClaudianPlusSettings.ts`
- Create: `src/style/settings/tree-shell.css` (register in `src/style/index.css`)
- Modify: all 10 `src/i18n/locales/*.json` (category labels)
- Test: `tests/unit/features/settings/ClaudianPlusSettings.shell.test.ts` (mock Obsidian API per existing settings tests)

**Step 1: Failing test** — selecting a category renders its content pane and marks the tree row active:

```ts
it('renders the selected category content and active tree row', () => { /* ... */ });
it('renders provider subpages under Providers without touching provider registrations', () => { /* ... */ });
```

**Step 2: Run → FAIL.**

**Step 3: Implement**

- Replace the pill tab bar with a two-column layout: left tree (from `settingsTree.ts`), right content pane. Match Obsidian settings metrics: 196px tree column, tree rows `--font-ui-small`, active row `var(--claudian-plus-surface-hover)` background + accent bar.
- Mount protocol: each existing tab content builder gets a category assignment map (`general`: default provider/title generation; `appearance`: blob toggles, reading-mode default, outline side; `memory`: consciousness; `providers`: per-provider registered tabs as subpages; `agents-skills`, `workspace`, `advanced`: debug/CLI overrides). Provider tab builders are called unchanged with the subpage container.
- Deep state: selected category persisted in plugin settings (`settingsLastCategory?: string` in `src/core/types/settings.ts` + default), restored on open.
- i18n: `settings.category.general|appearance|memory|providers|agentsSkills|workspace|advanced` in all 10 locales.

**Step 4: Run → PASS; CSS build + ratchet PASS; locales test PASS.**

**Step 5: Commit**

```bash
git add src/features/settings/ClaudianPlusSettings.ts src/style/settings/tree-shell.css src/style/index.css src/core/types/settings.ts src/app/settings/defaultSettings.ts src/i18n/locales styles.css tests/unit/features/settings
git commit -m "feat(settings): replace pill tabs with Obsidian-style category tree shell"
```

---

### Task 3: Settings search (TDD)

**Files:**
- Create: `src/features/settings/settingsSearch.ts`
- Modify: `src/features/settings/ClaudianPlusSettings.ts` (search input + jump)
- Modify: `src/style/settings/tree-shell.css`
- Test: `tests/unit/features/settings/settingsSearch.test.ts`

**Step 1: Failing tests**

```ts
import { buildSettingsSearchIndex, searchSettings } from '@/features/settings/settingsSearch';

it('indexes setting name + description with their category path', () => { /* ... */ });
it('matches case-insensitive substrings and ranks name hits above description hits', () => { /* ... */ });
it('returns matches in category order, each with a navigation target', () => { /* ... */ });
```

**Step 2: Run → FAIL.**

**Step 3: Implement**

- `settingsSearch.ts`: pure index. Entries registered by category builders as `{ categoryId, settingKey, name, desc }` — builders pass i18n-resolved strings at render time, so the index rebuilds per open and per language.
- UI: search input on top of the tree column; typing filters to a flat result list (setting name + category breadcrumb); Enter/click jumps: select category → scroll to setting → brief highlight (`--claudian-plus-surface-hover` flash). Esc clears and restores the tree.
- Empty query = normal tree. No persistence, no fuzziness — substring ranking only (YAGNI).

**Step 4: Run → PASS; CSS build + ratchet PASS.**

**Step 5: Commit**

```bash
git add src/features/settings/settingsSearch.ts src/features/settings/ClaudianPlusSettings.ts src/style/settings/tree-shell.css styles.css tests/unit/features/settings/settingsSearch.test.ts
git commit -m "feat(settings): add in-memory settings search with jump-and-highlight"
```

---

### Task 4: Cleanup + final verification

**Step 1: Remove the old pill-tab CSS** — delete the `.claudian-plus-settings-tabs` / `-tab` rules from `src/style/settings/base.css` that no longer have DOM counterparts (verify with `grep` that classes are unused first; keep anything still referenced).

**Step 2: Full gate**

Run: `npm run typecheck && npm run lint && node scripts/run-jest.js --runInBand && npm run build`
Expected: only baseline `path.test.ts` failure.

**Step 3: Manual acceptance (human)**
- Settings opens on last category; provider subpages render identically to before; search finds e.g. "CLI path" and jumps; light/dark + one community theme.

**Step 4: Update `src/features/settings/` docs** (AGENTS.md if present, else create note in main AGENTS.md settings row): tree shell + search + provider subpage mounting.

**Step 5: Commit**

```bash
git add src/style/settings/base.css styles.css src/features/settings
git commit -m "refactor(settings): remove obsolete pill-tab styles and document tree shell"
```
