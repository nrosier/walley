import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from 'cn';
import { useT } from '@/i18n';
import { settingsPageMessages } from '@/pages/SettingsPage.messages';
import { Button } from '../ui/button';
import { ScopePill, type Scope } from '../ui/scope-pill';

export interface SettingsCardProps {
  /** Anchor target for the section nav. */
  id: string;
  headingId: string;
  title: string;
  scope: Scope;
  children: ReactNode;
  /** Pinned at the bottom of the card. */
  footer?: ReactNode;
}

/** One settings section: a card with its heading and scope pill, a body, and an optional footer. */
export function SettingsCard({ id, headingId, title, scope, children, footer }: SettingsCardProps) {
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      tabIndex={-1}
      data-settings-card={scope}
      className="scroll-mt-16 rounded-lg border bg-card outline-none"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 id={headingId} className="text-sm font-semibold">{title}</h2>
        <ScopePill scope={scope} />
      </header>
      <div className="px-4 py-3">{children}</div>
      {footer === undefined ? null : <footer className="flex flex-wrap items-center gap-3 border-t px-4 py-2.5">{footer}</footer>}
    </section>
  );
}

export interface SaveFooterProps {
  /** `id` of the card's form; the Save button submits it from the footer. */
  formId: string;
  dirty: boolean;
  label: string;
  busy?: boolean;
  disabled?: boolean;
}

/** The one Save of an account card, with "Unsaved changes" / "No unsaved changes". */
export function SaveFooter({ formId, dirty, label, busy = false, disabled = false }: SaveFooterProps) {
  const { t } = useT(settingsPageMessages);
  return (
    <>
      <span data-dirty={dirty} className={cn('inline-flex items-center gap-1.5 text-xs', dirty ? 'text-warning' : 'text-muted')}>
        {dirty ? <AlertTriangle className="size-3.5" aria-hidden="true" /> : null}
        {dirty ? t('save.unsaved') : t('save.clean')}
      </span>
      <Button type="submit" form={formId} className="ml-auto min-h-(--control-h)" disabled={busy || disabled}>
        {label}
      </Button>
    </>
  );
}
