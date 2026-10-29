import type { ReactNode } from 'react';
import { cn } from 'cn';
import { useT } from '@/i18n';
import { authCardMessages } from './AuthCard.messages';

/** Input class for the auth pages: 44px tall, the stronger input border, the shared focus ring. */
export const AUTH_INPUT =
  'h-11 w-full rounded-md border border-input-border bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** Primary button class for the auth pages (44px). */
export const AUTH_BUTTON =
  'inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50';

export interface AuthCardProps {
  /** Translated heading. */
  title: string;
  children: ReactNode;
  className?: string;
}

/**
 * Shared card for the pages outside the app shell (login, verify email): vertically centred on the screen,
 * with a "W" brand mark above the heading.
 */
export function AuthCard({ title, children, className }: AuthCardProps) {
  const { t } = useT(authCardMessages);
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center p-4">
      <div className={cn('w-full max-w-sm space-y-3 rounded-lg border bg-card p-6 shadow-overlay', className)}>
        <div className="flex flex-col items-center gap-2">
          <span
            aria-hidden="true"
            data-slot="brand-mark"
            className="flex size-12 items-center justify-center rounded-xl bg-primary text-2xl font-bold text-primary-foreground"
          >
            {t('brandMark')}
          </span>
          <h1 className="text-center text-lg font-semibold">{title}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}
