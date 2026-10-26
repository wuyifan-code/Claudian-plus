import { readFileSync } from 'fs';
import { join } from 'path';

const UI_CSS = join(__dirname, '..', '..', '..', 'src', 'style', 'components', 'generative-ui.css');

interface Rule {
  selector: string;
  body: string;
}

interface Declaration {
  property: string;
  value: string;
}

// Animatable properties that cannot trigger a reflow outside the fill bars.
const TRANSITION_WHITELIST = new Set([
  'transform',
  'opacity',
  'background-color',
  'border-color',
  'color',
  'width',
]);

// Layout-affecting properties: changing them on an interaction moves the layout.
const LAYOUT_PROPERTIES = /^(font-weight|font-size|line-height|letter-spacing|padding|padding-[a-z]+|margin|margin-[a-z]+|width|height|min-width|min-height|border|border-width)$/;

// Pseudo-classes that fire without a state-class change.
const INTERACTIVE_PSEUDO = /:(hover|focus|focus-visible|focus-within|active)\b/;

// Toggle state classes: selecting one must not restyle metrics either.
const TOGGLE_STATE = /\.is-(active|selected|open|current|pressed|checked)\b/;

// A bare <number>ms / <number>s literal, as opposed to a var() reference.
const BARE_DURATION = /(?:^|[^\w.-])\d*\.?\d+m?s(?![\w-])/;

const MOTION_SHORTHANDS = new Set(['transition', 'transition-duration', 'animation', 'animation-duration']);

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    rules.push({ selector: match[1].trim(), body: match[2] });
  }
  return rules;
}

function parseDeclarations(body: string): Declaration[] {
  const out: Declaration[] = [];
  for (const chunk of body.split(';')) {
    const colon = chunk.indexOf(':');
    if (colon === -1) continue;
    out.push({
      property: chunk.slice(0, colon).trim().toLowerCase(),
      value: chunk.slice(colon + 1).trim(),
    });
  }
  return out;
}

// Split on commas that are not nested inside parentheses (cubic-bezier, var()).
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function selectorsOf(selector: string): string[] {
  return selector
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

// Leaf rules inside every `@media (prefers-reduced-motion: reduce)` block.
function reducedMotionSelectors(css: string): Set<string> {
  const out = new Set<string>();
  const marker = '@media (prefers-reduced-motion: reduce)';
  let index = css.indexOf(marker);
  while (index !== -1) {
    const blockStart = css.indexOf('{', index);
    if (blockStart === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = blockStart; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    for (const rule of parseRules(css.slice(blockStart + 1, end))) {
      for (const selector of selectorsOf(rule.selector)) out.add(selector);
    }
    index = css.indexOf(marker, end);
  }
  return out;
}


const raw = readFileSync(UI_CSS, 'utf-8');
const css = stripComments(raw);
const rules = parseRules(css);

describe('generative UI motion tokens', () => {
  it('keeps every transition/animation duration in a token', () => {
    const offenders: string[] = [];
    for (const rule of rules) {
      for (const declaration of parseDeclarations(rule.body)) {
        if (!MOTION_SHORTHANDS.has(declaration.property)) continue;
        if (declaration.value.toLowerCase() === 'none') continue;
        if (BARE_DURATION.test(declaration.value)) {
          offenders.push(rule.selector + ' -> ' + declaration.property + ': ' + declaration.value);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('transitions only whitelisted properties and never `all`', () => {
    const offenders: string[] = [];
    for (const rule of rules) {
      for (const declaration of parseDeclarations(rule.body)) {
        if (declaration.property !== 'transition' && declaration.property !== 'transition-property') continue;
        const value = declaration.value.toLowerCase();
        if (value === 'none') continue;
        for (const part of splitTopLevel(declaration.value)) {
          const property = part.split(/\s+/)[0].toLowerCase();
          if (property === 'all' || !TRANSITION_WHITELIST.has(property)) {
            offenders.push(rule.selector + ' -> transitions ' + property);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives every motion a prefers-reduced-motion opt-out', () => {
    const optedOut = reducedMotionSelectors(css);
    const offenders: string[] = [];
    for (const rule of rules) {
      const declarations = parseDeclarations(rule.body);
      const hasMotion = declarations.some((declaration) =>
        MOTION_SHORTHANDS.has(declaration.property)
        && declaration.value.toLowerCase() !== 'none');
      if (!hasMotion) continue;
      for (const selector of selectorsOf(rule.selector)) {
        if (!optedOut.has(selector)) offenders.push(selector);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('contains overscroll in every in-block scroller', () => {
    const scrollable = /overflow(-x|-y)?\s*:\s*(auto|scroll)\b/;
    const offenders: string[] = [];
    let matched = 0;
    for (const rule of rules) {
      if (!scrollable.test(rule.body)) continue;
      matched += 1;
      if (!/overscroll-behavior(-x|-y)?\s*:/.test(rule.body)) offenders.push(rule.selector);
    }
    expect(matched).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it('keeps interaction and toggle states colour-only so they cannot shift layout', () => {
    const offenders: string[] = [];
    for (const rule of rules) {
      const isInteractive = INTERACTIVE_PSEUDO.test(rule.selector);
      const isToggleState = TOGGLE_STATE.test(rule.selector);
      if (!isInteractive && !isToggleState) continue;
      const kind = isToggleState ? 'state class' : 'pseudo-class';
      for (const declaration of parseDeclarations(rule.body)) {
        if (LAYOUT_PROPERTIES.test(declaration.property)) {
          offenders.push(rule.selector + ' (' + kind + ') -> ' + declaration.property);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('zeroes the min-width of row/col/grid children so narrow panels do not overflow', () => {
    const rule = rules.find((entry) => entry.selector.includes('.claudian-plus-ui-row > *'));
    expect(rule).toBeDefined();
    const selector = rule!.selector;
    expect(selector).toContain('.claudian-plus-ui-col > *');
    expect(selector).toContain('.claudian-plus-ui-grid > *');
    expect(rule!.body).toMatch(/min-width\s*:\s*0/);
  });
});
