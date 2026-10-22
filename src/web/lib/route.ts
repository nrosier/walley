import { useSyncExternalStore } from 'react';

export type Route = 'sync' | 'matches' | 'settings' | 'login' | 'verify-email';
export type TabRoute = 'sync' | 'matches' | 'settings';

export const TABS: readonly { route: TabRoute; path: string }[] = [
  { route: 'sync', path: '/sync' },
  { route: 'matches', path: '/matches' },
  { route: 'settings', path: '/settings' },
];

/** Maps a location pathname to a route. `/` and unknown paths go to the Sync Dashboard. */
export function parseRoute(pathname: string): Route {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  switch (clean) {
    case '/matches':
      return 'matches';
    case '/settings':
      return 'settings';
    case '/login':
      return 'login';
    case '/verify-email':
      return 'verify-email';
    default:
      return 'sync';
  }
}

/** Pushes a new history entry (path, optionally with query or hash) and tells subscribers. */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
  };
}

/** The route for the current location; re-renders on navigate() and back/forward. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => parseRoute(window.location.pathname), () => 'sync');
}
