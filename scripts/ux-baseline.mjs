#!/usr/bin/env node

/**
 * Generates the UX ratchet baseline consumed by `tests/unit/ux/notice-ratchet.test.ts`.
 *
 * The baseline is a one-way ceiling: counts may only go down. Run this script
 * with `--write` only when *starting* a release, or when lowering a file's
 * number after migrating it. Never use it to "refresh" the file after a
 * regression — that would wash the regression into the baseline.
 *
 *   node scripts/ux-baseline.mjs            # print the baseline to stdout
 *   node scripts/ux-baseline.mjs --write    # write tests/fixtures/ux-baseline.json
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'src');
const styleRoot = path.join(sourceRoot, 'style');
const fixturePath = path.join(root, 'tests', 'fixtures', 'ux-baseline.json');

// Mirrors the measurement commands documented in docs/ux/baseline.md §6.
const NOTICE = /new Notice\(/g;
const RAW_NOTICE_LITERAL = /new Notice\('/g;
const LOCALE_TEXT = /localeText\(/g;
const CSS_SPACING = /(?:padding|padding-top|padding-right|padding-bottom|padding-left|margin|margin-top|margin-right|margin-bottom|margin-left|gap|row-gap|column-gap):\s*[^;]*[0-9]+px/g;
const CSS_RADIUS = /border-radius:\s*[0-9]+px/g;
const CSS_FONT_SIZE = /font-size:\s*[0-9]+px/g;

function toPosix(filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function walk(dir, accept) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(entryPath, accept));
    } else if (accept(entry.name)) {
      out.push(entryPath);
    }
  }
  return out;
}

function countMatches(contents, pattern) {
  const matches = contents.match(pattern);
  return matches ? matches.length : 0;
}

function collectCounts(files, pattern) {
  const counts = {};
  for (const file of files) {
    const contents = readFileSync(file, 'utf8');
    const count = countMatches(contents, pattern);
    if (count > 0) {
      counts[toPosix(file)] = count;
    }
  }
  return counts;
}

function sortByKey(record) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function buildBaseline() {
  const tsFiles = walk(sourceRoot, (name) => name.endsWith('.ts') && !name.endsWith('.d.ts'));

  return {
    version: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version,
    notices: sortByKey(collectCounts(tsFiles, NOTICE)),
    rawLiterals: sortByKey(collectCounts(tsFiles, RAW_NOTICE_LITERAL)),
    localeText: sortByKey(collectCounts(tsFiles, LOCALE_TEXT)),
    css: {
      spacing: sortByKey(collectCounts(walk(styleRoot, (name) => name.endsWith('.css')), CSS_SPACING)),
      radius: sortByKey(collectCounts(walk(styleRoot, (name) => name.endsWith('.css')), CSS_RADIUS)),
      fontSize: sortByKey(collectCounts(walk(styleRoot, (name) => name.endsWith('.css')), CSS_FONT_SIZE)),
    },
  };
}

const baseline = buildBaseline();
const serialized = `${JSON.stringify(baseline, null, 2)}\n`;

if (process.argv.includes('--write')) {
  writeFileSync(fixturePath, serialized, 'utf8');
  process.stdout.write(`Wrote ${path.relative(root, fixturePath)} (version ${baseline.version})\n`);
} else {
  process.stdout.write(serialized);
}
