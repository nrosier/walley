import type { ReactNode } from 'react';
import { LogOut, Moon, RefreshCw, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TABS, type Route } from '@/lib/route';
import type { Theme } from '@/lib/theme';

export interface AppShellProps {
  route: Route;
  theme: Theme;
  onRefresh: () => void;
  onToggleTheme: () => void;
  onLogout: () => void;
  children?: ReactNode;
}

export function AppShell({ route, theme, onRefresh, onToggleTheme, onLogout, children }: AppShellProps) {
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-4 border-b bg-card px-3 py-1.5">
        <span className="text-base font-bold text-primary">Walley</span>
        <nav aria-label="Main" className="flex flex-1 gap-1">
          {TABS.map((tab) => {
            const active = tab.route === route;
            return (
              <a
                key={tab.route}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={
                  'rounded-md px-3 py-1.5 text-sm ' +
                  (active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')
                }
              >
                {tab.label}
              </a>
            );
          })}
        </nav>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onRefresh} aria-label="Refresh">
            <RefreshCw />
            Refresh
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onToggleTheme} aria-label={`Switch to ${next} theme`}>
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} aria-label="Log out">
            <LogOut />
            Log out
          </Button>
        </div>
      </header>
      <main className="p-3">{children}</main>
    </div>
  );
}
