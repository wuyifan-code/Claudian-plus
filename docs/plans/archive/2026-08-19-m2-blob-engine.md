# M2: Blob Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Deliver a self-contained blob mascot engine in `src/shared/blob/` — state-machine driven (idle / listening / thinking / writing / error / celebrate, six states), spring physics + eye polygon morph + overlay effects, SVG + `requestAnimationFrame` rendering, colors exclusively via `src/style/base/tokens.css` (`--claudian-plus-surface-*`, `--claudian-plus-text-*`), so light/dark and community themes follow automatically. The engine pauses its rAF loop when the sidebar is hidden (`visibilitychange` + `IntersectionObserver`) and exposes measurable idle CPU. This milestone only ships the engine + an internal preview entry; welcome page integration is M3.

**Architecture:** Shared UI asset `src/shared/blob/` is independent from `src/core/` and `src/providers/*/` (no provider boundaries touched). Layers: pure-logic (state machine / spring / eye lerp — deterministic, unit-testable) → renderer (SVG + rAF, DOM-coupled, documented as not directly unit-testable) → controller (visibility pause, token color binding, lifecycle) → internal preview (floating layer / hidden command, not the welcome page). Geometry and eye UI are **directly reused** from the reference repo `grok_bot-icon-study` `extracted/` (user correction 2026-08-20: reuse allowed, attribution required); all other logic is authored in this repo. A declaration is added to `src/shared/blob/README.md`.

**Tech Stack:** TypeScript (no new production dependencies), SVG, `requestAnimationFrame`, `IntersectionObserver` + `document.visibilitychange`, plain CSS via `scripts/build-css.mjs`, Jest + ts-jest.

**Reference:** design doc `docs/plans/2026-08-19-v3-ux-overhaul-design.md` §2 / §6 M2; token contract `src/style/base/tokens.css` + `src/style/base/variables.css`; conventions `AGENTS.md`, `src/style/AGENTS.md`, `src/features/chat/AGENTS.md`; reference repo https://github.com/w210548735-art/grok_bot-icon-study (`extracted/` architecture + geometry reused with attribution, see `src/shared/blob/README.md`).

**Known baseline:** Windows sandbox — `jest` must be single-process `node scripts/run-jest.js --runInBand <path>` (otherwise spawn EPERM); `npm run build` spawns esbuild child process, if EPERM switch terminal/elevate. Full suite baseline is 6 suites / 14 tests pre-existing failures (Windows path-mocking, sandbox spawn); M2 must not grow it. Full suite ~7-8 min, iterate on focused files.

---

### Task 1: Reference study + scaffold shared blob module

**Files:**
- Create: `src/shared/blob/types.ts`
- Create: `src/shared/blob/index.ts` (empty re-export placeholder)
- Create: `src/shared/blob/README.md` (architecture + attribution placeholder)
- Create: `src/shared/blob/geometry.ts` (empty placeholder, filled in Task 4)
- Create: `.context/grok-study-notes.md` (local notes, not committed)

**Step 1: Clone and study the reference repo**

Run in a temp directory (not committed):
```bash
git clone https://github.com/w210548735-art/grok_bot-icon-study $env:TEMP\grok_bot-icon-study
Get-ChildItem -Recurse $env:TEMP\grok_bot-icon-study\extracted | Select-Object FullName
```
Read `extracted/` state-machine, spring math, eye polygon morph, overlay system — capture interfaces and timing in `.context/grok-study-notes.md`: state enum, event set, transition triggers, spring presets (stiffness/damping/mass), eye vertex count and lerp method, overlay kinds and sequencing. Do not copy business logic verbatim; note the pattern.

**Step 2: Scaffold types**

Create `src/shared/blob/types.ts`:
```ts
export type BlobState = 'idle' | 'listening' | 'thinking' | 'writing' | 'error' | 'celebrate';
export type BlobEvent = 'inputFocus' | 'inputBlur' | 'streamStart' | 'streamEnd' | 'error' | 'success' | 'reset';
export interface SpringPreset { stiffness: number; damping: number; mass: number }
export interface EyeShape { vertices: [number, number][]; lid: number } // normalized 0..1, sourced from grok_bot-icon-study
export type OverlayKind = 'none' | 'sparkle' | 'bang' | 'halo';
export interface BlobStateConfig { eye: EyeShape; overlay: OverlayKind; spring: SpringPreset; durationMs?: number }
export interface BlobFrame { state: BlobState; eye: EyeShape; overlay: OverlayKind; scale: number; rotation: number }
```

Create `src/shared/blob/index.ts`:
```ts
export * from './types';
// engine exports will be added in later tasks
```

Create `src/shared/blob/README.md` stub:
```md
# Blob Engine
Attribution: Geometry and eye UI sourced from https://github.com/w210548735-art/grok_bot-icon-study (extracted/), reused with declaration. Architecture pattern (state machine / spring / eye morph / overlay) inspired by that study; spring/eye/overlay logic authored here.
...
```

**Step 3: Build verification**

Run:
```bash
npm run typecheck
```
Expected: exit 0.

**Step 4: Commit**

```bash
git add src/shared/blob/types.ts src/shared/blob/index.ts src/shared/blob/README.md src/shared/blob/geometry.ts
git commit -m "feat(blob): scaffold blob engine types and attribution"
```

---

### Task 2: State machine pure logic (TDD, failing first)

**Files:**
- Test: `tests/unit/shared/blob/BlobStateMachine.test.ts`
- Impl: `src/shared/blob/BlobStateMachine.ts`

**Step 1: Write the failing test**

Create `tests/unit/shared/blob/BlobStateMachine.test.ts`:
```ts
import { BlobStateMachine } from '../../../src/shared/blob/BlobStateMachine';

describe('BlobStateMachine', () => {
  it('idle -> listening on inputFocus', () => {
    const m = new BlobStateMachine('idle');
    m.dispatch('inputFocus');
    expect(m.state).toBe('listening');
  });
  it('listening -> thinking on streamStart', () => { ... });
  it('thinking <-> writing loop on stream chunks', () => { ... });
  it('any -> error on error, error -> idle on reset', () => { ... });
  it('writing -> celebrate on success then idle after duration (injected clock)', () => { ... });
  it('invalid transition is no-op (e.g. celebrate -> listening)', () => { ... });
  it('covers full 6-state transition table, error has priority', () => { ... });
});
```
The table is deterministic and injected clock is used for timed `celebrate -> idle` (no real timers in logic).

**Step 2: Run to verify failure**

```bash
node scripts/run-jest.js --runInBand tests/unit/shared/blob/BlobStateMachine.test.ts
```
Expected: FAIL (module not found / not implemented).

**Step 3: Implement** `src/shared/blob/BlobStateMachine.ts` — pure class/function, no DOM, no `Date.now()` (time injected by caller for testability). Export transition table as const for documentation.

**Step 4: Run green**

```bash
node scripts/run-jest.js --runInBand tests/unit/shared/blob/BlobStateMachine.test.ts
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/blob/BlobStateMachine.ts tests/unit/shared/blob/BlobStateMachine.test.ts
git commit -m "feat(blob): add state machine with transition table (TDD)"
```

---

### Task 3: Spring physics (TDD)

**Files:**
- Test: `tests/unit/shared/blob/BlobSpring.test.ts`
- Impl: `src/shared/blob/BlobSpring.ts`

**Step 1: Write failing test**

Covers: semi-implicit Euler integration, critical damping behavior, convergence threshold `isSettled()`, stability across 60/120fps `dt`, and that `step()` is pure (no rAF).

**Step 2: Run to verify failure**

```bash
node scripts/run-jest.js --runInBand tests/unit/shared/blob/BlobSpring.test.ts
```
Expected: FAIL.

**Step 3: Implement** `src/shared/blob/BlobSpring.ts`:
```ts
export function createSpring(preset: SpringPreset, initial: number): Spring;
export function step(spring: Spring, dtMs: number, target: number): void;
export function isSettled(spring: Spring, epsilon?: number): boolean;
```
Presets reference `src/style/base/variables.css` transition durations (120/200/240ms) only as tuning hints, not hard-coded geometry.

**Step 4: Verify**

```bash
node scripts/run-jest.js --runInBand tests/unit/shared/blob/BlobSpring.test.ts
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/blob/BlobSpring.ts tests/unit/shared/blob/BlobSpring.test.ts
git commit -m "feat(blob): add spring physics (TDD)"
```

---

### Task 4: Eye morph + overlays + direct geometry reuse (TDD)

**Files:**
- Impl: `src/shared/blob/geometry.ts` (direct copy from grok_bot-icon-study)
- Impl: `src/shared/blob/BlobEyeMorph.ts`
- Impl: `src/shared/blob/BlobOverlays.ts`
- Test: `tests/unit/shared/blob/BlobEyeMorph.test.ts`

**Step 1: Write failing test** `tests/unit/shared/blob/BlobEyeMorph.test.ts` — verifies same-vertex-count lerp, `t=0/0.5/1` snapshots, clamp outside [0,1], and that eye shapes from `geometry.ts` are normalized.

**Step 2: Run to verify failure**

```bash
node scripts/run-jest.js --runInBand tests/unit/shared/blob/BlobEyeMorph.test.ts
```
Expected: FAIL.

**Step 3: Reuse geometry**

Copy `extracted/` eye vertex arrays and blob `path d="..."` strings into `src/shared/blob/geometry.ts` with header comment:
```ts
// Geometry and eye UI sourced from https://github.com/w210548735-art/grok_bot-icon-study
// (extracted/ directory). Reused with attribution per user correction 2026-08-20.
// Licensed under the upstream repo's license; see src/shared/blob/README.md.
export const BLOB_PATH_IDLE = "M ..."; // etc.
// EyeShape per state: idle/listening/thinking/writing/error/celebrate
```
Keep coordinates as-is; do not re-author.

Also update `src/shared/blob/README.md` Attribution section with link, commit hash of the cloned ref, and statement that geometry is reused.

**Step 4: Implement** `BlobEyeMorph.ts: export function lerpEye(a: EyeShape, b: EyeShape, t: number): EyeShape` and `BlobOverlays.ts: export function getOverlay(state: BlobState, progress: number): { kind: OverlayKind; alpha: number }`.

**Step 5: Verify**

```bash
node scripts/run-jest.js --runInBand tests/unit/shared/blob/BlobEyeMorph.test.ts
```
Expected: PASS.

**Step 6: Commit**

```bash
git add src/shared/blob/geometry.ts src/shared/blob/BlobEyeMorph.ts src/shared/blob/BlobOverlays.ts src/shared/blob/README.md tests/unit/shared/blob/BlobEyeMorph.test.ts
git commit -m "feat(blob): add eye morph and overlays reusing upstream geometry (TDD)"
```

---

### Task 5: SVG renderer with token-based theming

**Files:**
- Create: `src/shared/blob/BlobRenderer.ts`
- Create: `src/style/components/blob.css`
- Modify: `src/style/index.css` (add `@import "./components/blob.css";` after the last component import)
- Modify: `src/shared/blob/README.md` (add non-testable note)

**Step 1: Implement renderer**

`src/shared/blob/BlobRenderer.ts`:
```ts
export class BlobRenderer {
  mount(container: HTMLElement): void;
  render(frame: BlobFrame): void;
  unmount(): void;
}
```
SVG structure: outer `<path>` from `geometry.ts` filled with `var(--claudian-plus-surface-primary)` (or `var(--background-primary)`), stroke/eye fill with `var(--claudian-plus-text-normal)`, overlays use `currentColor`. **No `#hex` or `rgb()` literals** — must pass `tests/unit/style/style-tokens.test.ts` (ratchet allows only `base/variables.css` and `base/tokens.css` to contain literals).

`src/style/components/blob.css` only layout/size:
```css
.claudian-plus-blob { width: 120px; height: 120px; }
.claudian-plus-blob--small { width: 20px; height: 20px; }
```

**Step 2: Register style**

Insert in `src/style/index.css`:
```css
@import "./components/blob.css";
```

**Step 3: Build and verify**

```bash
npm run build:css
Select-String -Path styles.css -Pattern 'components/blob.css'
node scripts/run-jest.js --runInBand tests/unit/style/style-tokens.test.ts
```
Expected: build exit 0, `styles.css` contains `blob.css` section, style-tokens PASS.

Add to `README.md` under `## Testing`:
> Rendering (SVG + rAF) depends on DOM/compositor and is not reliably assertable in JSDOM; covered by pure-logic tests (Tasks 2-4) and manual visual acceptance in Task 7.

**Step 4: Commit**

```bash
git add src/shared/blob/BlobRenderer.ts src/style/components/blob.css src/style/index.css styles.css src/shared/blob/README.md
git commit -m "feat(blob): add SVG renderer with token-based theming"
```

---

### Task 6: rAF loop with visibility pause and measurable idle cost

**Files:**
- Modify: `src/shared/blob/BlobRenderer.ts` (add `start/stop/pause` hooks if needed)
- Create: `src/shared/blob/BlobController.ts`
- Test: `tests/unit/shared/blob/BlobController.test.ts`

**Step 1: Write failing test**

`tests/unit/shared/blob/BlobController.test.ts` with fake timers and mock `IntersectionObserver`:
- `document.hidden=true` triggers pause
- `IntersectionObserver` not intersecting triggers pause; intersecting resumes
- `visibilitychange` listener removed on `destroy()`
- multiple `start()/stop()` are idempotent
- `measureIdleCpu(ms)` returns mean frame cost via `performance.now`

**Step 2: Run to verify failure**

```bash
node scripts/run-jest.js --runInBand tests/unit/shared/blob/BlobController.test.ts
```
Expected: FAIL.

**Step 3: Implement** `src/shared/blob/BlobController.ts` wrapping `requestAnimationFrame` loop with double gate: `document.visibilityState` + `IntersectionObserver(container, {threshold: 0})`. Expose `isPaused`, `measureIdleCpu`, and ensure `cancelAnimationFrame` on pause/destroy.

**Step 4: Verify**

```bash
node scripts/run-jest.js --runInBand tests/unit/shared/blob/BlobController.test.ts
npm run build:css && node scripts/run-jest.js --runInBand tests/unit/style/style-tokens.test.ts
```
Expected: both PASS.

**Step 5: Commit**

```bash
git add src/shared/blob/BlobController.ts src/shared/blob/BlobRenderer.ts tests/unit/shared/blob/BlobController.test.ts
git commit -m "feat(blob): add rAF loop with visibility pause and measurable idle cost"
```

---

### Task 7: Engine assembly + internal preview entry (no welcome page)

**Files:**
- Modify: `src/shared/blob/index.ts` (export `createBlobEngine`)
- Create: `src/shared/blob/preview.ts`
- Create: `src/style/components/blob-preview.css` (if needed, token-only)
- Modify: `src/style/index.css` (add preview import if css created)

**Step 1: Assemble engine**

`src/shared/blob/index.ts`:
```ts
export function createBlobEngine(container: HTMLElement, opts?: { size?: 'small'|'large' }): { setEvent(e: BlobEvent): void; setSize(s: 'small'|'large'): void; destroy(): void; measureIdleCpu(ms:number): Promise<number> };
```
Compose `BlobStateMachine` + `BlobSpring` + `BlobEyeMorph` + `BlobRenderer` + `BlobController`. Only exposes `setEvent` / `setSize` / `destroy`.

**Step 2: Internal preview entry**

`src/shared/blob/preview.ts`:
```ts
export function mountBlobPreview(): () => void
```
Mounts a bottom-right floating layer cycling the 6 states every 2s (`idle → listening → thinking → writing → error → celebrate → idle`). Optionally register a hidden Obsidian command `Blob: Preview` (dev only) — **do not touch** `src/features/chat/` welcome page (M3).

**Step 3: Verify**

```bash
npm run build
# Manual: in Obsidian dev vault, console: (await import('src/shared/blob/preview')).mountBlobPreview()
# Expect: 6 states visible, colors follow Minimal / dark / light themes (token-driven)
```

**Step 4: Commit**

```bash
git add src/shared/blob/index.ts src/shared/blob/preview.ts src/style/components/blob-preview.css src/style/index.css styles.css
git commit -m "feat(blob): assemble engine and add internal preview entry"
```

---

### Task 8: Docs, perf, and final verification

**Files:**
- Modify: `src/shared/blob/README.md` (final)
- Modify: `AGENTS.md` or `src/shared/AGENTS.md` if exists (add shared blob ownership note)

**Step 1: Finalize docs**

`src/shared/blob/README.md` must contain:
- Attribution: link to `grok_bot-icon-study`, commit hash of the cloned ref, statement that geometry/eye UI is directly reused
- State transition table (6×7 matrix) with priority (`error` > others)
- Spring presets table and eye shape list
- Token color mapping: `surface-primary → var(--background-primary)`, `text-normal → var(--text-normal)`, etc. (`src/style/base/tokens.css`)
- Testing note (rendering excluded, why)
- Perf: `measureIdleCpu(2000)` idle mean < 1ms/frame (record actual `performance.now` numbers after sidebar hidden vs visible), and that `visibilitychange` + `IntersectionObserver` pauses rAF

**Step 2: Full verification**

```bash
npm run typecheck && npm run lint && npm run build
node scripts/run-jest.js --runInBand tests/unit/shared/blob
node scripts/run-jest.js --runInBand tests/unit/style/style-tokens.test.ts
```
Full suite (7-8 min) separately:
```bash
node scripts/run-jest.js --runInBand
```
Expected: `typecheck/lint/build` exit 0; focused blob tests PASS; `style-tokens` PASS; full suite failures identical to baseline (6 suites / 14 tests, no new).

**Step 3: Manual visual spot-check (human)**

- Light / dark / Minimal community theme: blob colors follow theme
- Sidebar hidden (close / `visibilitychange`) → rAF paused (check `BlobController.isPaused` / `measureIdleCpu` drops)

**Step 4: Commit**

```bash
git add src/shared/blob/README.md
git commit -m "docs(blob): finalize engine docs and perf notes"
```

---

**Per-task discipline:**
- TDD: failing test first, then minimal implementation; `git status` before each commit to ensure only planned files are staged
- Commit messages / code / comments in English; no new production dependencies; no changes to `src/core/`, `src/providers/`
- Keep `src/shared/blob/` as the sole owner of the blob engine; style colors only via tokens (`--claudian-plus-*`), no hard-coded hex/rgb outside `base/variables.css` / `base/tokens.css`
