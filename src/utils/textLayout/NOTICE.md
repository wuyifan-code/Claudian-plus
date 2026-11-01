# Vendored text layout engine

`vendor/` is a copy of the Pretext text-layout engine, taken from the
`obsidian-pretext` plugin (author: wuyifan-code, MIT) at
`.obsidian/plugins/obsidian-pretext/lib/pretext/`.

- Original files: `analysis.js`, `measurement.js`, `bidi.js`, `line-break.js`,
  `layout.js` (`lib/pretext/bundle.js` is the IIFE build of the same modules and
  is not vendored, so the bundler can tree-shake).
- `bidi.js` is itself forked from pdf.js via Sebastian's text-layout; it is only
  reached by the `prepareWithSegments` path this plugin does not use.

Local changes, applied when copying:

1. File extension `.js` → `.ts`.
2. ESM specifiers rewritten from `'./x.js'` to `'./x'`.
3. `// @ts-nocheck` header; the code is vendored as-is and is not re-typed.
   `eslint.config.mjs` ignores `src/utils/textLayout/vendor/**`.
4. One header comment naming this notice.

Do not edit vendored files. Adapt instead in `../vendorBridge.ts`, which is the
only module that calls into them and the only place that must change if the
upstream engine API moves.
