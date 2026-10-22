import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, readCsrfToken } from './api';

describe('apiRequest', () => {
  it('sends the CSRF header from the cookie, never in the URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await apiRequest('/api/auth/logout', {
      method: 'POST',
      cookie: 'a=b; walley_csrf=tok123; walley_session=zzz',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/logout');
    expect(url).not.toContain('tok123');
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('tok123');
    expect(JSON.stringify(init.headers)).not.toContain('zzz');
  });
  it('omits the header on GET and parses JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ ok: 1 }));
    const out = await apiRequest('/api/x', { cookie: 'walley_csrf=t', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toEqual({ ok: 1 });
    expect((fetchImpl.mock.calls[0] as [string, RequestInit])[1].headers).not.toHaveProperty('x-csrf-token');
  });
  it('throws a typed error with the server code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ error: 'csrf_failed' }, { status: 403 }));
    await expect(
      apiRequest('/api/x', { method: 'POST', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ status: 403, code: 'csrf_failed' });
    expect(new ApiError(500, 'x')).toBeInstanceOf(Error);
  });
  it('reads the cookie value', () => {
    expect(readCsrfToken('')).toBe('');
    expect(readCsrfToken('walley_csrf=a%20b')).toBe('a b');
  });
});
