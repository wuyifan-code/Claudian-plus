/**
 * Project scope derivation.
 *
 * Memories can be scoped to a project so that project-specific facts do not
 * leak across projects sharing a vault. Within an Obsidian vault the natural
 * project identity is the git remote at the vault root (when present), with
 * the vault folder name as the fallback.
 */

/** Extractes the project slug from a `.git/config` file body. */
export function deriveProjectIdFromGitConfig(configBody: string): string | null {
  const remoteMatch = configBody.match(/\[remote "origin"\][^[]*url\s*=\s*(\S+)/);
  const url = remoteMatch?.[1];
  if (!url) return null;
  const clean = url.replace(/\.git$/, '');
  const lastSegment = clean.split(/[\\/]/).filter(Boolean).pop();
  return lastSegment ? lastSegment.slice(0, 64) : null;
}

/** Fallback project id from the vault root folder name. */
export function deriveProjectIdFromVaultName(vaultName: string): string {
  const slug = vaultName.trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5-]+/g, '-');
  return (slug || 'default').slice(0, 64);
}
