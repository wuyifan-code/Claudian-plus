/**
 * Optional semantic embedding boundary.
 *
 * The plugin intentionally does not bundle a model runtime. A user may point
 * this provider at a local Ollama or OpenAI-compatible embeddings endpoint;
 * when the endpoint is unavailable, VaultRetrievalService keeps its
 * deterministic lexical index and reports the degraded state.
 */

export interface EmbeddingProvider {
  readonly id: string;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

export interface LocalEmbeddingProviderOptions {
  endpoint: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}

type OllamaEmbeddingResponse = {
  embeddings?: unknown;
};

type OpenAIEmbeddingResponse = {
  data?: Array<{ embedding?: unknown }>;
};

const DEFAULT_TIMEOUT_MS = 30_000;

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;

  private readonly endpoint: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: LocalEmbeddingProviderOptions) {
    this.endpoint = normalizeEndpoint(options.endpoint);
    this.model = options.model.trim();
    this.apiKey = options.apiKey?.trim() || undefined;
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.id = `local:${this.endpoint}:${this.model}`;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!this.endpoint) throw new Error('Embedding endpoint is not configured');
    if (!this.model) throw new Error('Embedding model is not configured');

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const target = resolveEmbeddingUrl(this.endpoint);
      const response = await fetch(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Embedding service returned ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ''}`);
      }

      const payload = await response.json() as OllamaEmbeddingResponse & OpenAIEmbeddingResponse;
      const vectors = Array.isArray(payload.embeddings)
        ? payload.embeddings
        : Array.isArray(payload.data)
          ? payload.data.map(item => item.embedding)
          : null;
      if (!vectors || vectors.length !== texts.length) {
        throw new Error('Embedding service returned an unexpected vector count');
      }
      return validateVectors(vectors);
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

function resolveEmbeddingUrl(endpoint: string): string {
  if (/\/(?:api\/embed|v1\/embeddings)$/iu.test(endpoint)) return endpoint;
  // Ollama is the default local runtime and exposes /api/embed. A custom
  // OpenAI-compatible endpoint can be supplied with /v1/embeddings explicitly.
  return `${endpoint}/api/embed`;
}

function validateVectors(values: unknown[]): number[][] {
  const vectors = values.map((value) => {
    if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
      throw new Error('Embedding service returned an invalid vector');
    }
    return value as number[];
  });
  const dimensions = vectors[0]?.length ?? 0;
  if (dimensions === 0 || vectors.some(vector => vector.length !== dimensions)) {
    throw new Error('Embedding service returned vectors with inconsistent dimensions');
  }
  return vectors;
}
