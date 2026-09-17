import type { SearchResult } from '../types.js';
import { createLogger } from './logger.js';
import type { LogLevel } from './logger.js';

const logger = createLogger('anysearch');

const ANYSEARCH_ENDPOINT = 'https://api.anysearch.com/v1/search';
const DEFAULT_MAX_RESULTS = 10;
const MAX_SNIPPET_CHARS = 400;

export interface AnySearchOptions {
  /** Bearer API key. Omit to use the anonymous (IP rate-limited) tier. */
  apiKey?: string;
  /** 1-10, server caps at 10. */
  maxResults?: number;
  /** Sub-domain tag, e.g. "code.doc", "finance.stock". */
  tag?: string;
  /** "cn" | "intl" */
  zone?: string;
  /** Preferred result language, e.g. "zh-CN" / "en". */
  language?: string;
  /** Extra params forwarded to the upstream sub-domain, e.g. { ticker: "AAPL" }. */
  params?: Record<string, unknown>;
}

interface AnySearchRawResult {
  title?: string;
  url?: string;
  snippet?: string;
  content?: string;
}

interface AnySearchEnvelope {
  code?: number;
  message?: string;
  data?: {
    results?: AnySearchRawResult[];
  };
}

export function configureLogger(level: LogLevel): void {
  logger.setLevel(level);
}

/**
 * AnySearch returns both a short `snippet` and a longer cleaned `content`.
 * Prefer the snippet, fall back to a truncated content blob, and never let a
 * multi-KB content field blow up the XML output.
 */
function toSnippet(raw: AnySearchRawResult): string {
  const text = (raw.snippet ?? raw.content ?? '').replace(/\s+/g, ' ').trim();
  return text.length > MAX_SNIPPET_CHARS ? `${text.slice(0, MAX_SNIPPET_CHARS)}...` : text;
}

export function mapResults(envelope: AnySearchEnvelope): SearchResult[] {
  const raw = envelope.data?.results ?? [];
  const results: SearchResult[] = [];
  for (const item of raw) {
    if (!item.url) continue;
    results.push({
      title: item.title ?? '',
      url: item.url,
      snippet: toSnippet(item),
    });
  }
  return results;
}

export async function searchAnySearch(
  query: string,
  options: AnySearchOptions = {},
): Promise<SearchResult[]> {
  const requested = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const body: Record<string, unknown> = {
    query,
    max_results: Math.min(Math.max(Math.trunc(requested), 1), 10),
  };
  if (options.tag) body.tag = options.tag;
  if (options.zone) body.zone = options.zone;
  if (options.language) body.language = options.language;
  if (options.params && Object.keys(options.params).length > 0) body.params = options.params;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (options.apiKey) {
    headers.Authorization = `Bearer ${options.apiKey}`;
  } else {
    logger.debug('No ANYSEARCH_API_KEY set, using anonymous tier');
  }

  const response = await fetch(ANYSEARCH_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`AnySearch returned HTTP ${response.status}: ${response.statusText}`);
  }

  const envelope = (await response.json()) as AnySearchEnvelope;
  if (envelope.code !== 0) {
    throw new Error(
      `AnySearch error (code ${envelope.code ?? 'unknown'}): ${envelope.message ?? 'unknown error'}`,
    );
  }

  const results = mapResults(envelope);
  if (results.length === 0) {
    logger.debug('AnySearch returned no results');
  }
  return results;
}
