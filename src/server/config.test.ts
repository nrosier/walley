import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const SECRET = 'test-secret-value-that-is-long-enough-123456';
const CLIENT_SECRET = 'fake-oidc-client-secret-value-987654';

const base = { APP_SECRET: SECRET, DATABASE_PATH: './data/test.db' };
const oidcAll = {
  OIDC_ISSUER: 'https://idp.example.com',
  OIDC_CLIENT_ID: 'fake-client-id',
  OIDC_CLIENT_SECRET: CLIENT_SECRET,
  OIDC_CALLBACK_URL: 'https://walley.example.com/api/auth/oidc/callback',
};

function problemsOf(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error: unknown) {
    if (error instanceof ConfigError) {
      return error.problems;
    }
    throw error;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig defaults', () => {
  it('uses local mode and defaults when only required variables are set', () => {
    const config = loadConfig(base);
    expect(config.authMode).toBe('local');
    expect(config.oidc).toBeNull();
    expect(config.port).toBe(3000);
    expect(config.host).toBe('127.0.0.1');
    expect(config.allowRegistration).toBe(false);
    expect(config.databasePath).toBe('./data/test.db');
    expect(config.appSecret).toBe(SECRET);
  });
});

describe('OIDC', () => {
  it('uses oidc mode when all four variables are set', () => {
    const config = loadConfig({ ...base, ...oidcAll });
    expect(config.authMode).toBe('oidc');
    expect(config.oidc?.issuer).toBe(oidcAll.OIDC_ISSUER);
    expect(config.oidc?.clientId).toBe(oidcAll.OIDC_CLIENT_ID);
    expect(config.oidc?.clientSecret).toBe(CLIENT_SECRET);
    expect(config.oidc?.callbackUrl).toBe(oidcAll.OIDC_CALLBACK_URL);
  });

  for (const name of Object.keys(oidcAll)) {
    it(`names ${name} when it is the only one missing`, () => {
      const env: Record<string, string | undefined> = { ...base, ...oidcAll, [name]: undefined };
      expect(problemsOf(env)).toEqual([
        `OIDC is partly configured. Set all of OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and OIDC_CALLBACK_URL, or none of them. Missing: ${name}.`,
      ]);
    });
  }

  it('names exactly the missing variables when two are missing', () => {
    const problems = problemsOf({
      ...base,
      OIDC_ISSUER: oidcAll.OIDC_ISSUER,
      OIDC_CLIENT_ID: oidcAll.OIDC_CLIENT_ID,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Missing: OIDC_CLIENT_SECRET, OIDC_CALLBACK_URL\.$/);
  });

  it('counts an empty or whitespace-only variable as unset', () => {
    const empty = problemsOf({ ...base, ...oidcAll, OIDC_CLIENT_ID: '' });
    expect(empty[0]).toMatch(/Missing: OIDC_CLIENT_ID\.$/);
    const blank = problemsOf({ ...base, ...oidcAll, OIDC_CLIENT_ID: '   ' });
    expect(blank[0]).toMatch(/Missing: OIDC_CLIENT_ID\.$/);
  });

  it('stays in local mode when all four are empty strings', () => {
    const config = loadConfig({
      ...base,
      OIDC_ISSUER: '',
      OIDC_CLIENT_ID: '',
      OIDC_CLIENT_SECRET: '',
      OIDC_CALLBACK_URL: '',
    });
    expect(config.authMode).toBe('local');
    expect(config.oidc).toBeNull();
  });

  it('rejects an OIDC_ISSUER that is not a URL', () => {
    expect(problemsOf({ ...base, ...oidcAll, OIDC_ISSUER: 'not a url' })).toEqual([
      'OIDC_ISSUER must be an absolute URL',
    ]);
  });

  it('rejects a non-http OIDC_CALLBACK_URL', () => {
    expect(problemsOf({ ...base, ...oidcAll, OIDC_CALLBACK_URL: 'ftp://example.com/cb' })).toEqual([
      'OIDC_CALLBACK_URL must be an absolute URL',
    ]);
  });
});

describe('PORT', () => {
  for (const value of ['abc', '0', '65536', '3.5', '-1', ' 80']) {
    it(`rejects PORT=${JSON.stringify(value)}`, () => {
      expect(problemsOf({ ...base, PORT: value })).toEqual([
        'PORT must be an integer from 1 to 65535',
      ]);
    });
  }

  it('defaults to 3000 when unset or empty', () => {
    expect(loadConfig(base).port).toBe(3000);
    expect(loadConfig({ ...base, PORT: '' }).port).toBe(3000);
  });

  it('accepts the bounds', () => {
    expect(loadConfig({ ...base, PORT: '1' }).port).toBe(1);
    expect(loadConfig({ ...base, PORT: '65535' }).port).toBe(65535);
  });
});

describe('HOST and ALLOW_REGISTRATION', () => {
  it('trims HOST and falls back when blank', () => {
    expect(loadConfig({ ...base, HOST: ' 0.0.0.0 ' }).host).toBe('0.0.0.0');
    expect(loadConfig({ ...base, HOST: '  ' }).host).toBe('127.0.0.1');
  });

  it('parses ALLOW_REGISTRATION case-insensitively', () => {
    expect(loadConfig({ ...base, ALLOW_REGISTRATION: ' TRUE ' }).allowRegistration).toBe(true);
    expect(loadConfig({ ...base, ALLOW_REGISTRATION: 'false' }).allowRegistration).toBe(false);
    expect(loadConfig({ ...base, ALLOW_REGISTRATION: '' }).allowRegistration).toBe(false);
  });

  it('rejects other ALLOW_REGISTRATION values', () => {
    expect(problemsOf({ ...base, ALLOW_REGISTRATION: 'yes' })).toEqual([
      'ALLOW_REGISTRATION must be "true" or "false"',
    ]);
  });
});

describe('required variables', () => {
  it('rejects an APP_SECRET of 31 characters and accepts 32', () => {
    expect(problemsOf({ ...base, APP_SECRET: 'a'.repeat(31) })).toEqual([
      'APP_SECRET must be at least 32 characters',
    ]);
    expect(loadConfig({ ...base, APP_SECRET: 'a'.repeat(32) }).appSecret).toBe('a'.repeat(32));
  });

  it('measures and stores APP_SECRET untrimmed', () => {
    const padded = ` ${'a'.repeat(31)}`;
    expect(loadConfig({ ...base, APP_SECRET: padded }).appSecret).toBe(padded);
  });

  it('reports both APP_SECRET and DATABASE_PATH when missing', () => {
    try {
      loadConfig({});
      expect.unreachable();
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as ConfigError).message;
      expect(message).toBe(
        'Invalid configuration:\n  - APP_SECRET is required\n  - DATABASE_PATH is required\nSee .env.example.',
      );
    }
  });

  it('counts empty and whitespace-only values as missing', () => {
    expect(problemsOf({ APP_SECRET: '', DATABASE_PATH: '   ' })).toEqual([
      'APP_SECRET is required',
      'DATABASE_PATH is required',
    ]);
  });
});

describe('secret hygiene', () => {
  it('never puts a secret value in an error message', () => {
    const messages = [
      problemsOf({ ...base, APP_SECRET: 'short-secret-value' }),
      problemsOf({ ...base, OIDC_CLIENT_SECRET: CLIENT_SECRET, OIDC_ISSUER: 'https://idp.example.com' }),
      problemsOf({ ...base, ...oidcAll, OIDC_ISSUER: 'bad issuer value', PORT: 'zzz' }),
    ].flat();
    for (const message of messages) {
      expect(message).not.toContain('short-secret-value');
      expect(message).not.toContain(CLIENT_SECRET);
      expect(message).not.toContain('bad issuer value');
    }
  });

  it('keeps secrets out of JSON.stringify and util.inspect', () => {
    const config = loadConfig({ ...base, ...oidcAll });
    for (const text of [JSON.stringify(config), inspect(config, { depth: 5 })]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(CLIENT_SECRET);
    }
    expect(typeof config.appSecret).toBe('string');
  });
});
