import * as childProcess from 'node:child_process';

import {
  ANTIGRAVITY_DIAGNOSTICS_SCHEMA_VERSION,
  buildAntigravityDiagnosticsSnapshot,
  formatAntigravityDiagnosticsReport,
  redactAntigravityDiagnostics,
} from '@/providers/antigravity/diagnostics/redactAntigravityDiagnostics';
import { ANTIGRAVITY_PROVIDER_CAPABILITIES } from '@/providers/antigravity/types';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
  spawnSync: jest.fn(),
  exec: jest.fn(),
  execSync: jest.fn(),
  execFile: jest.fn(),
  execFileSync: jest.fn(),
}));

const PRIVATE_WINDOWS_PATH = 'C:\\Users\\ada\\AppData\\Local\\agy\\bin\\agy.EXE';
const PRIVATE_POSIX_PATH = '/home/ada/.local/bin/agy';
const EMAIL = 'ada@example.com';
const TOKEN = 'sk-live-0123456789abcdefghij';
const PROMPT_BODY = [
  'You are a helpful assistant working inside a vault.',
  'Always answer in the language the user wrote in.',
].join('\n');

const spawnSpies = [
  childProcess.spawn,
  childProcess.spawnSync,
  childProcess.exec,
  childProcess.execSync,
  childProcess.execFile,
  childProcess.execFileSync,
] as unknown as jest.Mock[];

const originalFetch = globalThis.fetch;
const fetchSpy = jest.fn();

function expectNoProcessOrModelCall(): void {
  for (const spawnSpy of spawnSpies) {
    expect(spawnSpy).not.toHaveBeenCalled();
  }
  expect(fetchSpy).not.toHaveBeenCalled();
}

describe('redactAntigravityDiagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('keeps only the allowed fields and reduces a private path to its basename', () => {
    const snapshot = redactAntigravityDiagnostics({
      schemaVersion: 99,
      providerId: 'antigravity',
      pluginVersion: '1.2.3',
      cli: { resolved: true, path: PRIVATE_WINDOWS_PATH, executable: PRIVATE_WINDOWS_PATH },
      capabilities: { reasoningControl: 'none', supportsPlanMode: false },
      lastFailure: { category: 'spawn-failed', recordedAt: 1, detail: 'exit code 1' },
      // Nothing below is part of the snapshot vocabulary and none of it may survive.
      prompt: PROMPT_BODY,
      messages: [{ role: 'user', content: PROMPT_BODY }],
      transcript: PROMPT_BODY,
      promptText: PROMPT_BODY,
      cwd: 'D:\\Obsidian\\Creative Vault',
      environment: { HOME: PRIVATE_POSIX_PATH },
    });

    expect(Object.keys(snapshot).sort()).toEqual([
      'capabilities',
      'cli',
      'lastFailure',
      'pluginVersion',
      'providerId',
      'schemaVersion',
    ]);
    expect(snapshot.schemaVersion).toBe(ANTIGRAVITY_DIAGNOSTICS_SCHEMA_VERSION);
    expect(snapshot.providerId).toBe('antigravity');
    expect(snapshot.pluginVersion).toBe('1.2.3');
    expect(snapshot.cli).toEqual({ resolved: true, executable: 'agy.EXE' });
    expect(snapshot.capabilities).toEqual({ reasoningControl: 'none', supportsPlanMode: false });
    expect(snapshot.lastFailure).toEqual({ category: 'spawn-failed', recordedAt: 1, detail: 'exit code 1' });

    const serialized = JSON.stringify(snapshot);
    for (const sensitive of [PROMPT_BODY, 'ada', 'Users', 'Creative Vault', 'role', 'transcript']) {
      expect(serialized).not.toContain(sensitive);
    }
  });

  it('reports an unresolved CLI without inventing an executable', () => {
    expect(redactAntigravityDiagnostics({ cli: { resolved: false, path: PRIVATE_POSIX_PATH } }).cli)
      .toEqual({ resolved: false, executable: null });
    expect(redactAntigravityDiagnostics({}).cli).toEqual({ resolved: false, executable: null });
    expect(redactAntigravityDiagnostics(null).cli).toEqual({ resolved: false, executable: null });
  });

  it('drops a secret or a private path smuggled into a field that is kept', () => {
    const serialized = JSON.stringify(redactAntigravityDiagnostics({
      pluginVersion: `1.2.3 ${TOKEN} ${EMAIL}`,
      resolvedPath: PRIVATE_WINDOWS_PATH,
      capabilities: { note: `see ${PRIVATE_POSIX_PATH}` },
    }));

    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain('ada');
  });

  it('normalizes the last failure through the shared failure vocabulary', () => {
    expect(redactAntigravityDiagnostics({
      lastFailure: { category: 'not-a-category', recordedAt: 1 },
    }).lastFailure).toBeNull();
    expect(redactAntigravityDiagnostics({
      lastFailure: { category: 'timeout', recordedAt: 1, detail: PRIVATE_WINDOWS_PATH },
    }).lastFailure).toEqual({ category: 'timeout', recordedAt: 1, detail: '[redacted-path]' });
  });

  it('keeps capabilities to bounded primitive values only', () => {
    const capabilities = redactAntigravityDiagnostics({
      capabilities: {
        supported: true,
        label: 'none',
        droppedNumber: 3,
        droppedObject: { nested: true },
        droppedArray: ['a'],
      },
    }).capabilities;

    expect(capabilities).toEqual({ supported: true, label: 'none' });
  });
});

describe('buildAntigravityDiagnosticsSnapshot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('builds the snapshot from local state only, spawning nothing and issuing no model request', () => {
    const snapshot = buildAntigravityDiagnosticsSnapshot({
      pluginVersion: '1.2.3',
      resolvedCliPath: PRIVATE_WINDOWS_PATH,
      capabilities: ANTIGRAVITY_PROVIDER_CAPABILITIES,
      lastFailure: { category: 'cli-missing', recordedAt: 7 },
    });

    expect(snapshot.cli).toEqual({ resolved: true, executable: 'agy.EXE' });
    expect(snapshot.capabilities).toMatchObject({
      providerId: 'antigravity',
      supportsPersistentRuntime: false,
      reasoningControl: 'none',
    });
    expect(snapshot.lastFailure).toEqual({ category: 'cli-missing', recordedAt: 7 });
    expectNoProcessOrModelCall();
  });

  it('reports an unresolved CLI and nothing recorded', () => {
    const snapshot = buildAntigravityDiagnosticsSnapshot({
      pluginVersion: '1.2.3',
      resolvedCliPath: null,
      capabilities: {},
      lastFailure: null,
    });

    expect(snapshot.cli).toEqual({ resolved: false, executable: null });
    expect(snapshot.lastFailure).toBeNull();
    expectNoProcessOrModelCall();
  });
});

describe('formatAntigravityDiagnosticsReport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('serializes the redacted snapshot as a copy-safe JSON report', () => {
    const report = formatAntigravityDiagnosticsReport({
      pluginVersion: '1.2.3',
      resolvedCliPath: PRIVATE_POSIX_PATH,
      capabilities: { reasoningControl: 'none' },
      lastFailure: { category: 'timeout', recordedAt: 9, detail: 'exit code 1' },
    });

    expect(JSON.parse(report)).toEqual({
      schemaVersion: ANTIGRAVITY_DIAGNOSTICS_SCHEMA_VERSION,
      providerId: 'antigravity',
      pluginVersion: '1.2.3',
      cli: { resolved: true, executable: 'agy' },
      capabilities: { reasoningControl: 'none' },
      lastFailure: { category: 'timeout', recordedAt: 9, detail: 'exit code 1' },
    });
    expectNoProcessOrModelCall();
  });

  it('never leaks a private path, email, token, or prompt body into the report', () => {
    const report = formatAntigravityDiagnosticsReport({
      pluginVersion: `1.2.3 ${EMAIL}`,
      resolvedCliPath: PRIVATE_WINDOWS_PATH,
      capabilities: {},
      lastFailure: {
        category: 'spawn-failed',
        recordedAt: 9,
        detail: `ENOENT ${PRIVATE_WINDOWS_PATH} ${TOKEN}\n${PROMPT_BODY}`,
      },
    });

    for (const sensitive of ['ada', 'Users', 'example.com', TOKEN, PROMPT_BODY]) {
      expect(report).not.toContain(sensitive);
    }
    expect(JSON.parse(report).cli.executable).toBe('agy.EXE');
    expectNoProcessOrModelCall();
  });
});
