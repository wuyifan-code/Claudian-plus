# M1: Token Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Create a semantic design-token layer in `src/style/base/tokens.css` mapped to Obsidian theme variables, and migrate all hard-coded colors/radii/shadows/transitions in the 53 style modules to tokens — the foundation for the 3.0 native-fusion visual overhaul.

**Architecture:** One new module `tokens.css` defines semantic tokens (`--claudian-plus-surface-*`, `--claudian-plus-text-*`, `--claudian-plus-border-*`, `--claudian-plus-accent*`) as aliases of Obsidian variables, scoped to `.claudian-plus-container` alongside the existing `variables.css`. Modules then reference tokens instead of literals. A Jest ratchet test scans `src/style/` and fails if any module outside the allowlist contains a hard-coded color, keeping the migration from regressing.

**Tech Stack:** plain CSS (build = `scripts/build-css.mjs` concatenation, no preprocessor), Jest + ts-jest for the ratchet test.

**Reference:** design doc `docs/plans/2026-08-19-v3-ux-overhaul-design.md` §2; style conventions in `src/style/AGENTS.md`.

**Known baseline:** the repo has pre-existing Windows-specific unit-test failures (path-mocking tests, architecture path matcher). M1 must not grow that set. Verify with `node scripts/run-jest.js` before and after; compare failure lists.

---

### Task 1: Create the token layer

**Files:**
- Create: `src/style/base/tokens.css`
- Modify: `src/style/index.css` (add one import line after line 5)

**Step 1: Create `src/style/base/tokens.css`**

```css
/* Semantic tokens mapped to Obsidian theme variables.
   Modules must reference these instead of hard-coded values, so community
   themes re-skin the plugin automatically. Scoped like variables.css. */
.claudian-plus-container {
  /* Surfaces */
  --claudian-plus-surface-primary: var(--background-primary);
  --claudian-plus-surface-secondary: var(--background-secondary);
  --claudian-plus-surface-alt: var(--background-secondary-alt);
  --claudian-plus-surface-hover: var(--background-modifier-hover);

  /* Text */
  --claudian-plus-text-normal: var(--text-normal);
  --claudian-plus-text-muted: var(--text-muted);
  --claudian-plus-text-faint: var(--text-faint);
  --claudian-plus-text-accent: var(--text-accent);
  --claudian-plus-text-on-accent: var(--text-on-accent);

  /* Borders */
  --claudian-plus-border: var(--background-modifier-border);
  --claudian-plus-border-hover: var(--background-modifier-border-hover);
  --claudian-plus-border-focus: var(--background-modifier-border-focus);

  /* Interactive */
  --claudian-plus-accent: var(--interactive-accent);
  --claudian-plus-accent-hover: var(--interactive-accent-hover);
  --claudian-plus-interactive-normal: var(--interactive-normal);
  --claudian-plus-interactive-hover: var(--interactive-hover);
}
```

**Step 2: Register the module in `src/style/index.css`**

Insert after line 5 (`@import "./base/variables.css";`):

```css
@import "./base/tokens.css";
```

**Step 3: Build and verify**

Run: `npm run build:css`
Expected: exit 0; `styles.css` regenerated and now contains a `base/tokens.css` section header (check with `Select-String -Path styles.css -Pattern 'base/tokens.css'`).

**Step 4: Commit**

```bash
git add src/style/base/tokens.css src/style/index.css styles.css
git commit -m "feat(style): add Obsidian-mapped semantic token layer"
```

---

### Task 2: Ratchet test against hard-coded colors (failing first)

**Files:**
- Test: `tests/unit/style/style-tokens.test.ts` (create the `tests/unit/style/` directory)

**Step 1: Write the failing test**

```ts
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const STYLE_DIR = join(__dirname, '..', '..', '..', 'src', 'style');

// Files allowed to contain literal colors:
// - variables.css: provider brand identity colors + rgb triplets for alpha compositing
// - tokens.css: fallback literals inside var()
const ALLOWLIST = new Set(['base/variables.css', 'base/tokens.css']);

function collectCssFiles(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectCssFiles(full, base));
    } else if (entry.endsWith('.css') && entry !== 'index.css') {
      out.push(relative(base, full).split('\\').join('/'));
    }
  }
  return out;
}

// Flag hex literals, and rgb()/rgba() only when the first argument is a
// numeric literal (rgba(var(--x-rgb), 0.1) token composition is fine).
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const NUMERIC_RGB = /rgba?\(\s*\d/;

describe('style token migration ratchet', () => {
  it('no style module outside the allowlist uses hard-coded colors', () => {
    const offenders: string[] = [];
    for (const file of collectCssFiles(STYLE_DIR)) {
      if (ALLOWLIST.has(file)) continue;
      const content = readFileSync(join(STYLE_DIR, file), 'utf-8');
      // Strip comments before scanning.
      const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
      if (HEX.test(stripped) || NUMERIC_RGB.test(stripped)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node scripts/run-jest.js tests/unit/style/style-tokens.test.ts`
Expected: FAIL, listing ~21 offender files (all modules except `index.css`, `base/variables.css`, `base/tokens.css` that still contain literals).

**Step 3: Commit**

```bash
git add tests/unit/style/style-tokens.test.ts
git commit -m "test(style): add ratchet against hard-coded colors in style modules"
```

---

### Task 3: Migrate `base/variables.css` status colors to Obsidian mappings

Provider brand colors stay literal (they are identity, not theme). Status colors map to Obsidian semantics; the `-rgb` triplets stay literal because Obsidian exposes no rgb-triplet status variables (documented tradeoff for `rgba(var(--x-rgb), a)` compositing).

**Files:**
- Modify: `src/style/base/variables.css:15-22`

**Step 1: Replace the status color block**

In `src/style/base/variables.css`, replace lines 15-22:

```css
  /* Status Colors */
  --claudian-plus-error: #ef4444;
  --claudian-plus-error-rgb: 239, 68, 68;
  --claudian-plus-success: #10b981;
  --claudian-plus-success-rgb: 16, 185, 129;
  --claudian-plus-warning: #f59e0b;
  --claudian-plus-warning-rgb: 245, 158, 11;
  --claudian-plus-compact: #3b82f6;
```

with:

```css
  /* Status Colors: Obsidian semantics with fallback to the previous palette.
     The -rgb triplets stay literal (Obsidian exposes no rgb status vars) for
     rgba(var(--x-rgb), a) alpha compositing. */
  --claudian-plus-error: var(--text-error, #ef4444);
  --claudian-plus-error-rgb: 239, 68, 68;
  --claudian-plus-success: var(--text-success, #10b981);
  --claudian-plus-success-rgb: 16, 185, 129;
  --claudian-plus-warning: var(--text-warning, #f59e0b);
  --claudian-plus-warning-rgb: 245, 158, 11;
  --claudian-plus-compact: var(--color-blue, #3b82f6);
```

**Step 2: Build + test**

Run: `npm run build:css && node scripts/run-jest.js tests/unit/style/style-tokens.test.ts`
Expected: build exit 0; test still FAILS (allowlist covers `variables.css`; offenders list unchanged).

**Step 3: Commit**

```bash
git add src/style/base/variables.css styles.css
git commit -m "feat(style): map status color tokens to Obsidian theme variables"
```

---

### Task 4: Migrate the settings batch

The two biggest offenders: `settings/base.css` (12 hex + 10 rgba) and `settings/workspace-resources.css` (4 hex + 4 rgba).

**Files:**
- Modify: `src/style/settings/base.css`
- Modify: `src/style/settings/workspace-resources.css`

**Step 1: Inventory the literals**

Run: `Select-String -Path src/style/settings/base.css, src/style/settings/workspace-resources.css -Pattern '#[0-9a-fA-F]{3,8}|rgba?\('`
Read each match in context and classify: surface / text / border / accent / status.

**Step 2: Replace literals with tokens**

Mapping rules (apply in order):

| Literal context | Replacement |
| --- | --- |
| background colors on panels/cards/inputs | `var(--claudian-plus-surface-primary|secondary|alt)` |
| hover overlays (`rgba(0,0,0,…)` washes) | `var(--claudian-plus-surface-hover)` |
| text colors | `var(--claudian-plus-text-normal|muted|faint)` |
| accent text/links/active states | `var(--claudian-plus-text-accent)` / `var(--claudian-plus-accent)` |
| borders | `var(--claudian-plus-border|border-hover|border-focus)` |
| interactive fills | `var(--claudian-plus-interactive-normal|interactive-hover)` |
| error/success/warning | `var(--claudian-plus-error|success|warning)`; alpha washes use `rgba(var(--claudian-plus-error-rgb), 0.1)` style composition |

If no rule fits (e.g. a one-off highlight), keep the literal and add it to the test's per-file allowlist entry with a comment — never force a wrong token.

**Step 3: Build + run ratchet**

Run: `npm run build:css && node scripts/run-jest.js tests/unit/style/style-tokens.test.ts`
Expected: build exit 0; offenders list no longer contains the two settings files.

**Step 4: Commit**

```bash
git add src/style/settings/base.css src/style/settings/workspace-resources.css styles.css
git commit -m "refactor(style): migrate settings modules to design tokens"
```

---

### Task 5: Migrate the components batch

**Files:**
- Modify: `src/style/components/tabs.css` (5 hex)
- Modify: `src/style/components/input.css` (4 hex)
- Modify: `src/style/components/messages.css` (1 hex + 2 rgba)
- Modify: `src/style/components/context-footer.css` (2 hex)
- Modify: `src/style/components/code.css` (2 rgba)
- Modify: `src/style/components/history.css` (1 rgba)
- Modify: `src/style/components/nav-sidebar.css` (1 rgba)

**Step 1: Inventory**

Run: `Select-String -Path src/style/components/*.css -Pattern '#[0-9a-fA-F]{3,8}|rgba?\('`

**Step 2: Replace using the Task 4 mapping table.**

**Step 3: Build + run ratchet**

Run: `npm run build:css && node scripts/run-jest.js tests/unit/style/style-tokens.test.ts`
Expected: offenders list no longer contains any `components/` file.

**Step 4: Commit**

```bash
git add src/style/components styles.css
git commit -m "refactor(style): migrate component modules to design tokens"
```

---

### Task 6: Migrate features, toolbar, modals, and base/animations

All remaining small offenders (1–4 occurrences each):

**Files:**
- Modify: `src/style/base/animations.css` (4 rgba)
- Modify: `src/style/features/diff.css`, `file-context.css`, `image-context.css`, `image-modal.css`, `plan-mode.css`, `resume-session.css`, `slash-commands.css`
- Modify: `src/style/modals/mcp-modal.css`
- Modify: `src/style/settings/mcp-settings.css` (1 rgba)
- Modify: `src/style/toolbar/external-context.css`, `mcp-selector.css`, `model-selector.css`, `permission-toggle.css`, `thinking-selector.css`

Note: `features/diff.css` diff colors (added/removed lines) map to `var(--claudian-plus-success)` / `var(--claudian-plus-error)` washes via the `-rgb` composition pattern.

**Step 1: Inventory**

Run: `Select-String -Path src/style/features/*.css, src/style/toolbar/*.css, src/style/modals/*.css, src/style/base/animations.css, src/style/settings/mcp-settings.css -Pattern '#[0-9a-fA-F]{3,8}|rgba?\('`

**Step 2: Replace using the Task 4 mapping table.**

**Step 3: Build + run ratchet to green**

Run: `npm run build:css && node scripts/run-jest.js tests/unit/style/style-tokens.test.ts`
Expected: test **PASSES** — offenders list empty.

**Step 4: Commit**

```bash
git add src/style styles.css
git commit -m "refactor(style): migrate remaining modules to design tokens; ratchet green"
```

---

### Task 7: Radius / shadow / transition adoption sweep

Exact-match replacements only; no layout-affecting values change.

**Files:**
- Modify: any `src/style/**/*.css` with exact matches below

**Step 1: Find exact-match candidates**

Run: `Select-String -Path src/style/**/*.css -Pattern 'border-radius:\s*(4|6|8|12|16)px|border-radius:\s*9999px'`
Run: `Select-String -Path src/style/**/*.css -Pattern '(120|200|240)ms'`

**Step 2: Replace exact matches**

| Literal | Token |
| --- | --- |
| `border-radius: 4px` | `var(--claudian-plus-radius-xs)` |
| `border-radius: 6px` | `var(--claudian-plus-radius-sm)` |
| `border-radius: 8px` | `var(--claudian-plus-radius-md)` |
| `border-radius: 12px` | `var(--claudian-plus-radius-lg)` |
| `border-radius: 16px` | `var(--claudian-plus-radius-xl)` |
| `border-radius: 9999px` | `var(--claudian-plus-radius-full)` |
| `120ms cubic-bezier(0.4, 0, 0.2, 1)` | `var(--claudian-plus-transition-fast)` |
| `200ms cubic-bezier(0.4, 0, 0.2, 1)` | `var(--claudian-plus-transition-normal)` |
| `240ms cubic-bezier(0.22, 1, 0.36, 1)` | `var(--claudian-plus-transition-bounce)` |

Skip compound values (`border-radius: 8px 8px 0 0`), calc expressions, and one-off durations — only exact whole-value matches.

**Step 3: Build + full test suite**

Run: `npm run build:css && node scripts/run-jest.js`
Expected: build exit 0; test failure list identical to the pre-M1 baseline (no new failures).

**Step 4: Commit**

```bash
git add src/style styles.css
git commit -m "refactor(style): adopt radius and transition tokens via exact-match sweep"
```

---

### Task 8: Docs and final verification

**Files:**
- Modify: `src/style/AGENTS.md`

**Step 1: Update the style guide**

In `src/style/AGENTS.md`, update the structure tree: add `tokens.css` under `base/` and a Conventions bullet:

```markdown
- Reference semantic tokens from `base/tokens.css` and `base/variables.css` instead of hard-coded colors/radii; `tests/unit/style/style-tokens.test.ts` enforces this.
```

**Step 2: Full verification**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: typecheck/lint/build exit 0; test failures identical to baseline.

**Step 3: Manual theme spot-check (human)**

- Reload the plugin in Obsidian under default light + dark: chat, settings, diff, plan-mode surfaces render unchanged.
- Switch to the Minimal theme: surfaces follow the theme.

**Step 4: Commit**

```bash
git add src/style/AGENTS.md
git commit -m "docs(style): document token layer and ratchet test in style guide"
```
