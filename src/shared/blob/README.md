# Blob Engine

Attribution: Geometry and eye UI sourced from https://github.com/w210548735-art/grok_bot-icon-study (extracted/ directory). Reused with declaration per user correction 2026-08-20. See `geometry.ts` header and license note below.

Architecture pattern (state machine / spring / eye morph / overlay) inspired by that study; logic authored here with token-based theming.

## License note
Upstream geometry is from a third-party application's extracted reference material. Reused here for educational/research purposes with attribution. Do not publish the geometry as your own original asset without verifying applicable rights.

## Overview
- Layers: pure-logic (state machine / spring / eye lerp) → renderer (SVG + rAF) → controller (visibility pause)
- Colors via `src/style/base/tokens.css` (`--claudian-plus-surface-primary`, `--claudian-plus-text-normal`, etc.)
- rAF pauses on `visibilitychange` + `IntersectionObserver`

## Testing
Pure-logic units are covered by `tests/unit/shared/blob/*`. Rendering (SVG + rAF) depends on DOM/compositor and is not reliably assertable in JSDOM; covered by manual visual acceptance in Task 7.
