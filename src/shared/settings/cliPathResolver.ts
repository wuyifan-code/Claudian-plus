import * as fs from 'fs';

import { findCliBinaryPath } from '../../utils/cliBinaryLocator';
import { expandHomePath } from '../../utils/path';

export type CliPathError = 'not-found' | 'not-a-file' | 'not-absolute';

export interface CliPathResolution {
  /** Absolute executable path, or null when the field is empty. */
  path: string | null;
  error: CliPathError | null;
}

function looksLikePath(value: string): boolean {
  return /[\\/]/.test(value) || /^[a-zA-Z]:/.test(value) || value.startsWith('~');
}

/**
 * Resolves what the user typed into a provider's CLI path field.
 *
 * A bare command name (`opencode`) is looked up on the same enhanced PATH the
 * runtime uses, so the field accepts what people actually type instead of
 * demanding an absolute path first. Anything path-like must exist and be a file.
 */
export function resolveCliPathInput(
  raw: string,
  binaryName: string,
  envPath?: string,
): CliPathResolution {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { path: null, error: null };
  }

  if (!looksLikePath(trimmed)) {
    const found = findCliBinaryPath(trimmed || binaryName, envPath);
    return found ? { path: found, error: null } : { path: null, error: 'not-found' };
  }

  let expanded: string;
  try {
    expanded = expandHomePath(trimmed);
  } catch {
    return { path: null, error: 'not-found' };
  }

  try {
    if (!fs.existsSync(expanded)) {
      return { path: null, error: 'not-found' };
    }
    if (!fs.statSync(expanded).isFile()) {
      return { path: null, error: 'not-a-file' };
    }
    return { path: expanded, error: null };
  } catch {
    return { path: null, error: 'not-found' };
  }
}

/** The command name a provider should fall back to when nothing is configured. */
export function detectCliPath(binaryName: string, envPath?: string): string | null {
  return findCliBinaryPath(binaryName, envPath);
}
