import { describe, expect, it } from 'vitest';
import { checkSession } from './session';

const respond = (status: number, body: unknown) => (() =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))) as typeof fetch;

describe('checkSession (App session gate)', () => {
  it('navigates to /login and keeps the query string on 401', async () => {
    const paths: string[] = [];
    const user = await checkSession({
      search: '?error=oidc_failed',
      navigate: (p) => paths.push(p),
      fetchImpl: respond(401, { error: 'unauthenticated' }),
    });
    expect(user).toBeNull();
    expect(paths).toEqual(['/login?error=oidc_failed']);
  });

  it('returns email and authMethod on success without navigating', async () => {
    const paths: string[] = [];
    const user = await checkSession({
      search: '',
      navigate: (p) => paths.push(p),
      fetchImpl: respond(200, { email: 'a@example.test', authMethod: 'oidc' }),
    });
    expect(user).toEqual({ email: 'a@example.test', authMethod: 'oidc' });
    expect(paths).toEqual([]);
  });

  it('rejects on other errors without navigating', async () => {
    const paths: string[] = [];
    await expect(
      checkSession({ search: '', navigate: (p) => paths.push(p), fetchImpl: respond(500, { error: 'internal_error' }) }),
    ).rejects.toMatchObject({ status: 500 });
    expect(paths).toEqual([]);
  });
});
