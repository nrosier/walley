/**
 * Safety guard of the test-data seed script (scripts/seed-test-data.ts). The seed writes to a
 * Wallos and an Actual Budget instance, so it must only ever run against the throwaway test
 * containers from test/docker-compose.test.yml. This module has no I/O and no side effects, so a
 * test can import it. The error messages never contain a URL, because a URL can hold credentials.
 */

/** The only origins the seed may talk to. One place to change; everything else is refused. */
export const TEST_INSTANCE_ALLOWLIST = {
  wallos: ['http://localhost:8282', 'http://127.0.0.1:8282'],
  actual: ['http://localhost:5006', 'http://127.0.0.1:5006'],
} as const;

export type TestInstanceName = keyof typeof TEST_INSTANCE_ALLOWLIST;

export class SeedGuardError extends Error {
  readonly instance: TestInstanceName;
  constructor(instance: TestInstanceName) {
    super(
      `The ${instance === 'wallos' ? 'Wallos' : 'Actual Budget'} URL is not an allowed test container ` +
        `(allowed: ${TEST_INSTANCE_ALLOWLIST[instance].join(', ')}). Nothing was requested.`,
    );
    this.name = 'SeedGuardError';
    this.instance = instance;
  }
}

/** True only for a bare allowed origin: no credentials, path, query or fragment. */
export function isAllowedTestUrl(instance: TestInstanceName, value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return false;
  if (url.pathname !== '/') return false;
  const allowed: readonly string[] = TEST_INSTANCE_ALLOWLIST[instance];
  return allowed.includes(url.origin);
}

/**
 * Throws SeedGuardError unless both URLs are allowed test instances. Call it before any request.
 * Returns the normalised origins (no trailing slash) for the caller to use.
 */
export function assertTestInstances(urls: { wallosUrl: string; actualUrl: string }): {
  wallosOrigin: string;
  actualOrigin: string;
} {
  if (!isAllowedTestUrl('wallos', urls.wallosUrl)) throw new SeedGuardError('wallos');
  if (!isAllowedTestUrl('actual', urls.actualUrl)) throw new SeedGuardError('actual');
  return {
    wallosOrigin: new URL(urls.wallosUrl.trim()).origin,
    actualOrigin: new URL(urls.actualUrl.trim()).origin,
  };
}
