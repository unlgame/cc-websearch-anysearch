import { readStdin, WebSearchInputSchema, validateDomainExclusivity } from './lib/input.js';
import { formatSearchResults } from './lib/output.js';
import { createLogger } from './lib/logger.js';
import type { LogLevel } from './lib/logger.js';
import { loadConfig } from './lib/config.js';
import type { ResolvedConfig } from './lib/config.js';
import { searchDDG } from './lib/duckduckgo.js';
import { searchAnySearch } from './lib/anysearch.js';
import type { SearchResult } from './types.js';
import {
  retryWithBackoff,
  getRetryConfig,
  isDDGTransientError,
  isAnySearchTransientError,
} from './lib/retry.js';
import { filterByDomains } from './lib/filter.js';
import * as ddgModule from './lib/duckduckgo.js';
import * as anysearchModule from './lib/anysearch.js';
import * as retryModule from './lib/retry.js';
import * as fetchModule from './lib/fetch.js';

function configureModuleLoggers(level: LogLevel): void {
  ddgModule.configureLogger(level);
  anysearchModule.configureLogger(level);
  retryModule.configureLogger(level);
  fetchModule.configureLogger(level);
}

async function runDuckDuckGo(query: string, config: ResolvedConfig): Promise<SearchResult[]> {
  return retryWithBackoff(() => searchDDG(query), isDDGTransientError, getRetryConfig(config));
}

async function runAnySearch(query: string, config: ResolvedConfig): Promise<SearchResult[]> {
  return retryWithBackoff(
    () =>
      searchAnySearch(query, {
        apiKey: config.anysearch.apiKey,
        maxResults: config.anysearch.maxResults,
        tag: config.anysearch.tag,
        zone: config.anysearch.zone,
        language: config.anysearch.language,
      }),
    isAnySearchTransientError,
    getRetryConfig(config),
  );
}

async function search(
  query: string,
  config: ResolvedConfig,
  logger: ReturnType<typeof createLogger>,
): Promise<SearchResult[]> {
  if (config.provider === 'duckduckgo') {
    return runDuckDuckGo(query, config);
  }

  try {
    return await runAnySearch(query, config);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!config.anysearch.fallbackToDuckDuckGo) {
      throw err;
    }
    logger.warn(`AnySearch failed (${message}) -- falling back to DuckDuckGo`);
    return runDuckDuckGo(query, config);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger('websearch', config.logging.level);
  configureModuleLoggers(config.logging.level);

  try {
    const parsed = await readStdin(WebSearchInputSchema);
    logger.info(`Searching for: ${parsed.query} (provider: ${config.provider})`);
    validateDomainExclusivity(parsed);

    const results = await search(parsed.query, config, logger);
    const filtered = filterByDomains(results, parsed.allowed_domains, parsed.blocked_domains);
    process.stdout.write(formatSearchResults(filtered));
  } catch (err: unknown) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

main();
