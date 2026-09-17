import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Schema (D-01): nested strict objects, same pattern as input.ts
export const ConfigSchema = z.strictObject({
  retry: z
    .strictObject({
      maxRetries: z.number().int().min(0).optional(),
      baseDelay: z.number().int().min(0).optional(),
      maxDelay: z.number().int().min(0).optional(),
      timeout: z.number().int().min(0).optional(),
    })
    .optional(),
  logging: z
    .strictObject({
      level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    })
    .optional(),
  // Search backend selection (default: duckduckgo)
  provider: z.enum(['duckduckgo', 'anysearch']).optional(),
  anysearch: z
    .strictObject({
      // Prefer the ANYSEARCH_API_KEY env var over storing the key in the config file
      apiKey: z.string().min(1).optional(),
      maxResults: z.number().int().min(1).max(10).optional(),
      tag: z.string().min(1).optional(),
      zone: z.enum(['cn', 'intl']).optional(),
      language: z.string().min(1).optional(),
      // Fall back to DuckDuckGo when AnySearch fails (default: true)
      fallbackToDuckDuckGo: z.boolean().optional(),
    })
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

// Hardcoded defaults
const DEFAULTS = {
  retry: { maxRetries: 4, baseDelay: 1000, maxDelay: 16000, timeout: 30000 },
  logging: { level: 'info' as const },
  provider: 'duckduckgo' as const,
  anysearch: { maxResults: 10, fallbackToDuckDuckGo: true },
} as const;

// Env var mapping (D-02, D-04)
const ENV_MAP = {
  'retry.maxRetries': 'WEBSEARCH_RETRY_MAX_RETRIES',
  'retry.baseDelay': 'WEBSEARCH_RETRY_BASE_DELAY',
  'retry.maxDelay': 'WEBSEARCH_RETRY_MAX_DELAY',
  'retry.timeout': 'WEBSEARCH_RETRY_TIMEOUT',
  'logging.level': 'WEBSEARCH_LOGGING_LEVEL',
  provider: 'WEBSEARCH_PROVIDER',
  'anysearch.apiKey': 'ANYSEARCH_API_KEY',
  'anysearch.maxResults': 'WEBSEARCH_ANYSEARCH_MAX_RESULTS',
  'anysearch.tag': 'WEBSEARCH_ANYSEARCH_TAG',
  'anysearch.zone': 'WEBSEARCH_ANYSEARCH_ZONE',
  'anysearch.language': 'WEBSEARCH_ANYSEARCH_LANGUAGE',
} as const;

// Config path (D-03)
const CONFIG_PATH = join(homedir(), '.config', 'websearch', 'config.json');

// Fully resolved config type -- all fields present
export interface ResolvedConfig {
  retry: {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    timeout: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
  provider: 'duckduckgo' | 'anysearch';
  anysearch: {
    apiKey?: string;
    maxResults: number;
    tag?: string;
    zone?: 'cn' | 'intl';
    language?: string;
    fallbackToDuckDuckGo: boolean;
  };
}

// Read config file (D-03, D-05)
function readConfigFile(): Record<string, unknown> | null {
  if (!existsSync(CONFIG_PATH)) return null; // D-05: silent
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    process.stderr.write('[warn] Failed to parse config file\n');
    return null;
  }
}

// Validate config file content and emit warnings (D-06, D-07)
function validateFileConfig(raw: Record<string, unknown>): Config {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    process.stderr.write(
      '[warn] Config file has unrecognized keys or invalid values -- entire file ignored\n',
    );
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      process.stderr.write(`[warn] Invalid config at ${path}: ${issue.message}\n`);
    }
    return {};
  }
  return result.data;
}

// Env var resolution helpers
const NUMBER_KEYS = new Set([
  'retry.maxRetries',
  'retry.baseDelay',
  'retry.maxDelay',
  'retry.timeout',
  'anysearch.maxResults',
]);

const VALID_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const VALID_PROVIDERS = new Set(['duckduckgo', 'anysearch']);
const VALID_ZONES = new Set(['cn', 'intl']);

function resolveFromEnv(key: string): string | number | undefined {
  const envName = ENV_MAP[key as keyof typeof ENV_MAP];
  if (!envName) return undefined;
  const envValue = process.env[envName];
  if (envValue === undefined || envValue === '') return undefined;

  if (NUMBER_KEYS.has(key)) {
    const num = Number(envValue);
    if (Number.isNaN(num) || !Number.isInteger(num) || num < 0) {
      process.stderr.write(`[warn] Invalid number for ${envName}: "${envValue}"\n`);
      return undefined;
    }
    return num;
  }

  if (key === 'logging.level') {
    if (!VALID_LEVELS.has(envValue)) {
      process.stderr.write(`[warn] Invalid log level: "${envValue}"\n`);
      return undefined;
    }
    return envValue;
  }

  if (key === 'provider') {
    if (!VALID_PROVIDERS.has(envValue)) {
      process.stderr.write(`[warn] Invalid provider: "${envValue}"\n`);
      return undefined;
    }
    return envValue;
  }

  if (key === 'anysearch.zone') {
    if (!VALID_ZONES.has(envValue)) {
      process.stderr.write(`[warn] Invalid zone: "${envValue}"\n`);
      return undefined;
    }
    return envValue;
  }

  return envValue;
}

// Per-key resolution: env > file > default (D-04)
function resolve<T>(key: string, fileValue: T | undefined, defaultValue: T): T {
  const envValue = resolveFromEnv(key);
  if (envValue !== undefined) return envValue as T;
  if (fileValue !== undefined) return fileValue;
  return defaultValue;
}

// Main export
export function loadConfig(): ResolvedConfig {
  const rawFile = readConfigFile();
  const fileConfig = rawFile ? validateFileConfig(rawFile) : {};

  return {
    retry: {
      maxRetries: resolve(
        'retry.maxRetries',
        fileConfig.retry?.maxRetries,
        DEFAULTS.retry.maxRetries,
      ),
      baseDelay: resolve('retry.baseDelay', fileConfig.retry?.baseDelay, DEFAULTS.retry.baseDelay),
      maxDelay: resolve('retry.maxDelay', fileConfig.retry?.maxDelay, DEFAULTS.retry.maxDelay),
      timeout: resolve('retry.timeout', fileConfig.retry?.timeout, DEFAULTS.retry.timeout),
    },
    logging: {
      level: resolve('logging.level', fileConfig.logging?.level, DEFAULTS.logging.level),
    },
    provider: resolve('provider', fileConfig.provider, DEFAULTS.provider),
    anysearch: {
      apiKey: resolve('anysearch.apiKey', fileConfig.anysearch?.apiKey, undefined),
      maxResults: resolve(
        'anysearch.maxResults',
        fileConfig.anysearch?.maxResults,
        DEFAULTS.anysearch.maxResults,
      ),
      tag: resolve('anysearch.tag', fileConfig.anysearch?.tag, undefined),
      zone: resolve('anysearch.zone', fileConfig.anysearch?.zone, undefined),
      language: resolve('anysearch.language', fileConfig.anysearch?.language, undefined),
      fallbackToDuckDuckGo:
        fileConfig.anysearch?.fallbackToDuckDuckGo ?? DEFAULTS.anysearch.fallbackToDuckDuckGo,
    },
  };
}
