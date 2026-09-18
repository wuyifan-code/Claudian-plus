import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';

function listTypeScriptFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listTypeScriptFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(entryPath);
  }
  return files;
}

function findMatches(roots, pattern) {
  const matches = [];
  for (const root of roots) {
    for (const file of listTypeScriptFiles(root)) {
      if (pattern.test(fs.readFileSync(file, 'utf8'))) {
        matches.push(path.relative(process.cwd(), file).split(path.sep).join('/'));
      }
    }
  }
  return matches;
}

const sourceRoot = path.join(process.cwd(), 'src');

test('core is independent from main, features, and concrete providers', () => {
  const pattern = /from\s+['"][^'"]*(?:main['"]|features\/|providers\/(?:claude|codex|opencode|pi))/;
  assert.deepEqual(findMatches([path.join(sourceRoot, 'core')], pattern), []);
});

test('providers are independent from main and features', () => {
  const pattern = /from\s+['"][^'"]*(?:main['"]|features\/)/;
  assert.deepEqual(findMatches([path.join(sourceRoot, 'providers')], pattern), []);
});

test('features are independent from the composition root and app adapters', () => {
  const pattern = /from\s+['"][^'"]*(?:main['"]|app\/)/;
  assert.deepEqual(findMatches([path.join(sourceRoot, 'features')], pattern), []);
});

test('features and shared UI are independent from concrete providers', () => {
  const pattern = /from\s+['"][^'"]*providers\/(?:claude|codex|opencode|pi)/;
  assert.deepEqual(findMatches([
    path.join(sourceRoot, 'features'),
    path.join(sourceRoot, 'shared'),
  ], pattern), []);
});

test('persisted settings changes use the coordinator boundary', () => {
  const matches = findMatches([sourceRoot], /\.saveSettings\(\)/).filter(file => ![
    'src/main.ts',
    'src/app/providers/ClaudianPlusProviderHost.ts',
  ].includes(file));
  assert.deepEqual(matches, []);
});

test('no source module statically imports an externalized package at load time', () => {
  // The build externalizes @modelcontextprotocol/sdk (bundling it costs ~835 KB and
  // would blow the bundle ceiling, and the installed plugin folder ships only
  // main.js/manifest.json/styles.css so it cannot be vendored either). A static
  // import therefore becomes a top-level require() in main.js that cannot resolve
  // inside Obsidian, and the whole plugin refuses to load — exactly the failure
  // observed on 2026-09-18. Value imports must be dynamic (await import); type-only
  // imports erase at compile time and stay allowed.
  const pattern = /import\s+(?!type\s)[^;]*from\s+['"]@modelcontextprotocol\/sdk\//;
  assert.deepEqual(findMatches([sourceRoot], pattern), []);
});
