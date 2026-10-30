import { describe, expect, it } from 'vitest';
import { parseRoute, type Route } from './route';

const table: [string, Route][] = [
  ['/', 'sync'],
  ['', 'sync'],
  ['/sync', 'sync'],
  ['/matches', 'notFound'],
  ['/matches/', 'notFound'],
  ['/settings', 'settings'],
  ['/login', 'login'],
  ['/verify-email', 'verify-email'],
  ['/nope', 'notFound'],
  ['/settings/extra', 'notFound'],
  ['#/matches', 'notFound'],
  ['/sync/', 'sync'],
];

describe('parseRoute', () => {
  it.each(table)('%s -> %s', (path, route) => {
    expect(parseRoute(path)).toBe(route);
  });
});

describe('parseRoute root', () => {
  it('sends the root path and the empty path to the Sync Dashboard, not notFound', () => {
    expect(parseRoute('/')).toBe('sync');
    expect(parseRoute('')).toBe('sync');
  });
});
