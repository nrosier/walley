import { describe, expect, it } from 'vitest';
import { parseRoute, type Route } from './route';

const table: [string, Route][] = [
  ['/', 'sync'],
  ['', 'sync'],
  ['/sync', 'sync'],
  ['/matches', 'matches'],
  ['/matches/', 'matches'],
  ['/settings', 'settings'],
  ['/login', 'login'],
  ['/verify-email', 'verify-email'],
  ['/nope', 'sync'],
  ['/settings/extra', 'sync'],
  ['#/matches', 'sync'],
];

describe('parseRoute', () => {
  it.each(table)('%s -> %s', (path, route) => {
    expect(parseRoute(path)).toBe(route);
  });
});
