import { cn } from 'cn';
import { useT } from '@/i18n';
import { controlsMessages } from './controls.messages';

export type Scope = 'account' | 'device';

/** Small label that says what a settings card is saved against: the account (server) or this device (browser). */
export function ScopePill({ scope, className }: { scope: Scope; className?: string }) {
  const { t } = useT(controlsMessages);
  return (
    <span
      data-slot="scope-pill"
      data-scope={scope}
      className={cn('inline-flex items-center rounded-full border bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted', className)}
    >
      {t(`scope.${scope}`)}
    </span>
  );
}
