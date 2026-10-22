import type { MouseEvent, ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import { ChevronDown, LogOut, Moon, RefreshCw, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { navigate, TABS, type Route } from '@/lib/route';
import type { Theme } from '@/lib/theme';
import { appShellMessages } from './AppShell.messages';

export interface AppShellProps {
  route: Route;
  theme: Theme;
  email: string;
  onRefresh: () => void;
  onToggleTheme: () => void;
  onLogout: () => void;
  /** Opens the user menu on first render. For tests; the menu is otherwise closed. */
  menuDefaultOpen?: boolean;
  children?: ReactNode;
}

/** Plain left clicks go through the in-app router; modified clicks keep browser behaviour. */
function onTabClick(event: MouseEvent<HTMLAnchorElement>, path: string) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  event.preventDefault();
  navigate(path);
}

export function AppShell({ route, theme, email, onRefresh, onToggleTheme, onLogout, menuDefaultOpen, children }: AppShellProps) {
  const { t } = useT(appShellMessages);
  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-4 border-b bg-card px-3 py-1.5">
        <span className="text-xl font-bold text-accent-text">{t('title')}</span>
        <nav aria-label={t('nav.label')} className="flex flex-1 gap-1">
          {TABS.map((tab) => {
            const active = tab.route === route;
            return (
              <a
                key={tab.route}
                href={tab.path}
                onClick={(e) => {
                  onTabClick(e, tab.path);
                }}
                aria-current={active ? 'page' : undefined}
                className={
                  'rounded-md px-3 py-1.5 text-sm ' +
                  (active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')
                }
              >
                {t(`nav.${tab.route}`)}
              </a>
            );
          })}
        </nav>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onRefresh} aria-label={t('refresh')}>
            <RefreshCw />
            {t('refresh')}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <DropdownMenu.Root defaultOpen={menuDefaultOpen} modal={false}>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="sm" aria-label={t('userMenu', { email })}>
                <span className="max-w-48 truncate">{email}</span>
                <ChevronDown />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-40 rounded-md border bg-card p-1 text-sm shadow-md"
            >
              <DropdownMenu.Item
                onSelect={onLogout}
                className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <LogOut className="size-4" />
                {t('logout')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      </header>
      <main className="p-3">{children}</main>
    </div>
  );
}
