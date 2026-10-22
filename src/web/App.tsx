import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useT } from '@/i18n';
import { apiRequest } from '@/lib/api';
import { navigate, useRoute, type Route } from '@/lib/route';
import { syncStore } from '@/lib/sync-check';
import { checkSession, type SessionUser } from '@/lib/session';
import { applyTheme, readTheme, toggleTheme, writeTheme, type Theme } from '@/lib/theme';
import { LoginPage } from '@/pages/LoginPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SyncDashboard } from '@/pages/SyncDashboard';
import { VerifyEmailPage } from '@/pages/VerifyEmailPage';
import { appMessages } from './App.messages';

type ShellRoute = Exclude<Route, 'login' | 'verify-email'>;
type Session = { status: 'checking' } | { status: 'error' } | { status: 'ready'; user: SessionUser };

function Placeholder({ route }: { route: 'matches' }) {
  const { t } = useT(appMessages);
  return (
    <section>
      <h1 className="text-lg font-semibold">{t(`${route}.title`)}</h1>
      <p className="text-sm text-muted-foreground">{t(`${route}.body`)}</p>
    </section>
  );
}

function Page({ route }: { route: ShellRoute }) {
  if (route === 'settings') return <SettingsPage />;
  if (route === 'sync') return <SyncDashboard />;
  return <Placeholder route={route} />;
}

/** Calls POST /api/auth/logout. Resolves true on success and false when the request failed. */
// eslint-disable-next-line react-refresh/only-export-components -- exported for tests with a fake fetch
export async function requestLogout(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST', fetchImpl });
    return true;
  } catch {
    return false;
  }
}

/** Signed-in area: checks GET /api/auth/me once, then renders the shell. A 401 goes to /login. */
function Shell({ route }: { route: ShellRoute }) {
  const { t } = useT(appMessages);
  const [session, setSession] = useState<Session>({ status: 'checking' });
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [pageKey, setPageKey] = useState(0);
  const [logoutFailed, setLogoutFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    checkSession({ search: window.location.search, navigate, signal: controller.signal })
      .then((user) => {
        if (user !== null) setSession({ status: 'ready', user });
      })
      .catch(() => {
        if (!controller.signal.aborted) setSession({ status: 'error' });
      });
    return () => {
      controller.abort();
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
    void requestLogout().then((ok) => {
      if (ok) {
        navigate('/login');
      } else {
        setLogoutFailed(true);
      }
    });
  }, []);

  const onRefresh = useCallback(() => {
    if (route === 'sync') {
      void syncStore.run();
    } else {
      setPageKey((k) => k + 1);
    }
  }, [route]);

  if (session.status === 'checking') {
    return <p className="p-3 text-sm text-muted-foreground">{t('checking')}</p>;
  }
  if (session.status === 'error') {
    return (
      <p role="alert" className="p-3 text-sm text-warning">
        {t('sessionFailed')}
      </p>
    );
  }
  return (
    <AppShell
      route={route}
      theme={theme}
      email={session.user.email}
      onRefresh={onRefresh}
      onToggleTheme={onToggleTheme}
      onLogout={onLogout}
    >
      {logoutFailed ? (
        <p role="alert" className="mb-3 text-sm text-warning">
          {t('logoutFailed')}
        </p>
      ) : null}
      <Page key={`${route}-${String(pageKey)}`} route={route} />
    </AppShell>
  );
}

export function App() {
  const route = useRoute();
  if (route === 'login') return <LoginPage />;
  if (route === 'verify-email') return <VerifyEmailPage />;
  return <Shell route={route} />;
}
