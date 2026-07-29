/**
 * Claudian Plus owns a clearly namespaced directory.  The legacy paths below
 * are read during migration so existing vaults keep their conversations and
 * settings after upgrading from Claudian/Codian-era builds.
 */
export const CLAUDIAN_PLUS_STORAGE_PATH = '.claudian-plus';
export const CLAUDIAN_PLUS_SETTINGS_PATH = `${CLAUDIAN_PLUS_STORAGE_PATH}/claudian-plus-settings.json`;
export const SESSIONS_PATH = `${CLAUDIAN_PLUS_STORAGE_PATH}/sessions`;

/** Previous Claudian Plus builds stored plugin data under `.claudian`. */
export const LEGACY_CLAUDIAN_STORAGE_PATH = '.claudian';
export const LEGACY_CLAUDIAN_SETTINGS_PATH = `${LEGACY_CLAUDIAN_STORAGE_PATH}/claudian-settings.json`;
export const LEGACY_CLAUDIAN_PLUS_SETTINGS_PATH = `${LEGACY_CLAUDIAN_STORAGE_PATH}/claudian-plus-settings.json`;
export const LEGACY_CLAUDIAN_SESSIONS_PATH = `${LEGACY_CLAUDIAN_STORAGE_PATH}/sessions`;

/** Original Claudian storage paths kept for backwards compatibility. */
export const LEGACY_CLAUDE_SETTINGS_PATH = '.claude/claudian-settings.json';
export const LEGACY_CLAUDE_PLUS_SETTINGS_PATH = '.claude/claudian-plus-settings.json';
export const LEGACY_SESSIONS_PATH = '.claude/sessions';

export const LEGACY_SETTINGS_PATHS = [
  LEGACY_CLAUDIAN_PLUS_SETTINGS_PATH,
  LEGACY_CLAUDIAN_SETTINGS_PATH,
  LEGACY_CLAUDE_PLUS_SETTINGS_PATH,
  LEGACY_CLAUDE_SETTINGS_PATH,
] as const;

export const LEGACY_SESSION_PATHS = [
  LEGACY_CLAUDIAN_SESSIONS_PATH,
  LEGACY_SESSIONS_PATH,
] as const;
