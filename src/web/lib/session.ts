import { apiRequest, ApiError } from './api';

export interface SessionUser {
  email: string;
  authMethod: 'local' | 'oidc';
}

export interface CheckSessionOptions {
  /** Current query string, e.g. `?error=x`; kept when sending the user to /login. */
  search: string;
  navigate: (path: string) => void;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Calls GET /api/auth/me. Resolves with the user, or with null after navigating to /login
 * (query string kept) on 401. Other failures reject.
 */
export async function checkSession(opts: CheckSessionOptions): Promise<SessionUser | null> {
  try {
    return await apiRequest<SessionUser>('/api/auth/me', { fetchImpl: opts.fetchImpl, signal: opts.signal });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      opts.navigate('/login' + opts.search);
      return null;
    }
    throw err;
  }
}
