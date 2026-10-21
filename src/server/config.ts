import type { AuthMode } from '../lib/auth-mode.js';

export type { AuthMode };

export interface OidcConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly callbackUrl: string;
}

interface BaseConfig {
  readonly appSecret: string;
  readonly databasePath: string;
  readonly allowRegistration: boolean;
  readonly serveWeb: boolean;
  readonly secureCookies: boolean;
  readonly port: number;
  readonly host: string;
}

export type AppConfig = BaseConfig &
  (
    | { readonly authMode: 'local'; readonly oidc: null }
    | { readonly authMode: 'oidc'; readonly oidc: OidcConfig }
  );

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      [
        'Invalid configuration:',
        ...problems.map((problem) => `  - ${problem}`),
        'See .env.example.',
      ].join('\n'),
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

const OIDC_NAMES = [
  'OIDC_ISSUER',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_CALLBACK_URL',
] as const;

const MIN_APP_SECRET_LENGTH = 32;
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';

/** Returns the raw value, or undefined when unset, empty or whitespace-only. */
function present(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Marks a property as non-enumerable so JSON.stringify and util.inspect skip it. */
function hide(target: object, key: string): void {
  Object.defineProperty(target, key, { enumerable: false });
}

/**
 * Pure: reads only the given env object. It never touches process.env or files,
 * never exits and never logs. Messages name variables and never include values.
 */
export function loadConfig(env: Env): AppConfig {
  const problems: string[] = [];

  const appSecret = present(env, 'APP_SECRET');
  if (appSecret === undefined) {
    problems.push('APP_SECRET is required');
  } else if (appSecret.length < MIN_APP_SECRET_LENGTH) {
    problems.push(`APP_SECRET must be at least ${String(MIN_APP_SECRET_LENGTH)} characters`);
  }

  const databasePath = present(env, 'DATABASE_PATH');
  if (databasePath === undefined) {
    problems.push('DATABASE_PATH is required');
  }

  let port = DEFAULT_PORT;
  const rawPort = env['PORT'];
  if (rawPort !== undefined && rawPort !== '') {
    const parsed = /^\d+$/.test(rawPort) ? Number(rawPort) : Number.NaN;
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
      port = parsed;
    } else {
      problems.push('PORT must be an integer from 1 to 65535');
    }
  }

  const host = present(env, 'HOST')?.trim() ?? DEFAULT_HOST;

  let allowRegistration = false;
  const rawRegistration = env['ALLOW_REGISTRATION'];
  if (rawRegistration !== undefined && rawRegistration !== '') {
    const normalized = rawRegistration.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'false') {
      allowRegistration = normalized === 'true';
    } else {
      problems.push('ALLOW_REGISTRATION must be "true" or "false"');
    }
  }

  const serveWeb = env['NODE_ENV'] === 'production';
  const secureCookies = env['NODE_ENV'] === 'production';

  const oidcValues = OIDC_NAMES.map((name) => present(env, name));
  const missingOidc = OIDC_NAMES.filter((_, index) => oidcValues[index] === undefined);
  let oidc: OidcConfig | null = null;
  if (missingOidc.length === OIDC_NAMES.length) {
    oidc = null;
  } else if (missingOidc.length > 0) {
    problems.push(
      `OIDC is partly configured. Set all of OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and OIDC_CALLBACK_URL, or none of them. Missing: ${missingOidc.join(', ')}.`,
    );
  } else {
    const [issuer, clientId, clientSecret, callbackUrl] = oidcValues.map((value) => value ?? '');
    const candidate: OidcConfig = {
      issuer: (issuer ?? '').trim(),
      clientId: (clientId ?? '').trim(),
      clientSecret: clientSecret ?? '',
      callbackUrl: (callbackUrl ?? '').trim(),
    };
    if (!isHttpUrl(candidate.issuer)) {
      problems.push('OIDC_ISSUER must be an absolute URL');
    }
    if (!isHttpUrl(candidate.callbackUrl)) {
      problems.push('OIDC_CALLBACK_URL must be an absolute URL');
    }
    oidc = candidate;
  }

  if (problems.length > 0 || appSecret === undefined || databasePath === undefined) {
    throw new ConfigError(problems);
  }

  const base: BaseConfig = {
    appSecret,
    databasePath,
    allowRegistration,
    serveWeb,
    secureCookies,
    port,
    host,
  };
  hide(base, 'appSecret');

  if (oidc === null) {
    return Object.assign(base, { authMode: 'local' as const, oidc: null });
  }
  hide(oidc, 'clientSecret');
  return Object.assign(base, { authMode: 'oidc' as const, oidc });
}
