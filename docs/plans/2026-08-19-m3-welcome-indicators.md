# M3: Welcome + Indicators Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Wire the M2 blob engine into user-visible surfaces: (a) Welcome page — day-to-day empty session as native empty state (centered blob idle rotation + greeting + 3 recent conversations + quick actions) and a one-time onboarding sequence (starting from `curious`, 1200ms per mood, even = `idle`, odd = `ONBOARDING` cycle) on first install / upgrade to 3.0; (b) Working indicators — small (~20px) blob instances near the composer and per tab, playing `thinking`/`writing` while the agent works, replacing text-only “Generating…”. All surfaces reuse `src/shared/blob` and token colors; no provider or storage format changes.

**Architecture:** `src/shared/blob` remains the sole owner of the engine (no copy-paste). Welcome UI lives in `src/features/chat/ui/` (replacing `LightweightCubeWelcome`/`ConstellationCubeWelcome`), tab indicators live in `src/features/chat/tabs/` and composer indicator in `src/features/chat/ui/` near `InputController`. A tiny `WelcomeService` (pure data) provides `getRecentConversations(n=3)` and `shouldShowOnboarding()` (backed by `SharedStorageService` flag `blob.onboardingSeen`). Engine instances are per-surface (welcome large, composer small, tab small) and share the same `BlobStateMachine` mapping: `idle`↔ empty, `listening`↔ input focused, `thinking`↔ reasoning, `writing`↔ streaming, `error`↔ failure, `celebrate`↔ completion. `ChatRuntime`/`TabManager` contracts unchanged; we only read `ChatState` / `StreamController` status to drive `setEvent`.

**Tech Stack:** TypeScript, `src/shared/blob` engine, plain CSS via `scripts/build-css.mjs` (tokens only), `SharedStorageService` / `VaultFileAdapter` for onboarding flag, Jest + ts-jest.

**Reference:** design doc `docs/plans/2026-08-19-v3-ux-overhaul-design.md` §2 “Four surfaces” + §6 M3; M2 plan `docs/plans/2026-08-19-m2-blob-engine.md` (engine API); token contract `src/style/base/tokens.css`; conventions `AGENTS.md`, `src/features/chat/AGENTS.md`, `src/style/AGENTS.md`; reference repo `https://github.com/w210548735-art/grok_bot-icon-study` tables `ONBOARDING`/`ONBOARDING_MS`/`onboardMood` (already documented in M2).

**Known baseline:** Windows sandbox — `jest` must be `node scripts/run-jest.js --runInBand <path>`; `npm run build` spawns esbuild; full suite baseline 6 suites / 14 tests pre-existing failures; M3 must not grow it. Full suite ~7-8 min, iterate on focused files.

---

### Task 1: Welcome data service (TDD, pure)

**Files:**
- Create: `src/features/chat/services/WelcomeService.ts`
- Test: `tests/unit/features/chat/services/WelcomeService.test.ts`

**Step 1: Write failing test**

```ts
import { WelcomeService } from '@/features/chat/services/WelcomeService';
describe('WelcomeService', () => {
  it('returns empty when no conversations', () => { ... });
  it('returns 3 most recent sorted by lastActive desc', () => { ... });
  it('shouldShowOnboarding false when flag seen', () => { ... });
  it('shouldShowOnboarding true on first install', () => { ... });
  it('markOnboardingSeen persists', () => { ... });
});
```
Inject a fake `ConversationStore` (array) and fake `Storage` for `blob.onboardingSeen`.

**Step 2: Run to verify failure**

```bash
node scripts/run-jest.js --runInBand tests/unit/features/chat/services/WelcomeService.test.ts
```
Expected: FAIL (module not found).

**Step 3: Implement** `WelcomeService.ts` — pure, no DOM, no provider imports; reads recent conversations via `SharedStorageService` or passed array, sorts by `updatedAt`, slices 3; wraps `blob.onboardingSeen` boolean in `localStorage`/`SharedStorageService`.

**Step 4: Verify**

```bash
node scripts/run-jest.js --runInBand tests/unit/features/chat/services/WelcomeService.test.ts
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/chat/services/WelcomeService.ts tests/unit/features/chat/services/WelcomeService.test.ts
git commit -m "feat(chat): add welcome data service (TDD)"
```

---

### Task 2: Welcome page UI (blob large + greeting + recents + quick actions)

**Files:**
- Create: `src/features/chat/ui/BlobWelcomeView.ts`
- Create: `src/style/components/blob-welcome.css`
- Modify: `src/style/index.css` (add `@import "./components/blob-welcome.css";`)
- Modify: `src/features/chat/ui/LightweightCubeWelcome.ts` (keep but deprecate, or leave untouched; new view is used when flag `welcomeBlob` true)

**Step 1: Implement `BlobWelcomeView.ts`**

Mounts into `ClaudianPlusView` empty-state container:
- `createBlobEngine(host, {size:'large'})` with initial `idle` rotation
- Greeting: `Good {morning|afternoon|evening}, {vaultName}` (token `var(--text-normal)`)
- Recent list: `WelcomeService.getRecentConversations(3)` → rows with title, `ProviderRegistry` icon, first-message preview, relative time; click → `ConversationController.open`
- Quick actions: `New session` / `Open settings` / `Show onboarding again`

No `console.*`, CSS only via tokens.

**Step 2: Style**

`blob-welcome.css`:
```css
.claudian-plus-welcome { display:flex; flex-direction:column; align-items:center; gap:16px; padding:24px; }
.claudian-plus-welcome__blob { width:120px; height:120px; }
.claudian-plus-welcome__recents { width:100%; max-width:420px; }
```
Colors via `var(--claudian-plus-surface-*)` / `var(--claudian-plus-text-*)`.

**Step 3: Register style**

Insert in `src/style/index.css` after `blob-preview.css`:
```css
@import "./components/blob-welcome.css";
```

**Step 4: Build and verify**

```bash
npm run build:css
Select-String -Path styles.css -Pattern 'blob-welcome'
node scripts/run-jest.js --runInBand tests/unit/style/style-tokens.test.ts
```
Expected: build exit 0, style-tokens PASS (no #hex).

**Step 5: Commit**

```bash
git add src/features/chat/ui/BlobWelcomeView.ts src/style/components/blob-welcome.css src/style/index.css styles.css
git commit -m "feat(chat): add blob welcome view with recents and quick actions"
```

---

### Task 3: Onboarding sequence (one-time, 1200ms, curious start)

**Files:**
- Modify: `src/features/chat/ui/BlobWelcomeView.ts` (add `playOnboarding()`)
- Modify: `src/features/chat/services/WelcomeService.ts` (add `onboardingMood(n)` helper)
- Test: `tests/unit/features/chat/services/WelcomeService.test.ts` (add onboarding cases)

**Step 1: Extend failing test**

Add to `WelcomeService.test.ts`:
```ts
it('onboardingMood(0)=idle, 1=curious, 2=idle, 3=happy ...', () => { ... });
it('ONBOARDING_MS=1200', () => { ... });
```

**Step 2: Run to verify failure**

```bash
node scripts/run-jest.js --runInBand tests/unit/features/chat/services/WelcomeService.test.ts
```
Expected: FAIL (helper missing).

**Step 3: Implement**

Reuse M2 `replica/src/tables.js` `ONBOARDING = ["curious","happy","playful","excited","listening","proud","laughing","shy"]`, `ONBOARDING_MS=1200`, `onboardMood(n) => n%2===0 ? "idle" : ONBOARDING[(n-1)/2 % ONBOARDING.length]`. In `BlobWelcomeView`, if `WelcomeService.shouldShowOnboarding()` is true, play sequence: `let n=1; setInterval(1200, () => engine.setState(onboardMood(n++)))` starting from `curious` (n=1), stop after 16 steps or on user interaction, then `markOnboardingSeen()`.

Persist flag via `SharedStorageService` key `blob.onboardingSeen` (or `localStorage` fallback for tests).

**Step 4: Verify**

```bash
node scripts/run-jest.js --runInBand tests/unit/features/chat/services/WelcomeService.test.ts
npm run typecheck
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/chat/ui/BlobWelcomeView.ts src/features/chat/services/WelcomeService.ts tests/unit/features/chat/services/WelcomeService.test.ts
git commit -m "feat(chat): add one-time onboarding sequence from curious (TDD)"
```

---

### Task 4: Composer mini blob indicator (20px)

**Files:**
- Create: `src/features/chat/ui/ComposerBlobIndicator.ts`
- Modify: `src/features/chat/ClaudianPlusView.ts` (mount point near composer)
- Test: `tests/unit/features/chat/ui/ComposerBlobIndicator.test.ts` (state mapping, not DOM pixels)

**Step 1: Write failing test**

```ts
describe('ComposerBlobIndicator', () => {
  it('shows listening when input focused', () => { ... });
  it('shows thinking when stream starts', () => { ... });
  it('shows writing while streaming', () => { ... });
  it('hides when idle', () => { ... });
});
```
Mock `createBlobEngine` with fake container.

**Step 2: Run to verify failure**

```bash
node scripts/run-jest.js --runInBand tests/unit/features/chat/ui/ComposerBlobIndicator.test.ts
```
Expected: FAIL.

**Step 3: Implement** `ComposerBlobIndicator.ts` — tiny wrapper around `createBlobEngine(small)` mounted to composer toolbar; exposes `setAgentState({isStreaming, isThinking, hasError})` → maps to `BlobEvent`.

Mount in `ClaudianPlusView` beside `InputController` (keep existing `InputController` untouched, only add host `<div class="claudian-plus-composer-blob">`).

**Step 4: Verify**

```bash
node scripts/run-jest.js --runInBand tests/unit/features/chat/ui/ComposerBlobIndicator.test.ts
npm run build:css && node scripts/run-jest.js --runInBand tests/unit/style/style-tokens.test.ts
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/chat/ui/ComposerBlobIndicator.ts src/features/chat/ClaudianPlusView.ts tests/unit/features/chat/ui/ComposerBlobIndicator.test.ts
git commit -m "feat(chat): add composer mini blob indicator"
```

---

### Task 5: Tab mini blob indicator (per-tab, 20px)

**Files:**
- Modify: `src/features/chat/tabs/TabManager.ts` (add `blobState` per tab, no contract change)
- Create: `src/features/chat/tabs/TabBlobIndicator.ts`
- Test: `tests/unit/features/chat/tabs/TabBlobIndicator.test.ts`

**Step 1: Write failing test**

Verify per-tab state is isolated, `setTabState(tabId, 'thinking')` only affects that tab's blob, close disposes engine.

**Step 2: Run to verify failure**

```bash
node scripts/run-jest.js --runInBand tests/unit/features/chat/tabs/TabBlobIndicator.test.ts
```
Expected: FAIL.

**Step 3: Implement**

`TabBlobIndicator.ts` manages `Map<tabId, BlobEngine>` (small). `TabManager` keeps `blobState` as derived from `ChatState` stream status; no persistence, cold-start as before. Tab bar renders `<span class="claudian-plus-tab-blob">` with `createBlobEngine` small.

Keep `TabManager`/`ChatState` contracts unchanged (only UI layer reads status).

**Step 4: Verify**

```bash
node scripts/run-jest.js --runInBand tests/unit/features/chat/tabs/TabBlobIndicator.test.ts
npm run build
```
Expected: PASS, build exit 0.

**Step 5: Commit**

```bash
git add src/features/chat/tabs/TabBlobIndicator.ts src/features/chat/tabs/TabManager.ts tests/unit/features/chat/tabs/TabBlobIndicator.test.ts
git commit -m "feat(chat): add per-tab mini blob indicator"
```

---

### Task 6: Wire blob state to agent state

**Files:**
- Modify: `src/features/chat/controllers/StreamController.ts` (emit events)
- Modify: `src/features/chat/ui/ComposerBlobIndicator.ts`
- Modify: `src/features/chat/tabs/TabBlobIndicator.ts`
- Test: `tests/unit/features/chat/controllers/StreamController.test.ts` (extend, not new file) or `tests/unit/features/chat/services/BlobStateWiring.test.ts`

**Step 1: Write failing test**

```ts
it('stream start -> thinking, chunk -> writing, end -> celebrate then idle', () => {
  // fake StreamController + BlobStateMachine
});
it('error -> bang', () => { ... });
```

**Step 2: Run to verify failure**

```bash
node scripts/run-jest.js --runInBand tests/unit/features/chat/controllers/StreamController.test.ts
```
Expected: FAIL (new expectations).

**Step 3: Implement wiring**

- `StreamController` on `onStart` → `composerBlob.setEvent('streamStart')` + `tabBlob.setEvent('streamStart')`
- On `onChunk` → ensure `thinking`→`writing` loop
- On `onEnd` → `success` → `celebrate` then `reset` after 1500ms
- On `onError` → `error`
- Input focus/blur → `listening`/`idle` via `InputController` events

No provider logic; only reads `StreamController` status.

**Step 4: Verify**

```bash
node scripts/run-jest.js --runInBand tests/unit/features/chat/controllers/StreamController.test.ts
node scripts/run-jest.js --runInBand tests/unit/features/chat/tabs/TabBlobIndicator.test.ts
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/chat/controllers/StreamController.ts src/features/chat/ui/ComposerBlobIndicator.ts src/features/chat/tabs/TabBlobIndicator.ts
git commit -m "feat(chat): wire blob state to agent stream and input"
```

---

### Task 7: Persistence + appearance setting

**Files:**
- Modify: `src/app/settings.ts` (or `src/shared/settings` defaults) — add `appearance.blobEnabled` default true
- Modify: `src/features/settings/` (add toggle under Appearance)
- Test: `tests/unit/app/settings.test.ts` or `tests/unit/features/settings/BlobSettings.test.ts`

**Step 1: Write failing test**

Verify default `blobEnabled=true`, toggle persists via `SharedStorageService`, and `WelcomeService` respects flag (when false, fallback to legacy welcome).

**Step 2: Run to verify failure**

```bash
node scripts/run-jest.js --runInBand tests/unit/app/settings.test.ts
```
Expected: FAIL.

**Step 3: Implement** — add `blobEnabled` to defaults, add UI toggle in `Appearance` category (reuse settings shell, no provider changes), gate all three blob surfaces on flag.

**Step 4: Verify**

```bash
node scripts/run-jest.js --runInBand tests/unit/app/settings.test.ts
npm run typecheck
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/app/settings.ts src/features/settings/* tests/unit/app/settings.test.ts
git commit -m "feat(settings): add blob toggle under Appearance"
```

---

### Task 8: Docs, perf, and final verification

**Files:**
- Modify: `src/shared/blob/README.md` (add M3 usage)
- Modify: `src/features/chat/CLAUDE.md` or `AGENTS.md` (note welcome + indicators)
- Modify: `docs/plans/2026-08-19-v3-ux-overhaul-design.md` §6 (mark M3 done if needed, or leave)

**Step 1: Finalize docs**

Add to `README.md` under `## Usage`:
- Welcome large (120px) idle, onboarding 1200ms curious start, once
- Composer small (20px) and tab small (20px) lifecycle
- Token mapping table already in M2, now used in welcome/composer/tab

**Step 2: Full verification**

```bash
npm run typecheck && npm run lint && npm run build
node scripts/run-jest.js --runInBand tests/unit/features/chat/services/WelcomeService.test.ts
node scripts/run-jest.js --runInBand tests/unit/features/chat/ui/ComposerBlobIndicator.test.ts
node scripts/run-jest.js --runInBand tests/unit/style/style-tokens.test.ts
```
Full suite separately (7-8 min):
```bash
node scripts/run-jest.js --runInBand
```
Expected: `typecheck/lint/build` exit 0; focused tests PASS; `style-tokens` PASS; full suite failures identical to baseline (6 suites / 14 tests).

**Step 3: Manual visual spot-check (human)**

- New vault (no `blob.onboardingSeen`) → onboarding plays `curious` → `idle` cycle 1200ms, then stops
- Empty session → centered blob idle + 3 recents + quick actions, Minimal / light / dark follow theme
- Focus composer → mini blob `listening`, start stream → `thinking` → `writing`, finish → `celebrate` → `idle`
- Tab with running stream shows `thinking`/`writing` mini, idle tab shows `idle` or hidden
- Toggle `Appearance → Blob` off → all blobs hidden, fallback to text hints, no rAF

**Step 4: Commit**

```bash
git add src/shared/blob/README.md
git commit -m "docs(blob): document welcome and indicator usage (M3)"
```

---

**Per-task discipline:**
- TDD: failing test first, then minimal implementation; `git status` before each commit to ensure only planned files are staged
- Commit messages / code / comments in English; no new production dependencies; no changes to `src/core/`, `src/providers/`
- Keep `src/shared/blob` as sole owner of engine; all colors via tokens (`--claudian-plus-*`), no hard-coded hex/rgb outside `base/variables.css` / `base/tokens.css`
