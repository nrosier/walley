import { isIP } from 'node:net';
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
  /** The origin browsers use to reach Walley, e.g. https://walley.example.com. No trailing slash. */
  readonly publicOrigin: string;
  readonly serveWeb: boolean;
  readonly secureCookies: boolean;
  readonly port: number;
  readonly host: string;
  /** Addresses or CIDR ranges of the reverse proxies whose X-Forwarded-For Walley trusts. False trusts none. */
  readonly trustProxy: string[] | false;
  /**
   * SMTP URL (smtp: or smtps:) used to send verification mail. May embed credentials, so it is
   * hidden from enumeration and must never be logged. Null when mail is not needed (OIDC mode, or
   * registration off), in which case SMTP_URL is ignored.
   */
  readonly smtpUrl: string | null;
  /** From address for outgoing mail. Null when mail is not needed (same rule as smtpUrl). */
  readonly mailFrom: string | null;
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

const LOCAL_HTTP_HOSTNAMES: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];
const OIDC_CALLBACK_PATH = '/api/auth/oidc/callback';

const PUBLIC_ORIGIN_SHAPE_MESSAGE =
  'PUBLIC_ORIGIN must be an absolute http or https origin with no path, query, fragment or credentials';

type OriginResult = { readonly origin: string } | { readonly problem: string };

/**
 * True when the raw string has "?" or "#" anywhere, or "@" in the authority (the text after "://"
 * and before the first "/", "?" or "#"). The URL parser reports an empty query, fragment or
 * userinfo as '', so the parsed fields cannot catch them. An "@" in a path is legal and allowed.
 */
function hasRawUserinfoQueryOrFragment(value: string): boolean {
  if (value.includes('?') || value.includes('#')) {
    return true;
  }
  const schemeEnd = value.indexOf('://');
  if (schemeEnd === -1) {
    return false;
  }
  const rest = value.slice(schemeEnd + 3);
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  return authority.includes('@');
}

/**
 * Parses a bare http(s) origin. Unlike URL.origin on its own, this rejects a path, query,
 * fragment or credentials instead of dropping them. Plain http is allowed only for loopback hosts.
 */
function parseOrigin(value: string): OriginResult {
  const shape = { problem: PUBLIC_ORIGIN_SHAPE_MESSAGE };
  if (hasRawUserinfoQueryOrFragment(value)) {
    return shape;
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return shape;
    }
    if (url.hostname.endsWith('.')) {
      return { problem: 'PUBLIC_ORIGIN host must not end with a dot' };
    }
    if (url.protocol === 'http:' && !LOCAL_HTTP_HOSTNAMES.includes(url.hostname)) {
      return {
        problem:
          'PUBLIC_ORIGIN must use https (http is allowed only for localhost, 127.0.0.1 or [::1])',
      };
    }
    return { origin: url.origin };
  } catch {
    return shape;
  }
}

/** True when any character is above U+007F. The URL parser can map such characters into a different host. */
function hasNonAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) {
      return true;
    }
  }
  return false;
}

/** The issuer must start with "http(s)://" and hold no tab, CR, LF or backslash, which URL parsing would repair. */
function hasStrictSchemeSeparator(value: string): boolean {
  return /^https?:\/\//i.test(value) && !/[\t\r\n\\]/.test(value);
}

function hasCredentialsQueryOrFragment(url: URL): boolean {
  return url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '';
}

const TRUST_PROXY_MESSAGE =
  'TRUST_PROXY must be a comma-separated list of IP addresses or CIDR ranges';

const MIN_IPV4_PREFIX = 8;
const MIN_IPV6_PREFIX = 32;
/** ::ffff:0:0, the start of the IPv4-mapped range ::ffff:0:0/96. */
const IPV4_MAPPED_BASE = 0xffffn << 32n;
const IPV4_MAPPED_PREFIX = 96;

/** Parses a valid IPv4 or IPv6 address (net.isIP already accepted it) into an integer. */
function addressToBigInt(address: string, version: 4 | 6): bigint {
  const toBytes = (dotted: string): bigint =>
    dotted.split('.').reduce((acc, part) => (acc << 8n) | BigInt(part), 0n);
  if (version === 4) {
    return toBytes(address);
  }
  let text = address;
  const lastColon = text.lastIndexOf(':');
  let tail: bigint[] = [];
  if (text.slice(lastColon + 1).includes('.')) {
    const v4 = toBytes(text.slice(lastColon + 1));
    tail = [v4 >> 16n, v4 & 0xffffn];
    text = text.slice(0, lastColon + 1) + '0:0';
  }
  const [head = '', rest] = text.split('::');
  const toGroups = (part: string): bigint[] =>
    part === '' ? [] : part.split(':').map((group) => BigInt(`0x${group}`));
  let groups: bigint[];
  if (rest === undefined) {
    groups = toGroups(head);
  } else {
    const before = toGroups(head);
    const after = toGroups(rest);
    groups = [...before, ...new Array<bigint>(8 - before.length - after.length).fill(0n), ...after];
  }
  if (tail.length > 0) {
    groups = [...groups.slice(0, 6), ...tail];
  }
  return groups.reduce((acc, group) => (acc << 16n) | group, 0n);
}

/**
 * True for an IPv4 or IPv6 address, or a CIDR range. A range needs an in-range integer prefix of
 * at least 8 (IPv4) or 32 (IPv6), an address equal to its network address, and no overlap with the
 * IPv4-mapped IPv6 range. Zone IDs are refused.
 */
function isTrustedProxyEntry(entry: string): boolean {
  if (entry.includes('%')) {
    return false;
  }
  const slash = entry.indexOf('/');
  if (slash === -1) {
    return isIP(entry) !== 0;
  }
  const version = isIP(entry.slice(0, slash));
  const prefixText = entry.slice(slash + 1);
  if ((version !== 4 && version !== 6) || !/^\d{1,3}$/.test(prefixText)) {
    return false;
  }
  const prefix = Number(prefixText);
  const width = version === 4 ? 32 : 128;
  const minimum = version === 4 ? MIN_IPV4_PREFIX : MIN_IPV6_PREFIX;
  if (prefix < minimum || prefix > width) {
    return false;
  }
  const value = addressToBigInt(entry.slice(0, slash), version);
  const hostBits = BigInt(width - prefix);
  if ((value >> hostBits) << hostBits !== value) {
    return false;
  }
  if (version === 6) {
    const shared = BigInt(128 - Math.min(prefix, IPV4_MAPPED_PREFIX));
    if (value >> shared === IPV4_MAPPED_BASE >> shared) {
      return false;
    }
  }
  return true;
}

const SMTP_SCHEMES: readonly string[] = ['smtp:', 'smtps:'];
const MAIL_FROM_SHAPE = /^[^\s@<>,;:"]+@[^\s@<>,;:"]+\.[^\s@<>,;:"]+$/;

/** True when the value parses as a URL with an smtp: or smtps: scheme. Never reports the value. */
function isSmtpUrl(value: string): boolean {
  try {
    return SMTP_SCHEMES.includes(new URL(value).protocol);
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

  let publicOrigin: string | undefined;
  const rawPublicOrigin = present(env, 'PUBLIC_ORIGIN');
  if (rawPublicOrigin === undefined) {
    problems.push('PUBLIC_ORIGIN is required');
  } else {
    const parsedOrigin = parseOrigin(rawPublicOrigin.trim());
    if ('problem' in parsedOrigin) {
      problems.push(parsedOrigin.problem);
    } else {
      publicOrigin = parsedOrigin.origin;
    }
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

  let trustProxy: string[] | false = false;
  const rawTrustProxy = present(env, 'TRUST_PROXY');
  if (rawTrustProxy !== undefined) {
    const entries = rawTrustProxy
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    if (entries.length === 0 || !entries.every(isTrustedProxyEntry)) {
      problems.push(TRUST_PROXY_MESSAGE);
    } else {
      trustProxy = entries;
    }
  }

  const serveWeb = env['NODE_ENV'] === 'production';
  const secureCookies =
    env['NODE_ENV'] === 'production' ||
    (publicOrigin !== undefined && publicOrigin.startsWith('https:'));

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
    if (hasNonAscii(candidate.issuer)) {
      problems.push('OIDC_ISSUER must use ASCII only (write an internationalised host in punycode)');
    } else if (!hasStrictSchemeSeparator(candidate.issuer) || !isHttpUrl(candidate.issuer)) {
      problems.push('OIDC_ISSUER must be an absolute URL');
    } else {
      const issuerUrl = new URL(candidate.issuer);
      if (issuerUrl.protocol === 'http:' && !LOCAL_HTTP_HOSTNAMES.includes(issuerUrl.hostname)) {
        problems.push(
          'OIDC_ISSUER must use https (http is allowed only for localhost, 127.0.0.1 or [::1])',
        );
      }
      if (
        hasRawUserinfoQueryOrFragment(candidate.issuer) ||
        hasCredentialsQueryOrFragment(issuerUrl)
      ) {
        problems.push('OIDC_ISSUER must not contain credentials, a query or a fragment');
      }
    }
    let storedCallbackUrl = candidate.callbackUrl;
    if (!isHttpUrl(candidate.callbackUrl)) {
      problems.push('OIDC_CALLBACK_URL must be an absolute URL');
    } else {
      const callbackUrl = new URL(candidate.callbackUrl);
      if (callbackUrl.pathname !== OIDC_CALLBACK_PATH) {
        problems.push(`OIDC_CALLBACK_URL path must be ${OIDC_CALLBACK_PATH}`);
      }
      if (publicOrigin !== undefined && callbackUrl.origin !== publicOrigin) {
        problems.push('OIDC_CALLBACK_URL origin must match PUBLIC_ORIGIN');
      }
      if (
        hasRawUserinfoQueryOrFragment(candidate.callbackUrl) ||
        hasCredentialsQueryOrFragment(callbackUrl)
      ) {
        problems.push('OIDC_CALLBACK_URL must not contain credentials, a query or a fragment');
      }
      storedCallbackUrl = callbackUrl.href;
    }
    oidc = { ...candidate, callbackUrl: storedCallbackUrl };
  }

  // Mail is needed only for local registration (verification mail). In OIDC mode, or with
  // registration off, SMTP_URL and MAIL_FROM are not read.
  let smtpUrl: string | null = null;
  let mailFrom: string | null = null;
  if (oidc === null && allowRegistration) {
    const rawSmtpUrl = present(env, 'SMTP_URL');
    const rawMailFrom = present(env, 'MAIL_FROM');
    const missingMail = [
      ...(rawSmtpUrl === undefined ? ['SMTP_URL'] : []),
      ...(rawMailFrom === undefined ? ['MAIL_FROM'] : []),
    ];
    if (missingMail.length > 0) {
      problems.push(
        `SMTP_URL and MAIL_FROM are required when ALLOW_REGISTRATION=true in local mode. Missing: ${missingMail.join(', ')}.`,
      );
    }
    if (rawSmtpUrl !== undefined) {
      if (isSmtpUrl(rawSmtpUrl.trim())) {
        smtpUrl = rawSmtpUrl.trim();
      } else {
        problems.push('SMTP_URL must use the smtp: or smtps: scheme');
      }
    }
    if (rawMailFrom !== undefined) {
      if (MAIL_FROM_SHAPE.test(rawMailFrom.trim())) {
        mailFrom = rawMailFrom.trim();
      } else {
        problems.push('MAIL_FROM must be an email address');
      }
    }
  }

  if (
    problems.length > 0 ||
    appSecret === undefined ||
    databasePath === undefined ||
    publicOrigin === undefined
  ) {
    throw new ConfigError(problems);
  }

  const base: BaseConfig = {
    appSecret,
    databasePath,
    allowRegistration,
    publicOrigin,
    serveWeb,
    secureCookies,
    port,
    host,
    trustProxy,
    smtpUrl,
    mailFrom,
  };
  hide(base, 'appSecret');
  hide(base, 'smtpUrl');

  if (oidc === null) {
    return Object.assign(base, { authMode: 'local' as const, oidc: null });
  }
  hide(oidc, 'clientSecret');
  return Object.assign(base, { authMode: 'oidc' as const, oidc });
}
