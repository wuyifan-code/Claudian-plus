import {
  deriveProjectIdFromGitConfig,
  deriveProjectIdFromVaultName,
} from '@/core/memory/projectScope';

describe('projectScope', () => {
  it('extracts the repository slug from a git remote URL', () => {
    const config = [
      '[core]',
      '\trepositoryformatversion = 0',
      '[remote "origin"]',
      '\turl = git@github.com:acme/claudian-enhanced.git',
      '\tfetch = +refs/heads/*:refs/remotes/origin/*',
    ].join('\n');

    expect(deriveProjectIdFromGitConfig(config)).toBe('claudian-enhanced');
  });

  it('handles https remotes and missing .git suffixes', () => {
    expect(deriveProjectIdFromGitConfig('[remote "origin"]\n\turl = https://github.com/acme/repo')).toBe('repo');
    expect(deriveProjectIdFromGitConfig('[remote "origin"]\n\turl = https://github.com/acme/repo.git')).toBe('repo');
  });

  it('returns null without an origin remote', () => {
    expect(deriveProjectIdFromGitConfig('[core]\n\tbare = false')).toBeNull();
    expect(deriveProjectIdFromGitConfig('')).toBeNull();
  });

  it('derives a stable slug from the vault folder name', () => {
    expect(deriveProjectIdFromVaultName('Creative Vault')).toBe('creative-vault');
    expect(deriveProjectIdFromVaultName('   ')).toBe('default');
  });
});
