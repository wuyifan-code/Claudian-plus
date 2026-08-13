import type { AgentMentionProvider } from '../../../core/providers/types';
import type { DshAgentStorage, DshVaultAgent } from './DshAgentStorage';

export class DshAgentMentionProvider implements AgentMentionProvider {
  private agents: DshVaultAgent[] = [];
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly storage: DshAgentStorage) {}

  async loadAgents(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }
    const promise = this.storage.loadAll().then((agents) => {
      this.agents = agents;
      this.loaded = true;
    });
    this.loadPromise = promise;
    try {
      await promise;
    } finally {
      if (this.loadPromise === promise) {
        this.loadPromise = null;
      }
    }
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.loadAgents();
    }
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  searchAgents(query: string): Array<{
    description?: string;
    id: string;
    name: string;
    source: 'plugin' | 'vault' | 'global' | 'builtin';
  }> {
    const normalizedQuery = query.trim().toLowerCase();
    return this.agents
      .filter((agent) => (
        normalizedQuery.length === 0
        || agent.name.toLowerCase().includes(normalizedQuery)
        || agent.description.toLowerCase().includes(normalizedQuery)
      ))
      .map((agent) => ({
        description: agent.description,
        id: agent.id,
        name: agent.name,
        source: agent.origin === 'home' ? 'global' as const : 'vault' as const,
      }));
  }
}
