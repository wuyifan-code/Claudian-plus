# M4: Blob Welcome Follow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Make only the welcome page large blob (120px) follow the mouse globally above the input, constrained to a small 6px circle with subtle squash/stretch, gated by a settings toggle. Small composer/tab indicators remain static.

**Architecture:** `src/shared/blob/BlobEngine` gains `followPointer` mode (global `pointermove` + `mapPointer` → small-circle clamp). `BlobWelcomeView` exposes `followPointer` (default true for welcome, false for indicators). `MessageRenderer` reads `settings.blobFollowPointer` (default true) and passes it to welcome; the follow area is the view container above the input (full width), not just the blob host. `BlobController`'s existing `visibilitychange` + `IntersectionObserver` continues to pause rAF; no new dependencies.

**Tech Stack:** TypeScript, SVG, `requestAnimationFrame`, `IntersectionObserver`, `window.pointermove`, plain CSS tokens, Jest + ts-jest.

**Reference:** design doc `docs/plans/2026-08-19-v3-ux-overhaul-design.md` §2; M2 engine `src/shared/blob/BlobEngine.ts` (state machine, springs, eye morph); reference repo `https://github.com/w210548735-art/grok_bot-icon-study` `replica/src/math.js:mapPointer` and `replica/src/character.js:_updatePointer` / `gaze` springs (already documented in M2).

**Known baseline:** Windows sandbox — `jest` must be `node scripts/run-jest.js --runInBand`; full suite baseline 6 suites / 14 tests failures; M4 must not grow it.

---

### Task 1: Settings toggle (TDD)

**Files:**
- Modify: `src/core/types/settings.ts` (add `blobFollowPointer?: boolean`)
- Modify: `src/app/settings/defaultSettings.ts` (default `true`)
- Modify: `src/features/settings/ClaudianPlusSettings.ts` (Appearance toggle)
- Test: `tests/unit/app/settings/BlobFollow.test.ts` (new) or extend `BlobSettings.test.ts` if exists
- Modify: `src/i18n/locales/zh-CN.json`, `en.json`, `zh-TW.json` (i18n for toggle)

**Step 1: Write failing test**

```ts
import { DEFAULT_CLAUDIAN_PLUS_SETTINGS } from '@/app/settings/defaultSettings';
describe('blob follow setting', () => {
  it('defaults to true', () => { expect(DEFAULT_CLAUDIAN_PLUS_SETTINGS.blobFollowPointer).toBe(true); });
});
```

**Step 2: Run to verify failure**

```bash
node scripts/run-jest.js --runInBand tests/unit/app/settings/BlobFollow.test.ts
```
Expected: FAIL (property missing).

**Step 3: Implement** types + defaults + settings UI toggle under Appearance (reuse `createCard` pattern), i18n keys `settings.blobFollow.name/desc`.

**Step 4: Verify**

```bash
node scripts/run-jest.js --runInBand tests/unit/app/settings/BlobFollow.test.ts
npm run typecheck
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/types/settings.ts src/app/settings/defaultSettings.ts src/features/settings/ClaudianPlusSettings.ts src/i18n/locales/* tests/unit/app/settings/BlobFollow.test.ts
git commit -m "feat(settings): add blob follow pointer toggle"
```

---

### Task 2: Follow math (TDD)

**Files:**
- Create: `src/shared/blob/BlobFollow.ts`
- Test: `tests/unit/shared/blob/BlobFollow.test.ts`

**Step 1: Write failing test**

Covers: `mapToSmallCircle(dx,dy, radius=6)` clamps, `calcSquash(dist)` 0.03-0.05, `mapPointer` ellipse mapping.

**Step 2: Run to verify failure**

```bash
node scripts/run-jest.js --runInBand tests/unit/shared/blob/BlobFollow.test.ts
```
Expected: FAIL (module not found).

**Step 3: Implement** `BlobFollow.ts` extracting `mapPointer` from reference (JFe=0.6, ain=22, iin=14, oin=2) and helpers.

**Step 4: Verify**

```bash
node scripts/run-jest.js --runInBand tests/unit/shared/blob/BlobFollow.test.ts
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/blob/BlobFollow.ts tests/unit/shared/blob/BlobFollow.test.ts
git commit -m "feat(blob): add follow math with small-circle clamp (TDD)"
```

---

### Task 3: Engine followPointer

**Files:**
- Modify: `src/shared/blob/BlobEngine.ts` (add `followPointer`, pointer listeners, gaze springs, tx/ty/squash/rot follow)
- Modify: `src/shared/blob/types.ts` (add `followPointer?: boolean` to opts if needed)
- Modify: `src/shared/blob/BlobRenderer.ts` if eye gaze offset needed

**Step 1: Implement**

In `createBlobEngine(container, opts)`:
- If `opts.followPointer`, add `window.addEventListener('pointermove', {passive:true})` + `pointerleave` to clear `pointerRaw`; cache `container.getBoundingClientRect` every 100ms; map via `BlobFollow.mapPointer` to `txSpring.t/tySpring.t` and `gazeX/Y`, with `squash` from distance; on `destroy`, remove listeners.
- Small indicators (`size:'small'`) default `followPointer:false`.

**Step 2: Build and verify**

```bash
npm run typecheck
node scripts/run-jest.js --runInBand tests/unit/shared/blob/BlobFollow.test.ts
node scripts/run-jest.js --runInBand tests/unit/style/style-tokens.test.ts
```
Expected: PASS, no hex.

**Step 3: Commit**

```bash
git add src/shared/blob/BlobEngine.ts src/shared/blob/types.ts
git commit -m "feat(blob): add welcome followPointer with global pointer tracking"
```

---

### Task 4: Welcome view global follow wiring

**Files:**
- Modify: `src/features/chat/ui/BlobWelcomeView.ts` (accept `followPointer` and pass to engine)
- Modify: `src/features/chat/rendering/MessageRenderer.ts` (read `settings.blobFollowPointer` and pass to welcome; follow area = view container above input, not just blob host)

**Step 1: Implement**

`BlobWelcomeView` constructor takes `followPointer?: boolean` and forwards to `createBlobEngine(blobHost, {size:'large', followPointer})`.
`MessageRenderer.renderMessages`:
```ts
const follow = this.plugin.settings.blobFollowPointer !== false;
const view = new BlobWelcomeView({ vaultName, followPointer: follow });
```
And ensure the pointer listener in engine uses `viewContainerEl` (input-above full width) as the rect source: pass the container's `getBoundingClientRect` via a `getRect` callback or by observing `viewContainerEl` instead of `blobHost`.

**Step 2: Build and verify**

```bash
npm run build:css
Select-String -Path styles.css -Pattern 'blob'
node scripts/run-jest.js --runInBand tests/unit/features/chat/services/WelcomeService.test.ts
```
Expected: build exit 0, style-tokens PASS.

**Step 3: Commit**

```bash
git add src/features/chat/ui/BlobWelcomeView.ts src/features/chat/rendering/MessageRenderer.ts
git commit -m "feat(chat): wire welcome blob global follow above input"
```

---

### Task 5: Preview and final verification

**Files:**
- Modify: `src/shared/blob/preview.ts` (add follow toggle button for manual test)
- Modify: `src/shared/blob/README.md` (document followPointer, radius, area)

**Step 1: Implement preview toggle**

Add a checkbox/button in the floating preview to toggle `followPointer` live.

**Step 2: Update docs**

`README.md` add section `## Follow` describing `followPointer`, 6px clamp, above-input full-width area, setting gate.

**Step 3: Full verification**

```bash
npm run typecheck && npm run lint && npm run build
node scripts/run-jest.js --runInBand tests/unit/shared/blob
node scripts/run-jest.js --runInBand tests/unit/style/style-tokens.test.ts
```
Full suite separately (7-8 min):
```bash
node scripts/run-jest.js --runInBand
```
Expected: `typecheck/lint/build` exit 0; focused tests PASS; full suite failures identical to baseline (6 suites / 14 tests).

**Step 4: Manual visual spot-check (human)**

- Settings → Appearance → Blob Follow toggle on/off
- Welcome large blob follows mouse when pointer is above input, across full width, displacement ≤6px with subtle squash/stretch; eyes track; outside area or toggle off → static breathing only; sidebar hidden → paused

**Step 5: Commit**

```bash
git add src/shared/blob/preview.ts src/shared/blob/README.md
git commit -m "docs(blob): document welcome followPointer and preview toggle"
```

---

**Per-task discipline:**
- TDD: failing test first, then minimal implementation; `git status` before each commit to ensure only planned files are staged
- Commit messages / code / comments in English; no new production dependencies; no changes to `src/core/` beyond `blobFollowPointer` type/default and settings UI; keep colors via tokens (`--claudian-plus-*`), no hard-coded hex/rgb outside `base/variables.css` / `base/tokens.css`
