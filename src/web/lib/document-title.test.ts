import { describe, expect, it } from 'vitest';
import { documentTitle } from './document-title';
import { parseRoute, type Route } from './route';

const ROUTES: Route[] = ['sync', 'settings', 'login', 'verify-email', 'notFound'];

describe('documentTitle', () => {
  it('names the route and the app', () => {
    expect(documentTitle('sync', 'en')).toBe('Sync Dashboard - Walley');
    expect(documentTitle('settings', 'en')).toBe('Settings - Walley');
    expect(documentTitle('sync', 'nl')).toBe('Synchronisatie - Walley');
    expect(documentTitle('notFound', 'en')).toBe('Page not found - Walley');
    expect(documentTitle('notFound', 'nl')).toBe('Pagina niet gevonden - Walley');
  });
  it('gives every route a distinct title in both languages', () => {
    for (const locale of ['en', 'nl'] as const) {
      const titles = ROUTES.map((r) => documentTitle(r, locale));
      expect(new Set(titles).size).toBe(ROUTES.length);
      for (const title of titles) expect(title).toMatch(/ - Walley$/);
    }
  });
  it('covers every route parseRoute can return', () => {
    for (const path of ['/', '/sync', '/matches', '/settings', '/login', '/verify-email', '/nope']) {
      expect(documentTitle(parseRoute(path), 'en')).not.toContain('routes.');
    }
  });
});
