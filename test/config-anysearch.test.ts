import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';

// Mock fs module to avoid touching the real config file
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// Import after mocking
const { loadConfig, ConfigSchema } = await import('../src/lib/config.js');

describe('provider selection (AnySearch)', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.mocked(existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('should default to duckduckgo with safe anysearch defaults', () => {
    const config = loadConfig();

    expect(config.provider).toBe('duckduckgo');
    expect(config.anysearch.maxResults).toBe(10);
    expect(config.anysearch.fallbackToDuckDuckGo).toBe(true);
    expect(config.anysearch.apiKey).toBeUndefined();
    expect(config.anysearch.tag).toBeUndefined();
  });

  it('should read the provider and anysearch options from the config file', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        provider: 'anysearch',
        anysearch: {
          maxResults: 5,
          tag: 'code.doc',
          zone: 'intl',
          language: 'en',
          fallbackToDuckDuckGo: false,
        },
      }),
    );

    const config = loadConfig();

    expect(config.provider).toBe('anysearch');
    expect(config.anysearch).toEqual({
      apiKey: undefined,
      maxResults: 5,
      tag: 'code.doc',
      zone: 'intl',
      language: 'en',
      fallbackToDuckDuckGo: false,
    });
  });

  it('should let env vars override the config file', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ provider: 'duckduckgo', anysearch: { maxResults: 5 } }),
    );
    vi.stubEnv('WEBSEARCH_PROVIDER', 'anysearch');
    vi.stubEnv('ANYSEARCH_API_KEY', 'as_sk_env');
    vi.stubEnv('WEBSEARCH_ANYSEARCH_MAX_RESULTS', '7');
    vi.stubEnv('WEBSEARCH_ANYSEARCH_ZONE', 'cn');

    const config = loadConfig();

    expect(config.provider).toBe('anysearch');
    expect(config.anysearch.maxResults).toBe(7);
    expect(config.anysearch.zone).toBe('cn');
    expect(config.anysearch.apiKey).toBe('as_sk_env');
  });

  it('should warn and fall back to the default for an invalid provider', () => {
    vi.stubEnv('WEBSEARCH_PROVIDER', 'bing');

    const config = loadConfig();

    expect(config.provider).toBe('duckduckgo');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid provider: "bing"'));
  });

  it('should warn and fall back to the default for an invalid zone', () => {
    vi.stubEnv('WEBSEARCH_ANYSEARCH_ZONE', 'mars');

    const config = loadConfig();

    expect(config.anysearch.zone).toBeUndefined();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid zone: "mars"'));
  });

  it('should warn and ignore the file when maxResults is out of the 1-10 range', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ provider: 'anysearch', anysearch: { maxResults: 50 } }),
    );

    const config = loadConfig();

    expect(config.anysearch.maxResults).toBe(10);
    expect(config.provider).toBe('duckduckgo'); // whole file ignored
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Config file has unrecognized keys or invalid values'),
    );
  });

  it('should accept the anysearch block in ConfigSchema', () => {
    const result = ConfigSchema.safeParse({
      provider: 'anysearch',
      anysearch: { apiKey: 'as_sk_x', maxResults: 3, tag: 'finance.stock' },
    });
    expect(result.success).toBe(true);
  });

  it('should reject an unknown provider in ConfigSchema', () => {
    expect(ConfigSchema.safeParse({ provider: 'google' }).success).toBe(false);
  });
});
