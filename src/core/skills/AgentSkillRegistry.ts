import { createHash } from 'node:crypto';
import * as path from 'node:path';

import type { HomeFileAdapter } from '../storage/HomeFileAdapter';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import { parseAgentSkillMarkdown } from './AgentSkillCodec';

const SKILL_FILENAME = 'SKILL.md';

export type AgentSkillSourceKind =
  | 'vault-opencode'
  | 'vault-claude'
  | 'vault-codex'
  | 'vault-agents'
  | 'home-opencode'
  | 'home-claude'
  | 'home-codex'
  | 'home-agents';

export interface AgentSkillSource {
  kind: AgentSkillSourceKind;
  rootPath: string;
  scope: 'vault' | 'home';
  /** Vault roots require folder === name; home roots accept versioned folders. */
  strictDirectoryName: boolean;
}

export const AGENT_SKILL_SOURCES: readonly AgentSkillSource[] = [
  { kind: 'vault-opencode', rootPath: '.opencode/skills', scope: 'vault', strictDirectoryName: true },
  { kind: 'vault-claude', rootPath: '.claude/skills', scope: 'vault', strictDirectoryName: true },
  { kind: 'vault-codex', rootPath: '.codex/skills', scope: 'vault', strictDirectoryName: true },
  { kind: 'vault-agents', rootPath: '.agents/skills', scope: 'vault', strictDirectoryName: true },
  { kind: 'home-opencode', rootPath: '.config/opencode/skills', scope: 'home', strictDirectoryName: false },
  { kind: 'home-claude', rootPath: '.claude/skills', scope: 'home', strictDirectoryName: false },
  { kind: 'home-codex', rootPath: '.codex/skills', scope: 'home', strictDirectoryName: false },
  { kind: 'home-agents', rootPath: '.agents/skills', scope: 'home', strictDirectoryName: false },
];

export interface AgentSkillSummary {
  name: string;
  description: string;
  source: AgentSkillSource;
  scope: 'vault' | 'home';
  directoryPath: string;
  filePath: string;
  revision: string;
}

export interface AgentSkillDocument extends AgentSkillSummary {
  instructions: string;
  frontmatter: Record<string, unknown>;
}

export interface AgentSkillDiagnostic {
  source: AgentSkillSource;
  directoryPath: string;
  message: string;
}

export interface AgentSkillSnapshot {
  revision: string;
  generatedAt: number;
  skills: AgentSkillSummary[];
  diagnostics: AgentSkillDiagnostic[];
}

export interface AgentSkillRepositoryLike {
  exists(path: string): Promise<boolean>;
  listFolders(folder: string): Promise<string[]>;
  read(path: string): Promise<string>;
}

interface RegistryCache {
  revision: string;
  snapshot: AgentSkillSnapshot;
}

const EMPTY_SNAPSHOT: AgentSkillSnapshot = {
  revision: 'empty',
  generatedAt: 0,
  skills: [],
  diagnostics: [],
};

function buildRevision(summaries: AgentSkillSummary[], diagnostics: AgentSkillDiagnostic[]): string {
  const hash = createHash('sha256');
  hash.update('v1');
  for (const summary of summaries) {
    hash.update(
      `|${summary.name}|${summary.source.kind}|${summary.source.rootPath}|${summary.directoryPath}|${summary.revision}`,
    );
  }
  hash.update(`|d${diagnostics.length}`);
  for (const diagnostic of diagnostics) {
    hash.update(`|${diagnostic.source.kind}|${diagnostic.directoryPath}|${diagnostic.message}`);
  }
  return hash.digest('hex');
}

function summaryRevision(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function scanSource(
  files: AgentSkillRepositoryLike | null,
  source: AgentSkillSource,
): Promise<{ summaries: AgentSkillSummary[]; diagnostics: AgentSkillDiagnostic[] }> {
  if (!files) {
    return { summaries: [], diagnostics: [] };
  }
  if (!(await files.exists(source.rootPath))) {
    return { summaries: [], diagnostics: [] };
  }
  const listing = await files.listFolders(source.rootPath);
  const direct = listing.filter(folder => path.posix.dirname(folder) === source.rootPath);
  const summaries: AgentSkillSummary[] = [];
  const diagnostics: AgentSkillDiagnostic[] = [];
  for (const directoryPath of direct) {
    const folderName = path.posix.basename(directoryPath);
    const filePath = `${directoryPath}/${SKILL_FILENAME}`;
    let raw: string;
    try {
      raw = await files.read(filePath);
    } catch (error) {
      diagnostics.push({
        source,
        directoryPath,
        message: error instanceof Error
          ? error.message
          : `Could not read ${SKILL_FILENAME}`,
      });
      continue;
    }
    let parsed;
    try {
      parsed = parseAgentSkillMarkdown(raw, folderName, {
        strictDirectoryName: source.strictDirectoryName,
      });
    } catch (error) {
      diagnostics.push({
        source,
        directoryPath,
        message: error instanceof Error
          ? error.message
          : 'Invalid SKILL.md',
      });
      continue;
    }
    summaries.push({
      name: parsed.name,
      description: parsed.description,
      source,
      scope: source.scope,
      directoryPath,
      filePath,
      revision: summaryRevision(raw),
    });
  }
  summaries.sort((left, right) => left.name.localeCompare(right.name));
  return { summaries, diagnostics };
}

async function loadDocumentFromSource(
  files: AgentSkillRepositoryLike | null,
  source: AgentSkillSource,
  name: string,
): Promise<AgentSkillDocument | null> {
  if (!files) {
    return null;
  }
  if (!(await files.exists(source.rootPath))) {
    return null;
  }
  const listing = await files.listFolders(source.rootPath);
  const direct = listing.filter(folder => path.posix.dirname(folder) === source.rootPath);
  for (const directoryPath of direct) {
    const folderName = path.posix.basename(directoryPath);
    const filePath = `${directoryPath}/${SKILL_FILENAME}`;
    let raw: string;
    try {
      raw = await files.read(filePath);
    } catch {
      continue;
    }
    let parsed;
    try {
      parsed = parseAgentSkillMarkdown(raw, folderName, {
        strictDirectoryName: source.strictDirectoryName,
      });
    } catch {
      continue;
    }
    if (parsed.name !== name) continue;
    return {
      ...parsed,
      source,
      scope: source.scope,
      directoryPath,
      filePath,
      revision: summaryRevision(raw),
    };
  }
  return null;
}

/**
 * Read-only registry that scans provider skill roots (vault + home) and
 * produces a stable `AgentSkillSnapshot`. The snapshot is cached until
 * `invalidate()` is called. Heavy content (instructions, frontmatter) is
 * loaded on demand via `load()` to keep dropdowns cheap.
 */
export class AgentSkillRegistry {
  private cache: RegistryCache | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly files: AgentSkillRepositoryLike,
    private readonly homeFiles: AgentSkillRepositoryLike | null,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  invalidate(): void {
    this.cache = null;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Listener errors must not block invalidation.
      }
    }
  }

  async snapshot(): Promise<AgentSkillSnapshot> {
    const cached = this.cache;
    if (cached) {
      return cached.snapshot;
    }
    const skills: AgentSkillSummary[] = [];
    const diagnostics: AgentSkillDiagnostic[] = [];
    const seenNames = new Set<string>();
    for (const source of AGENT_SKILL_SOURCES) {
      const files = source.scope === 'home' ? this.homeFiles : this.files;
      const { summaries, diagnostics: sourceDiagnostics } = await scanSource(files, source);
      for (const summary of summaries) {
        if (seenNames.has(summary.name)) continue;
        seenNames.add(summary.name);
        skills.push(summary);
      }
      diagnostics.push(...sourceDiagnostics);
    }
    skills.sort((left, right) => left.name.localeCompare(right.name));
    diagnostics.sort((left, right) => (
      left.source.kind.localeCompare(right.source.kind)
      || left.directoryPath.localeCompare(right.directoryPath)
    ));
    const previousGeneratedAt = this.cache?.snapshot.generatedAt;
    const revision = buildRevision(skills, diagnostics);
    const generated = previousGeneratedAt ?? Date.now();
    const snapshot: AgentSkillSnapshot = { revision, generatedAt: generated, skills, diagnostics };
    this.cache = { revision, snapshot };
    return snapshot;
  }

  async load(name: string): Promise<AgentSkillDocument | null> {
    for (const source of AGENT_SKILL_SOURCES) {
      const files = source.scope === 'home' ? this.homeFiles : this.files;
      const document = await loadDocumentFromSource(files, source, name);
      if (document) {
        return document;
      }
    }
    return null;
  }

  async emptySnapshot(): Promise<AgentSkillSnapshot> {
    return EMPTY_SNAPSHOT;
  }
}

export function createAgentSkillRegistry(
  files: VaultFileAdapter,
  homeFiles?: HomeFileAdapter | VaultFileAdapter | null,
): AgentSkillRegistry {
  return new AgentSkillRegistry(files, homeFiles ?? null);
}
