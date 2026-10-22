import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const SECRET = 'test-secret-value-that-is-long-enough-123456';
const CLIENT_SECRET = 'fake-oidc-client-secret-value-987654';

const base = {
  APP_SECRET: SECRET,
  DATABASE_PATH: './data/test.db',
  PUBLIC_ORIGIN: 'https://walley.example.com',
};
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
    expect(config.publicOrigin).toBe('https://walley.example.com');
  });
});

describe('PUBLIC_ORIGIN', () => {
  const REQUIRED = 'PUBLIC_ORIGIN is required';
  const INVALID =
    'PUBLIC_ORIGIN must be an absolute http or https origin with no path, query, fragment or credentials';
  const withoutOrigin = { APP_SECRET: base.APP_SECRET, DATABASE_PATH: base.DATABASE_PATH };

  it('accepts an https origin', () => {
    expect(loadConfig({ ...base, PUBLIC_ORIGIN: 'https://walley.example.com' }).publicOrigin).toBe(
      'https://walley.example.com',
    );
  });

  it('drops a lone trailing slash', () => {
    expect(loadConfig({ ...base, PUBLIC_ORIGIN: 'http://127.0.0.1:3000/' }).publicOrigin).toBe(
      'http://127.0.0.1:3000',
    );
  });

  it('is required in local mode', () => {
    expect(problemsOf(withoutOrigin)).toEqual([REQUIRED]);
  });

  it('is required in oidc mode', () => {
    expect(problemsOf({ ...withoutOrigin, ...oidcAll })).toEqual([REQUIRED]);
  });

  it('counts empty and whitespace-only values as unset', () => {
    expect(problemsOf({ ...base, PUBLIC_ORIGIN: '' })).toEqual([REQUIRED]);
    expect(problemsOf({ ...base, PUBLIC_ORIGIN: '   ' })).toEqual([REQUIRED]);
  });

  it.each([
    'https://walley.example.com/app',
    'ftp://x',
    'not a url',
    'https://walley.example.com?x=1',
    'https://walley.example.com/?x=1',
    'https://walley.example.com#frag',
    'https://walley.example.com/#',
    'https://user@walley.example.com',
    'https://user:pass@walley.example.com',
  ])('rejects PUBLIC_ORIGIN %j', (value) => {
    expect(problemsOf({ ...base, PUBLIC_ORIGIN: value })).toEqual([INVALID]);
  });

  it.each(['http://127.0.0.1:3000', 'http://localhost:3000', 'http://[::1]:3000'])(
    'accepts loopback http %j',
    (value) => {
      expect(loadConfig({ ...base, PUBLIC_ORIGIN: value }).publicOrigin).toBe(value);
    },
  );

  it.each(['http://walley.example.com', 'http://127.0.0.1.evil.com'])(
    'rejects non-loopback http %j',
    (value) => {
      const problems = problemsOf({ ...base, PUBLIC_ORIGIN: value });
      expect(problems).toEqual([
        'PUBLIC_ORIGIN must use https (http is allowed only for localhost, 127.0.0.1 or [::1])',
      ]);
      expect(problems.join('\n')).not.toContain(value);
    },
  );

  it.each(['https://walley.example.com.', 'http://localhost.'])(
    'rejects a trailing dot in %j',
    (value) => {
      const problems = problemsOf({ ...base, PUBLIC_ORIGIN: value });
      expect(problems).toEqual(['PUBLIC_ORIGIN host must not end with a dot']);
      expect(problems.join('\n')).not.toContain(value);
    },
  );

  it('does not print the bad value', () => {
    const bad = 'https://secret-user:secret-pass@walley.example.com/secret-path';
    const text = problemsOf({ ...base, PUBLIC_ORIGIN: bad }).join('\n');
    expect(text).not.toContain(bad);
    expect(text).not.toContain('secret-pass');
    expect(text).not.toContain('secret-path');
  });

  it('does not also report a callback origin error when it is invalid', () => {
    expect(problemsOf({ ...base, ...oidcAll, PUBLIC_ORIGIN: 'ftp://x' })).toEqual([INVALID]);
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

describe('OIDC_ISSUER scheme', () => {
  const MESSAGE =
    'OIDC_ISSUER must use https (http is allowed only for localhost, 127.0.0.1 or [::1])';

  it.each([
    'https://idp.example.com',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://[::1]:8080',
  ])('accepts %j', (value) => {
    expect(loadConfig({ ...base, ...oidcAll, OIDC_ISSUER: value }).oidc?.issuer).toBe(value);
  });

  it.each(['http://idp.example.com', 'http://localhost.evil.com'])('rejects %j', (value) => {
    expect(problemsOf({ ...base, ...oidcAll, OIDC_ISSUER: value })).toEqual([MESSAGE]);
  });
});

describe('OIDC_ISSUER credentials, query and fragment', () => {
  it.each([
    'https://idp.example.com\u3002evil.com',
    'https://idp.example\u200b.com',
    'https://b\u00fccher.example',
    'https://idp.example.com\u{1F600}.evil.com',
  ])('rejects non-ASCII issuer %j', (value) => {
    const problems = problemsOf({ ...base, ...oidcAll, OIDC_ISSUER: value });
    expect(problems).toEqual([
      'OIDC_ISSUER must use ASCII only (write an internationalised host in punycode)',
    ]);
    expect(problems.join('\n')).not.toContain(value);
  });

  it('accepts a punycode host and stores the raw string', () => {
    const value = 'https://xn--bcher-kva.example';
    expect(loadConfig({ ...base, ...oidcAll, OIDC_ISSUER: value }).oidc?.issuer).toBe(value);
  });

  it('accepts an at sign in the path with a trailing slash', () => {
    const value = 'https://idp.example.com/tenant@x/';
    expect(loadConfig({ ...base, ...oidcAll, OIDC_ISSUER: value }).oidc?.issuer).toBe(value);
  });

  it.each([
    'https:@idp.example.com',
    'https:/@idp.example.com',
    'https:\\@idp.example.com',
    'https:/\t/@idp.example.com',
  ])('rejects an issuer without a clean scheme separator %j', (value) => {
    const problems = problemsOf({ ...base, ...oidcAll, OIDC_ISSUER: value });
    expect(problems).toEqual(['OIDC_ISSUER must be an absolute URL']);
    expect(problems.join('\n')).not.toContain(value);
  });

  it('accepts an at sign in the path and stores the raw string', () => {
    const value = 'https://idp.example.com/tenant@x';
    expect(loadConfig({ ...base, ...oidcAll, OIDC_ISSUER: value }).oidc?.issuer).toBe(value);
  });

  it.each([
    'https://svc:pw@idp.example.com',
    'https://idp.example.com?x=1',
    'https://idp.example.com#f',
    'https://idp.example.com?',
    'https://idp.example.com#',
    'https://@idp.example.com',
  ])('rejects %j', (value) => {
    const problems = problemsOf({ ...base, ...oidcAll, OIDC_ISSUER: value });
    expect(problems).toEqual(['OIDC_ISSUER must not contain credentials, a query or a fragment']);
    expect(problems.join('\n')).not.toContain(value);
  });
});

describe('OIDC_CALLBACK_URL checks', () => {
  const CALLBACK = 'https://walley.example.com/api/auth/oidc/callback';

  it.each([
    'https://u:p@walley.example.com/api/auth/oidc/callback',
    `${CALLBACK}?x=1`,
    `${CALLBACK}#f`,
    `${CALLBACK}?`,
    `${CALLBACK}#`,
    'https://@walley.example.com/api/auth/oidc/callback',
  ])('rejects credentials, a query or a fragment in %j', (value) => {
    const problems = problemsOf({ ...base, ...oidcAll, OIDC_CALLBACK_URL: value });
    expect(problems).toEqual([
      'OIDC_CALLBACK_URL must not contain credentials, a query or a fragment',
    ]);
    expect(problems.join('\n')).not.toContain(value);
  });

  it('stores the normalised href', () => {
    const config = loadConfig({
      ...base,
      ...oidcAll,
      OIDC_CALLBACK_URL: 'HTTPS://WALLEY.EXAMPLE.COM:443/api/auth/oidc/callback',
    });
    expect(config.oidc?.callbackUrl).toBe(CALLBACK);
  });

  it('rejects a path other than /api/auth/oidc/callback', () => {
    expect(
      problemsOf({
        ...base,
        ...oidcAll,
        OIDC_CALLBACK_URL: 'https://walley.example.com/auth/callback',
      }),
    ).toEqual(['OIDC_CALLBACK_URL path must be /api/auth/oidc/callback']);
  });

  it('rejects a trailing slash', () => {
    expect(
      problemsOf({
        ...base,
        ...oidcAll,
        OIDC_CALLBACK_URL: 'https://walley.example.com/api/auth/oidc/callback/',
      }),
    ).toEqual(['OIDC_CALLBACK_URL path must be /api/auth/oidc/callback']);
  });

  it('rejects an origin that differs from PUBLIC_ORIGIN', () => {
    expect(
      problemsOf({
        ...base,
        ...oidcAll,
        OIDC_CALLBACK_URL: 'https://other.example.com/api/auth/oidc/callback',
      }),
    ).toEqual(['OIDC_CALLBACK_URL origin must match PUBLIC_ORIGIN']);
  });

  it('accepts a matching origin when PUBLIC_ORIGIN has a trailing slash', () => {
    expect(
      loadConfig({ ...base, ...oidcAll, PUBLIC_ORIGIN: 'https://walley.example.com/' }).oidc
        ?.callbackUrl,
    ).toBe(oidcAll.OIDC_CALLBACK_URL);
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

  it('reports APP_SECRET, DATABASE_PATH and PUBLIC_ORIGIN when missing', () => {
    try {
      loadConfig({});
      expect.unreachable();
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as ConfigError).message;
      expect(message).toBe(
        'Invalid configuration:\n  - APP_SECRET is required\n  - DATABASE_PATH is required\n  - PUBLIC_ORIGIN is required\nSee .env.example.',
      );
    }
  });

  it('counts empty and whitespace-only values as missing', () => {
    expect(problemsOf({ APP_SECRET: '', DATABASE_PATH: '   ', PUBLIC_ORIGIN: ' ' })).toEqual([
      'APP_SECRET is required',
      'DATABASE_PATH is required',
      'PUBLIC_ORIGIN is required',
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

describe('loadConfig serveWeb', () => {
  it('is true only for NODE_ENV exactly production', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).serveWeb).toBe(true);
  });

  it.each([undefined, 'development', 'test', 'Production', 'production ', ''])(
    'is false for NODE_ENV %j',
    (value) => {
      expect(loadConfig({ ...base, NODE_ENV: value }).serveWeb).toBe(false);
    },
  );
});

describe('loadConfig secureCookies', () => {
  const localHttp = { ...base, PUBLIC_ORIGIN: 'http://localhost:3000' };

  it('is true for NODE_ENV exactly production', () => {
    expect(loadConfig({ ...localHttp, NODE_ENV: 'production' }).secureCookies).toBe(true);
  });

  it.each([undefined, 'development', 'test', 'Production', 'production ', ''])(
    'is false for NODE_ENV %j with an http localhost origin',
    (value) => {
      expect(loadConfig({ ...localHttp, NODE_ENV: value }).secureCookies).toBe(false);
    },
  );

  it.each([undefined, 'development', 'test', ''])(
    'is true for NODE_ENV %j with an https origin',
    (value) => {
      expect(loadConfig({ ...base, NODE_ENV: value }).secureCookies).toBe(true);
    },
  );
});

describe('TRUST_PROXY', () => {
  const MESSAGE = 'TRUST_PROXY must be a comma-separated list of IP addresses or CIDR ranges';

  it.each([undefined, '', '   '])('is false when %j', (value) => {
    expect(loadConfig({ ...base, TRUST_PROXY: value }).trustProxy).toBe(false);
  });

  it('accepts a single address', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '127.0.0.1' }).trustProxy).toEqual(['127.0.0.1']);
  });

  it('accepts a trimmed list of CIDR ranges and addresses', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8, ::1' }).trustProxy).toEqual([
      '10.0.0.0/8',
      '::1',
    ]);
  });

  it.each(['0.0.0.0/0', '::/0'])('rejects the prefix-0 range %j without echoing it', (value) => {
    const problems = problemsOf({ ...base, TRUST_PROXY: value });
    expect(problems).toEqual([MESSAGE]);
    expect(problems[0]).not.toContain(value);
  });

  it.each(['10.0.0.0/7', '0.0.0.0/1', '::/31', '::ffff:0:0/96', 'fe80::1%eth0', '10.0.0.1/8', '2001:db8::1/32', '::/32'])(
    'rejects the unsafe entry %j without echoing it',
    (value) => {
      const problems = problemsOf({ ...base, TRUST_PROXY: value });
      expect(problems).toEqual([MESSAGE]);
      expect(problems[0]).not.toContain(value);
    },
  );

  it.each(['10.0.0.0/8', '10.0.0.0/32', '192.168.0.0/16', '2001:db8::/32', '::1', '127.0.0.1'])(
    'accepts %j',
    (value) => {
      expect(loadConfig({ ...base, TRUST_PROXY: value }).trustProxy).toEqual([value]);
    },
  );

  it('rejects an IPv4-mapped range written with a /104 prefix without echoing it', () => {
    const value = '::ffff:10.0.0.0/104';
    const problems = problemsOf({ ...base, TRUST_PROXY: value });
    expect(problems).toEqual([MESSAGE]);
    expect(problems[0]).not.toContain(value);
  });

  it('keeps a leading-zero prefix unchanged', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/08' }).trustProxy).toEqual(['10.0.0.0/08']);
  });

  it('drops an empty entry after a trailing comma', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8,' }).trustProxy).toEqual(['10.0.0.0/8']);
  });

  it('trims a trailing space', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8 ' }).trustProxy).toEqual(['10.0.0.0/8']);
  });

  it.each(['10.0.0.0/33', 'not-an-ip', '10.0.0.1, bad-entry-value', '::1/129', ' , '])(
    'rejects %j without echoing it',
    (value) => {
      const problems = problemsOf({ ...base, TRUST_PROXY: value });
      expect(problems).toEqual([MESSAGE]);
      for (const entry of value.split(',').map((part) => part.trim())) {
        if (entry !== '' && entry !== '10.0.0.1') {
          expect(problems[0]).not.toContain(entry);
        }
      }
    },
  );
});
