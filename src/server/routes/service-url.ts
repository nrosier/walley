const MAX_URL_LENGTH = 2000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Validates a user-supplied base URL for an outside service (Wallos, Actual Budget). Returns the
 * trimmed URL when it is https, or plain http on a loopback host only, with no credentials, query
 * or fragment. Anything else gives null.
 */
export function validateServiceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '' || value.length > MAX_URL_LENGTH || value.includes('?') || value.includes('#')) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username !== '' || url.password !== '') return null;
  if (url.protocol === 'https:') return value;
  if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return value;
  return null;
}
