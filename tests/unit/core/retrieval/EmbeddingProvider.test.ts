import { LocalEmbeddingProvider } from '@/core/retrieval/EmbeddingProvider';

describe('LocalEmbeddingProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls Ollama with a batched input and validates vectors', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ embeddings: [[1, 0], [0, 1]] }),
    } as Response);
    const provider = new LocalEmbeddingProvider({
      endpoint: 'http://127.0.0.1:11434/',
      model: 'nomic-embed-text',
    });

    await expect(provider.embed(['first', 'second'])).resolves.toEqual([[1, 0], [0, 1]]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/embed',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ model: 'nomic-embed-text', input: ['first', 'second'] }),
      }),
    );
  });

  it('supports OpenAI-compatible embedding responses and bearer auth', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
    } as Response);
    const provider = new LocalEmbeddingProvider({
      endpoint: 'https://localhost:8080/v1/embeddings',
      model: 'text-embedding-3-small',
      apiKey: 'local-test-key',
    });

    await expect(provider.embed(['query'])).resolves.toEqual([[0.1, 0.2]]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://localhost:8080/v1/embeddings');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer local-test-key' }),
    }));
  });

  it('fails loudly on malformed responses so retrieval can report a fallback', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ embeddings: [[1], [2, 3]] }),
    } as Response);
    const provider = new LocalEmbeddingProvider({
      endpoint: 'http://127.0.0.1:11434',
      model: 'nomic-embed-text',
    });

    await expect(provider.embed(['one', 'two'])).rejects.toThrow('inconsistent dimensions');
  });
});
