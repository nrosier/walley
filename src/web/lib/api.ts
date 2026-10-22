export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_COOKIE = 'walley_csrf';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Reads the readable CSRF cookie from a cookie string. Returns '' when absent. */
export function readCsrfToken(cookieString: string): string {
  for (const part of cookieString.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CSRF_COOKIE) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return '';
      }
    }
  }
  return '';
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  fetchImpl?: typeof fetch;
  cookie?: string;
  signal?: AbortSignal;
}

/** Calls the Walley API with the CSRF header on unsafe methods. Returns parsed JSON (undefined for 204) or throws ApiError. */
export async function apiRequest<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = (opts.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET' && method !== 'HEAD') {
    const token = readCsrfToken(opts.cookie ?? (typeof document === 'undefined' ? '' : document.cookie));
    if (token !== '') {
      headers[CSRF_HEADER] = token;
    }
  }
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(path, { method, headers, body, credentials: 'same-origin', signal: opts.signal });
  if (!res.ok) {
    let code = 'request_failed';
    try {
      const data = (await res.json()) as { error?: unknown };
      if (typeof data.error === 'string') code = data.error;
    } catch {
      // keep the generic code
    }
    throw new ApiError(res.status, code);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}
