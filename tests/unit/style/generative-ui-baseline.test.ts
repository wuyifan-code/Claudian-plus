/**
 * Guards the generative-UI design baseline.
 *
 * The widget set reads as one family only if every axis comes from a single
 * ladder: radii from the project scale (not Obsidian's, not literals), type from
 * the fixed GenUI steps (not the em-relative `--h1/h2/h3` sizes), and a
 * container-role rule so a panel never frames another panel.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const CSS = readFileSync(join(ROOT, 'src', 'style', 'components', 'generative-ui.css'), 'utf8');
const VARS = readFileSync(join(ROOT, 'src', 'style', 'base', 'variables.css'), 'utf8');

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('generative UI design baseline', () => {
  const css = stripComments(CSS);

  it('defines the GenUI ladders as tokens', () => {
    for (const token of [
      '--claudian-plus-ui-space-2xs',
      '--claudian-plus-ui-space-xs',
      '--claudian-plus-ui-space-sm',
      '--claudian-plus-ui-space-md',
      '--claudian-plus-ui-space-lg',
      '--claudian-plus-ui-control-h',
      '--claudian-plus-ui-font-caption',
      '--claudian-plus-ui-font-body',
      '--claudian-plus-ui-font-body-lg',
      '--claudian-plus-ui-font-heading',
      '--claudian-plus-ui-font-display',
    ]) {
      expect(VARS).toContain(token + ':');
    }
  });

  it('takes every radius from the project scale', () => {
    const values = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((match) => match[1].trim());
    const offenders = values.filter((value) =>
      !value.startsWith('var(--claudian-plus-radius-')
      && value !== '50%'
      && value !== 'inherit'
      // A zero radius is a reset (code inside a code block), not a design value.
      && value !== '0');
    expect({ offenders, values: [...new Set(values)] }).toEqual({ offenders: [], values: [...new Set(values)] });
  });

  it('never reaches for the host radius tokens', () => {
    expect(css).not.toMatch(/border-radius:\s*var\(--radius-[sml]\)/);
  });

  it('never reaches for the em-relative heading sizes', () => {
    expect(css).not.toMatch(/--h1-size|--h2-size|--h3-size/);
  });

  it('renders at most three title steps so md and lg stay distinguishable', () => {
    const sizes = [...css.matchAll(/\.claudian-plus-ui-title\[data-size='([^']+)'\][^{]*\{[^}]*font-size:\s*([^;]+);/g)]
      .map((match) => match[2].trim());
    expect(sizes.length).toBeGreaterThanOrEqual(4);
    expect(new Set(sizes).size).toBeLessThanOrEqual(3);
    expect(sizes).toContain('var(--claudian-plus-ui-font-display)');
  });

  it('degrades a panel that sits inside another panel', () => {
    expect(css).toMatch(/:is\(\.claudian-plus-ui-card[^)]*\)\s*:is\(\.claudian-plus-ui-card/);
  });

  it('takes every padding, gap and margin from the spacing scale', () => {
    const declarations = [...css.matchAll(
      /^\s*(?:padding|margin|gap|row-gap|column-gap)[^:]*:\s*([^;]+);/gm,
    )].map((match) => match[1].trim());
    const offenders = [...new Set(declarations.flatMap((value) => value.split(/\s+/).filter((token) =>
      token !== '0' && !token.startsWith('var(--claudian-plus-ui-space-'))))];
    expect(offenders).toEqual([]);
  });

  it('keeps the reading style in one module scoped to both surfaces', () => {
    const index = readFileSync(join(ROOT, 'src', 'style', 'index.css'), 'utf8');
    const reading = readFileSync(join(ROOT, 'src', 'style', 'components', 'markdown-reading.css'), 'utf8');
    // Loaded after the widget sheet so the reading layer wins the panel.
    expect(index.indexOf('markdown-reading.css')).toBeGreaterThan(index.indexOf('generative-ui.css'));

    const selectors = [...reading.matchAll(/^([^@{}\s/][^{}]*)\{/gm)].map((match) => match[1].trim());
    expect(selectors.length).toBeGreaterThan(8);
    const scope = ":is(.claudian-plus-ui-markdown, .claudian-plus-message-content)";
    const offenders = selectors.filter((selector) => !selector.startsWith(scope));
    expect(offenders).toEqual([]);

    // Widget roots carry a claudian-plus-ui- class; markdown elements do not,
    // so the exclusion keeps a Table widget out of the markdown table rules.
    expect(reading.split(":not([class*='claudian-plus-ui'])").length - 1).toBeGreaterThan(8);
  });
  it('styles every markdown surface the widgets rely on', () => {
    // MarkdownRenderer does not add Obsidian's .markdown-rendered wrapper, so
    // these elements get no reading-view polish unless the shared reading
    // layer provides it.
    const reading = readFileSync(join(ROOT, 'src', 'style', 'components', 'markdown-reading.css'), 'utf8');
    for (const selector of ['code', 'pre', 'table', 'blockquote', 'hr']) {
      expect(reading).toContain(' ' + selector + ":not([class*='claudian-plus-ui'])");
    }
  });

  it('covers the 361-479px sidebar tier', () => {
    expect(css).toContain('@container claudian-ui (min-width: 361px) and (max-width: 479px)');
  });
});
