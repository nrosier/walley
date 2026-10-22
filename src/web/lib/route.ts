export type Route = 'sync' | 'matches' | 'settings' | 'login';

export const TABS: readonly { route: Exclude<Route, 'login'>; label: string; href: string }[] = [
  { route: 'sync', label: 'Sync Dashboard', href: '#/sync' },
  { route: 'matches', label: 'Matches', href: '#/matches' },
  { route: 'settings', label: 'Settings', href: '#/settings' },
];

/** Maps a location hash to a route. Unknown hashes go to the Sync Dashboard. */
export function parseRoute(hash: string): Route {
  switch (hash.replace(/^#\/?/, '')) {
    case 'matches':
      return 'matches';
    case 'settings':
      return 'settings';
    case 'login':
      return 'login';
    default:
      return 'sync';
  }
}
