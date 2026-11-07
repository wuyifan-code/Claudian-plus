/* eslint jest/expect-expect: ["warn", { "assertFunctionNames": ["expect", "expectNoIncrease"] }] */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * UX ratchet guard.
 *
 * `tests/fixtures/ux-baseline.json` records the per-file count of the debt this
 * UX program is draining. The baseline is a one-way ceiling: a count may go
 * down (and must be lowered in the same change that migrates a file), but it
 * must never go up. Regenerate it only with `node scripts/ux-baseline.mjs
 * --write` at the start of a release — never to wash a regression away.
 *
 * Measurement mirrors docs/ux/baseline.md §6 and scripts/ux-baseline.mjs.
 */

const ROOT = join(__dirname, '..', '..', '..');
const SOURCE_DIR = join(ROOT, 'src');
const STYLE_DIR = join(SOURCE_DIR, 'style');
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'ux-baseline.json');

const NOTICE = /new Notice\(/g;
const RAW_NOTICE_LITERAL = /new Notice\('/g;
const LOCALE_TEXT = /localeText\(/g;
const CSS_SPACING = /(?:padding|padding-top|padding-right|padding-bottom|padding-left|margin|margin-top|margin-right|margin-bottom|margin-left|gap|row-gap|column-gap):\s*[^;]*[0-9]+px/g;
const CSS_RADIUS = /border-radius:\s*[0-9]+px/g;
const CSS_FONT_SIZE = /font-size:\s*[0-9]+px/g;

interface UxBaseline {
  version: string;
  notices: Record<string, number>;
  rawLiterals: Record<string, number>;
  localeText: Record<string, number>;
  css: {
    spacing: Record<string, number>;
    radius: Record<string, number>;
    fontSize: Record<string, number>;
  };
}

const baseline = JSON.parse(readFileSync(FIXTURE, 'utf8')) as UxBaseline;

/**
 * `FeedbackBus` owns the one sanctioned `Notice` call left in the tree: the
 * fallback used when no panel host is mounted. Every other chat-surface call
 * site must go through the bus, so this is an allowlist rather than a ceiling.
 */
const NOTICE_ALLOWLIST = new Set(['src/shared/feedback/FeedbackBus.ts']);

function toPosix(filePath: string): string {
  return relative(ROOT, filePath).split('\\').join('/');
}

function walk(dir: string, accept: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    if (statSync(entryPath).isDirectory()) {
      out.push(...walk(entryPath, accept));
    } else if (accept(entry)) {
      out.push(entryPath);
    }
  }
  return out;
}

function countMatches(contents: string, pattern: RegExp): number {
  return contents.match(pattern)?.length ?? 0;
}

function currentCounts(files: string[], pattern: RegExp): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of files) {
    const count = countMatches(readFileSync(file, 'utf8'), pattern);
    if (count > 0) {
      counts[toPosix(file)] = count;
    }
  }
  return counts;
}

const tsFiles = walk(SOURCE_DIR, name => name.endsWith('.ts') && !name.endsWith('.d.ts'));
const cssFiles = walk(STYLE_DIR, name => name.endsWith('.css'));

/** Fails with a readable diff when a file exceeds its ceiling or appears new. */
function expectNoIncrease(
  label: string,
  current: Record<string, number>,
  ceiling: Record<string, number>,
): void {
  const offenders: string[] = [];
  for (const [file, count] of Object.entries(current)) {
    const limit = ceiling[file] ?? 0;
    if (count > limit) {
      offenders.push(`${label}: ${file} is ${count}, ceiling ${limit}`);
    }
  }
  expect(offenders).toEqual([]);
}

describe('ux ratchet (counts may only decrease)', () => {
  it('records which release the ceilings came from', () => {
    expect(typeof baseline.version).toBe('string');
  });

  it('no file adds new Notice( calls', () => {
    const counts = currentCounts(tsFiles, NOTICE);
    for (const allowed of NOTICE_ALLOWLIST) delete counts[allowed];
    expectNoIncrease('notices', counts, baseline.notices);
  });

  it('no file adds bare-English new Notice(\' calls', () => {
    expectNoIncrease('rawLiterals', currentCounts(tsFiles, RAW_NOTICE_LITERAL), baseline.rawLiterals);
  });

  it('no file adds localeText( calls', () => {
    expectNoIncrease('localeText', currentCounts(tsFiles, LOCALE_TEXT), baseline.localeText);
  });

  it('no stylesheet adds spacing literals', () => {
    expectNoIncrease('css.spacing', currentCounts(cssFiles, CSS_SPACING), baseline.css.spacing);
  });

  it('no stylesheet adds radius literals', () => {
    expectNoIncrease('css.radius', currentCounts(cssFiles, CSS_RADIUS), baseline.css.radius);
  });

  it('no stylesheet adds font-size literals', () => {
    expectNoIncrease('css.fontSize', currentCounts(cssFiles, CSS_FONT_SIZE), baseline.css.fontSize);
  });
});

describe('3.2.7 chat-surface target', () => {
  // Red until the 140 chat-surface call sites finish migrating. The per-file
  // ratchet above keeps every intermediate commit honest in the meantime.
  it('the chat feature stops using raw Notice entirely', () => {
    const chatNotices = Object.entries(currentCounts(tsFiles, NOTICE))
      .filter(([file]) => file.startsWith('src/features/chat/'))
      .map(([file, count]) => `${file} still has ${count}`);

    expect(chatNotices).toEqual([]);
  });
});
