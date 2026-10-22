import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { HealthStatus } from '@/components/HealthStatus';
import { LoginPage } from '@/pages/LoginPage';
import { apiRequest } from '@/lib/api';
import { parseRoute, type Route } from '@/lib/route';
import { applyTheme, readTheme, toggleTheme, writeTheme, type Theme } from '@/lib/theme';

const TITLES: Record<Route, string> = {
  sync: 'Sync Dashboard',
  matches: 'Matches',
  settings: 'Settings',
  login: 'Sign in',
};

function Placeholder({ route }: { route: Route }) {
  return (
    <section>
      <h1 className="text-lg font-semibold">{TITLES[route]}</h1>
      <p className="text-sm text-muted-foreground">Content lands in a later milestone.</p>
      {route === 'sync' ? <HealthStatus /> : null}
    </section>
  );
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [theme, setTheme] = useState<Theme>(() => readTheme());

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(window.location.hash));
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const onToggleTheme = useCallback(() => {
    const next = toggleTheme(theme);
    writeTheme(next);
    setTheme(next);
  }, [theme]);

  const onLogout = useCallback(() => {
    void apiRequest('/api/auth/logout', { method: 'POST' })
      .catch(() => undefined)
      .finally(() => {
        window.location.hash = '#/login';
      });
  }, []);

  if (route === 'login') {
    return <LoginPage />;
  }

  return (
    <AppShell route={route} theme={theme} onRefresh={() => undefined} onToggleTheme={onToggleTheme} onLogout={onLogout}>
      <Placeholder route={route} />
    </AppShell>
  );
}
