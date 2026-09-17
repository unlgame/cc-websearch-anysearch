import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
  })),
}));

function envelope(results: Array<Record<string, unknown>>, code = 0, message = 'success'): string {
  return JSON.stringify({ code, message, request_id: 'test-id', data: { results } });
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AnySearch provider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('mapResults', () => {
    it('maps the AnySearch envelope onto the shared SearchResult shape', async () => {
      const { mapResults } = await import('../src/lib/anysearch.js');
      const results = mapResults({
        code: 0,
        data: {
          results: [{ title: 'Title', url: 'https://example.com', snippet: 'Snippet text' }],
        },
      });

      expect(results).toEqual([
        { title: 'Title', url: 'https://example.com', snippet: 'Snippet text' },
      ]);
    });

    it('falls back to content when snippet is missing and drops url-less rows', async () => {
      const { mapResults } = await import('../src/lib/anysearch.js');
      const results = mapResults({
        code: 0,
        data: {
          results: [
            { title: 'A', url: 'https://a.example', content: 'Long   cleaned\ncontent' },
            { title: 'No URL', snippet: 'ignored' },
          ],
        },
      });

      expect(results).toHaveLength(1);
      expect(results[0].snippet).toBe('Long cleaned content');
    });

    it('truncates very long content so XML output stays snippet-sized', async () => {
      const { mapResults } = await import('../src/lib/anysearch.js');
      const results = mapResults({
        code: 0,
        data: { results: [{ url: 'https://a.example', content: 'x'.repeat(1000) }] },
      });

      expect(results[0].snippet).toHaveLength(403);
      expect(results[0].snippet?.endsWith('...')).toBe(true);
    });

    it('returns an empty array for a response without results', async () => {
      const { mapResults } = await import('../src/lib/anysearch.js');
      expect(mapResults({ code: 0, data: {} })).toEqual([]);
    });
  });

  describe('searchAnySearch', () => {
    it('POSTs query and clamped max_results and returns mapped results', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope([{ title: 'T', url: 'https://example.com', snippet: 'S' }])),
      );

      const { searchAnySearch } = await import('../src/lib/anysearch.js');
      const results = await searchAnySearch('hello world', { maxResults: 3 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.anysearch.com/v1/search');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ query: 'hello world', max_results: 3 });
      expect(init.headers.Authorization).toBeUndefined();
      expect(results).toEqual([{ title: 'T', url: 'https://example.com', snippet: 'S' }]);
    });

    it('sends the bearer token and optional routing fields when configured', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(envelope([])));

      const { searchAnySearch } = await import('../src/lib/anysearch.js');
      await searchAnySearch('golang release', {
        apiKey: 'as_sk_test',
        maxResults: 99,
        tag: 'code.doc',
        zone: 'intl',
        language: 'en',
        params: { library: 'golang' },
      });

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers.Authorization).toBe('Bearer as_sk_test');
      expect(JSON.parse(init.body)).toEqual({
        query: 'golang release',
        max_results: 10, // clamped to the documented 1-10 range
        tag: 'code.doc',
        zone: 'intl',
        language: 'en',
        params: { library: 'golang' },
      });
    });

    it('throws on a non-2xx response', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse('Unauthorized', 401));

      const { searchAnySearch } = await import('../src/lib/anysearch.js');
      await expect(searchAnySearch('x')).rejects.toThrow(/HTTP 401/);
    });

    it('throws on a business error envelope', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(envelope([], -1, 'Rate limited')));

      const { searchAnySearch } = await import('../src/lib/anysearch.js');
      await expect(searchAnySearch('x')).rejects.toThrow(/Rate limited/);
    });
  });

  describe('isAnySearchTransientError', () => {
    it('retries on transport errors and 429/5xx', async () => {
      const { isAnySearchTransientError } = await import('../src/lib/retry.js');
      expect(
        isAnySearchTransientError(new Error('Request timed out after 30000ms (ETIMEDOUT)')),
      ).toBe(true);
      expect(
        isAnySearchTransientError(new Error('AnySearch returned HTTP 429: Too Many Requests')),
      ).toBe(true);
      expect(isAnySearchTransientError(new Error('AnySearch returned HTTP 503: a'))).toBe(true);
      expect(
        isAnySearchTransientError(new Error('AnySearch returned HTTP 401: Unauthorized')),
      ).toBe(false);
      expect(isAnySearchTransientError(new Error('AnySearch error (code -1): Rate limited'))).toBe(
        false,
      );
      expect(isAnySearchTransientError('nope')).toBe(false);
    });
  });
});
