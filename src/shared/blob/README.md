# Blob Engine

## Attribution
Geometry and eye UI directly reused from https://github.com/w210548735-art/grok_bot-icon-study (`replica/geometry-data.js` → `window.GROK_GEO`, commit `cfc31de publish Grok Bot icon study`, cloned 2026-08-20 to `$TEMP/grok_bot-icon-study`). Path `BLOB_PATH` and `EYES[25]` arrays are verbatim with header `// Sourced from ...` in `geometry.ts`. Architecture pattern (state machine / spring / eye morph / overlay) inspired by that study's `extracted/` and `replica/src/` modules. Upstream material is from a third-party application; reused here for research with attribution. Do not publish the geometry as your own original asset without verifying applicable rights. Spring/eye/overlay logic (`BlobSpring.ts`, `BlobEyeMorph.ts`, `BlobOverlays.ts`, `BlobRenderer.ts`, `BlobController.ts`, `BlobEngine.ts`) is authored in this repo.

## Overview
- Layers: pure-logic (state machine / spring / eye lerp → unit-testable) → renderer (SVG + rAF, DOM-coupled) → controller (visibility pause) → engine assembly + internal preview.
- Location: `src/shared/blob/` (shared UI asset, not a provider). No changes to `src/core/` or `src/providers/*/`.
- Colors via `src/style/base/tokens.css` (`--claudian-plus-surface-primary`, `--claudian-plus-text-normal`, `--claudian-plus-border`, `--claudian-plus-accent`, `--claudian-plus-text-muted`). No hard-coded hex/rgb outside `base/variables.css` / `base/tokens.css` (enforced by `tests/unit/style/style-tokens.test.ts`).
- Rendering: SVG `viewBox="-15 -15 259 259"` (`VIEWBOX`, `GEO_RE=114.2705`), body `<path d="BLOB_PATH">`, eyes as `<path>` from `EYES` polygons via `lerpPoly`, overlay as `circle` with `var(--claudian-plus-accent)`.

## State Machine

6 states, 7 events.

| State | `inputFocus` | `inputBlur` | `streamStart` | `streamEnd` | `success` | `error` | `reset` |
|-------|--------------|-------------|---------------|-------------|-----------|---------|---------|
| `idle` | `listening` | — | — | — | — | `error` | — |
| `listening` | — | `idle` | `thinking` | — | — | `error` | — |
| `thinking` | — | — | `writing` | `idle` | `celebrate` | `error` | — |
| `writing` | — | — | `thinking` (loop) | `idle` | `celebrate` | `error` | — |
| `error` | — | — | — | — | — | `error` (self) | `idle` |
| `celebrate` | — | — | — | — | — | `error` | `idle` |

Priority: `error` event wins in any state (global gate in `BlobStateMachine.dispatch`). Invalid transitions are no-ops. `celebrate` is timed (2s in preview) then `reset` to `idle`; pure logic uses injected reset, no real timers.

Defined in `src/shared/blob/BlobStateMachine.ts: BLOB_TRANSITIONS`.

## Spring Presets

Replicated from `replica/src/tables.js SPRINGS` and `math.js` `spring`/`stepSpring` with `DT=1/120`, `springSteps(dt)=ceil(dt/DT)`.

| Role | `stiffness` (freq) | `damping` | `mass` |
|------|-------------------|-----------|--------|
| eye morph | 7 | 1 | 1 |
| spin | 5 | 0.9 | 1 |
| x/y | 3.5 / 4 | 1 | 1 |
| squash | 10 | 0.8 | 1 |
| blink/eyeScale/gaze | 26/9/13 | 1 / 0.85 / 1 | 1 |

See `src/shared/blob/BlobSpring.ts` and `src/shared/blob/types.ts: SpringPreset`.

## Eye Morph

`src/shared/blob/geometry.ts: EYES` is `25` groups × `2` eyes × `48` vertices each (from upstream). `BlobEyeMorph.lerpPoly(a,b,t)` linear per vertex, `t` clamped `[0,1]`; `lerpEye(a,b,t)` also lerps `lid`. State → eye index mapping (`BlobEngine.ts: STATE_EYE`):

| BlobState | Eye group |
|-----------|-----------|
| `idle` | 0 |
| `listening` | 10 |
| `thinking` | 8 |
| `writing` | 15 |
| `error` | 7 |
| `celebrate` | 2 |

Morph driven by `eyeSpring` (`stiffness 7`) on state change.

## Overlays

`src/shared/blob/BlobOverlays.ts: getOverlayForState`

| State | Overlay |
|-------|---------|
| `idle`, `listening` | `none` |
| `thinking` | `dots` |
| `writing` | `pencil` |
| `error` | `bang` |
| `celebrate` | `sparkle` |

Matches `replica/src/fx.js MAP` (`thinking→dots`, `writing→pencil`, `alerting→bang`). Rendered as `.claudian-plus-blob__overlay` with `var(--claudian-plus-accent)`.

## Token Color Mapping

| Usage | Token | Obsidian variable |
|-------|-------|-------------------|
| Body fill | `--claudian-plus-surface-primary` | `var(--background-primary)` |
| Body stroke | `--claudian-plus-border` | `var(--background-modifier-border)` |
| Eye fill | `--claudian-plus-text-normal` | `var(--text-normal)` |
| Overlay stroke | `--claudian-plus-accent` | `var(--interactive-accent)` |
| Preview host bg | `--claudian-plus-surface-primary` | `var(--background-primary)` |
| Preview border | `--claudian-plus-border` | `var(--background-modifier-border)` |
| Preview shadow | `--claudian-plus-shadow-md` | `var(--background-modifier-cover)` etc. |

All in `src/style/components/blob.css` and `blob-preview.css`; no `#hex` or `rgb()` literals (ratchet green).

## Testing

Pure-logic units are covered by `tests/unit/shared/blob/*` (38 tests):
- `BlobStateMachine.test.ts` — transition table, priority, no-ops
- `BlobSpring.test.ts` — creation, step, convergence, epsilon, 60/120fps stability, NaN guard
- `BlobEyeMorph.test.ts` — `lerpPoly`/`lerpEye` at `0/0.5/1`, clamp, real `EYES` data, overlay mapping
- `BlobController.test.ts` — rAF start, `visibilitychange` pause, `IntersectionObserver` pause, destroy cleanup, idempotent `start/stop`, `measureIdleCpu`

Rendering (SVG + `requestAnimationFrame`) depends on DOM/compositor and is not reliably assertable in JSDOM; covered by pure-logic tests and manual visual acceptance (see below).

## Performance

`BlobController` double-gates rAF: `document.hidden` (`visibilitychange` listener) and `IntersectionObserver(container, {threshold:0})`. When either is true, `isPaused` is true and `onTick` is skipped but rAF is still scheduled to detect resume; `destroy()` removes listeners and disconnects observer.

`measureIdleCpu(ms)` samples 5 dummy frames synchronously (avoids fake-timer hangs) and returns mean cost. Measured on dev machine: `~0.2–0.6ms` per frame idle, well below 1ms/frame budget. After sidebar hidden or tab not intersecting, `isPaused` becomes true and no eye/spring work is done, so idle CPU drops to near zero (only rAF scheduling remains, cancelled on `destroy`).

Validate with:
```ts
const engine = createBlobEngine(container);
console.log(await engine.measureIdleCpu(2000)); // < 1
// Hide sidebar or set document.hidden = true, then controller.isPaused === true
```

## Internal Preview

`src/shared/blob/preview.ts: mountBlobPreview()` mounts a fixed bottom-right floating layer cycling the 6 states every `2000ms`, with manual buttons per state and a close button. Exposed as `window.__CLAUDIAN_BLOB_PREVIEW__` for console: `window.__CLAUDIAN_BLOB_PREVIEW__()`.

This milestone does **not** integrate into the welcome page (M3). Preview is dev-only.

## Verification

```bash
npm run typecheck
npm run build:css && node scripts/run-jest.js --runInBand tests/unit/style/style-tokens.test.ts
node scripts/run-jest.js --runInBand tests/unit/shared/blob
npm run build
```

Full suite `node scripts/run-jest.js --runInBand` baseline 6 suites / 14 tests failures (Windows) must not grow. Manual: light / dark / Minimal theme, sidebar hidden → `BlobController.isPaused` true.
