import {
  readDshProfileModelCatalog,
} from '@/providers/dsh/models/DshProfileModelsReader';

describe('readDshProfileModelCatalog', () => {
  it('extracts models from a direct llm adapter config', () => {
    const catalog = readDshProfileModelCatalog(`
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'
  config:
    thinking: enabled
    models:
      - id: deepseek-v4-flash
        contextWindow: 128000
      - id: deepseek-v4-pro
        contextWindow: 128000
`);
    expect(catalog.models).toEqual([
      { rawId: 'deepseek-v4-flash', contextWindow: 128000 },
      { rawId: 'deepseek-v4-pro', contextWindow: 128000 },
    ]);
    expect(catalog.acpAgent).toBeNull();
  });

  it('extracts models nested under providers dicts (pi-ai shape)', () => {
    const catalog = readDshProfileModelCatalog(`
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      opencode-go:
        apiKeyEnv: OPENCODE_GO_API_KEY
        models:
          - id: deepseek-v4-flash
            name: DeepSeek V4 Flash
            contextWindow: 1000000
`);
    expect(catalog.models).toEqual([
      { rawId: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', contextWindow: 1000000 },
    ]);
  });

  it('extracts models from entries nested under an insert block', () => {
    const catalog = readDshProfileModelCatalog(`
- insert:
    - id: llm-deepseek
      name: '@deepseek-ai/dsh-llm-deepseek'
      config:
        models:
          - id: deepseek-v4-pro
`);
    expect(catalog.models).toEqual([{ rawId: 'deepseek-v4-pro' }]);
  });

  it('reads acp-agent provider and model pins', () => {
    const catalog = readDshProfileModelCatalog(`
- id: acp-agent
  name: '@deepseek-ai/dsh-acp-demo'
  config:
    provider: opencode-go
    model: deepseek-v4-flash
    persistenceRoot: './.sessions'
    workspaceContext:
      maxBytes: 65536
`);
    expect(catalog.acpAgent).toEqual({ provider: 'opencode-go', model: 'deepseek-v4-flash' });
  });

  it('strips quotes from scalar values', () => {
    const catalog = readDshProfileModelCatalog(`
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      x:
        models:
          - id: 'deepseek-v4-flash'
`);
    expect(catalog.models).toEqual([{ rawId: 'deepseek-v4-flash' }]);
  });

  it('ignores !!js tagged values and unrelated entries', () => {
    const catalog = readDshProfileModelCatalog(`
- id: sandbox-policy
  name: '@deepseek-ai/dsh-sandbox-policy'
  config:
    mode: workspace-write
    workspaceRoot: !!js process.cwd()
- id: llm-deepseek
  config:
    models:
      - id: deepseek-v4-flash
`);
    expect(catalog.models).toEqual([{ rawId: 'deepseek-v4-flash' }]);
  });

  it('merges duplicate model ids across entries with the first one winning', () => {
    const catalog = readDshProfileModelCatalog(`
- id: llm-deepseek
  config:
    models:
      - id: deepseek-v4-flash
        contextWindow: 128000
- id: llm-pi-ai
  config:
    providers:
      opencode-go:
        models:
          - id: deepseek-v4-flash
            contextWindow: 1000000
`);
    expect(catalog.models).toEqual([{ rawId: 'deepseek-v4-flash', contextWindow: 128000 }]);
  });

  it('returns an empty catalog for empty or malformed content', () => {
    expect(readDshProfileModelCatalog('')).toEqual({ models: [], acpAgent: null });
    expect(readDshProfileModelCatalog('not yaml at all')).toEqual({ models: [], acpAgent: null });
  });
});
