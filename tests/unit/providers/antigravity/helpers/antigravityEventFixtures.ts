import * as fs from 'node:fs';
import * as path from 'node:path';

const EVENTS_DIR = path.join(__dirname, '..', '..', '..', '..', 'fixtures', 'antigravity', 'events');

export function readAntigravityEventFixture(name: string): Record<string, unknown>[] {
  const raw = fs.readFileSync(path.join(EVENTS_DIR, name), 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Fixture ${name} contains a non-object line: ${line}`);
      }
      return parsed as Record<string, unknown>;
    });
}
