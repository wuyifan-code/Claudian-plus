/**
 * Guards the button host-reset contract.
 *
 * Obsidian ships a bare `button` rule (centred flex) and
 * `button:not(.clickable-icon)` (background + input shadow), both at (0,1,1).
 * A component class alone is (0,1,0), so those host declarations win silently
 * and repaint or re-centre the component. Every GenUI button class therefore
 * has to own a rule that is element-qualified and states its own
 * `justify-content`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const CSS_PATH = join(ROOT, 'src', 'style', 'components', 'generative-ui.css');
const RENDER_DIR = join(ROOT, 'src', 'features', 'chat', 'rendering');

const BUTTON_FACTORY = /createButton\(\s*[`'"]([a-z0-9-]+)/g;
const BUTTON_ELEMENT = /createEl\(\s*'button'\s*,\s*\{\s*cls:\s*[`'"]([a-z0-9-]+)/g;
// Form controls: Obsidian styles `input[type='text']`, `textarea`, `select` at
// (0,1,1), so a bare component class loses the same fight buttons did.
const FIELD_ELEMENT = /createEl\(\s*'(input|textarea|select)'\s*,\s*\{\s*cls:\s*[`'"]([a-z0-9-]+)/g;

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return collectTsFiles(full);
    return entry.endsWith('.ts') ? [full] : [];
  });
}

function collectButtonClasses(): string[] {
  const names = new Set<string>();
  for (const file of collectTsFiles(RENDER_DIR)) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of [BUTTON_FACTORY, BUTTON_ELEMENT]) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        // Only generated-UI buttons belong to this contract; the rendering
        // directory also holds plugin chrome with its own button styles.
        if (match[1].startsWith('claudian-plus-ui-')) names.add(match[1]);
      }
    }
  }
  return [...names].sort();
}

/** Body of the first rule whose selector is exactly `selector`. */
function collectFieldComponents(): Array<{ tag: string; cls: string }> {
  const found: Array<{ tag: string; cls: string }> = [];
  const seen = new Set<string>();
  for (const file of collectTsFiles(RENDER_DIR)) {
    const source = readFileSync(file, 'utf8');
    FIELD_ELEMENT.lastIndex = 0;
    for (const match of source.matchAll(FIELD_ELEMENT)) {
      const cls = match[2].split(' ')[0];
      if (!cls.startsWith('claudian-plus-ui-')) continue;
      const key = match[1] + '.' + cls;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ tag: match[1], cls });
    }
  }
  return found;
}

function ruleBody(css: string, selector: string): string | null {
  const start = css.search(new RegExp('(^|\\n)' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{'));
  if (start < 0) return null;
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return close < 0 ? null : css.slice(open + 1, close);
}

describe('generative UI button host reset', () => {
  const css = readFileSync(CSS_PATH, 'utf8');
  const buttonClasses = collectButtonClasses();

  it('finds the button-based components', () => {
    expect(buttonClasses.length).toBeGreaterThan(10);
    expect(buttonClasses).toContain('claudian-plus-ui-step');
    expect(buttonClasses).toContain('claudian-plus-ui-checklist-item');
  });

  it('keeps the shadow reset scoped to GenUI buttons', () => {
    const body = ruleBody(css, "button[class*='claudian-plus-ui-']");
    expect(body).not.toBeNull();
    expect(body).toContain('box-shadow: none');
  });

  it('element-qualifies every button rule so the host cannot outrank it', () => {
    const missing = buttonClasses.filter((name) => ruleBody(css, 'button.' + name) === null);
    expect(missing).toEqual([]);
  });


  it('element-qualifies every form-control rule', () => {
    const fields = collectFieldComponents();
    expect(fields.length).toBeGreaterThan(5);
    const missing = fields
      .filter((field) => ruleBody(css, field.tag + '.' + field.cls) === null)
      .map((field) => field.tag + '.' + field.cls);
    expect(missing).toEqual([]);
  });
  it('never leaves its layout direction to the host', () => {
    // Either the rule states where its content starts, or it opts out of the
    // host's inline-flex entirely.
    const missing = buttonClasses.filter((name) => {
      const body = ruleBody(css, 'button.' + name);
      if (body === null) return true;
      return !body.includes('justify-content:') && !body.includes('display: block');
    });
    expect(missing).toEqual([]);
  });
});
