import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const vendorDir = join(process.cwd(), 'src', 'utils', 'textLayout', 'vendor');

function vendorSources() {
  return readdirSync(vendorDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, source: readFileSync(join(vendorDir, name), 'utf8') }));
}

test('vendored layout code does not sniff the browser with navigator', () => {
  for (const { name, source } of vendorSources()) {
    assert.doesNotMatch(
      source,
      /\bnavigator\s*\.\s*(?:userAgent|vendor)\b/,
      `${name} must use Obsidian's Platform API instead of navigator`,
    );
  }
});

test('vendored layout code does not assign inline styles directly', () => {
  for (const { name, source } of vendorSources()) {
    assert.doesNotMatch(
      source,
      /\.style\.[A-Za-z]+\s*=(?!=)/,
      `${name} must use setCssProps or setCssStyles instead of style property assignment`,
    );
  }
});

test('every lint directive in the vendored layout code carries a description', () => {
  for (const { name, source } of vendorSources()) {
    for (const line of source.split('\n')) {
      if (!line.includes('eslint-disable-next-line')) continue;
      assert.match(
        line,
        /eslint-disable-next-line\s+\S+(?:\s+\S+)*\s+--\s+\S/,
        `${name} has an eslint-disable directive without a "-- description"`,
      );
    }
  }
});
