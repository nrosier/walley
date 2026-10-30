import { useSyncExternalStore, type MouseEvent } from 'react';

export type Route = 'sync' | 'settings' | 'login' | 'verify-email';
export type TabRoute = 'sync' | 'settings';

export const TABS: readonly { route: TabRoute; path: string }[] = [
  { route: 'sync', path: '/sync' },
  { route: 'settings', path: '/settings' },
];

/** Maps a location pathname to a route. `/` and unknown paths go to the Sync Dashboard. */
export function parseRoute(pathname: string): Route {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  switch (clean) {
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

/** Click handler for an in-app `<a href>`: plain left clicks use the router, modified clicks keep browser behaviour. */
export function followInApp(event: MouseEvent<HTMLAnchorElement>, path: string): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(path);
}
