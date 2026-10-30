import { useState, type MouseEvent, type ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import { ArrowLeftRight, ChevronDown, LogOut, Moon, RefreshCw, Settings, Sun, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { navigate, TABS, type Route, type TabRoute } from '@/lib/route';
import type { Theme } from '@/lib/theme';
import { AboutDialog } from './AboutDialog';
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

const TAB_ICONS: Record<TabRoute, LucideIcon> = { sync: ArrowLeftRight, settings: Settings };

/** 44px tap targets on narrow or coarse-pointer screens (--control-h), 32px otherwise. */
const TARGET = 'min-h-(--control-h)';
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

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
  const [aboutOpen, setAboutOpen] = useState(false);
  return (
    <div className="min-h-screen">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className={`sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground ${FOCUS}`}
      >
        {t('skipLink')}
      </a>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-card px-3 py-1.5">
        <a
          href="/sync"
          aria-label={t('homeLink')}
          onClick={(e) => {
            onTabClick(e, '/sync');
          }}
          className={`inline-flex items-center rounded-md text-xl font-bold text-accent-text ${TARGET} ${FOCUS}`}
        >
          {t('title')}
        </a>
        <nav aria-label={t('nav.label')} className="order-last flex w-full gap-1 md:order-none md:w-auto md:flex-1">
          {TABS.map((tab) => {
            const active = tab.route === route;
            const Icon = TAB_ICONS[tab.route];
            return (
              <a
                key={tab.route}
                href={tab.path}
                onClick={(e) => {
                  onTabClick(e, tab.path);
                }}
                aria-current={active ? 'page' : undefined}
                className={
                  `inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm md:flex-none ${TARGET} ${FOCUS} ` +
                  (active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')
                }
              >
                <Icon className="size-4 md:hidden" aria-hidden="true" />
                <span className="sr-only md:not-sr-only">{t(`nav.${tab.route}`)}</span>
              </a>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <Button variant="ghost" size="sm" className={`h-auto ${TARGET} min-w-(--control-h)`} onClick={onRefresh} aria-label={t('refresh')}>
            <RefreshCw />
            <span className="hidden md:inline">{t('refresh')}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className={`h-auto ${TARGET} min-w-(--control-h)`}
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <DropdownMenu.Root defaultOpen={menuDefaultOpen} modal={false}>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="sm" className={`h-auto ${TARGET} min-w-(--control-h)`} aria-label={t('userMenu', { email })}>
                <span className="hidden max-w-48 truncate md:inline">{email}</span>
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
      <main id="main" tabIndex={-1} className="p-3 outline-none">{children}</main>
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-card px-3 py-1.5 text-xs text-muted">
        <span>{t('footer.text', { version: __APP_VERSION__ })}</span>
        <Button
          variant="ghost"
          size="sm"
          className={`ml-auto h-auto ${TARGET} text-xs text-muted hover:text-foreground`}
          onClick={() => {
            setAboutOpen(true);
          }}
        >
          {t('footer.about')}
        </Button>
      </footer>
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </div>
  );
}
