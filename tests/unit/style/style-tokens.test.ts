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
