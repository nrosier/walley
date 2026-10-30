import { useT } from '@/i18n';
import { Dialog } from '@/components/ui/dialog';
import { DialogShell } from '@/components/ui/dialog-shell';
import { appShellMessages } from './AppShell.messages';

export interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const REPOSITORY_URL = 'https://github.com/nrosier/walley';
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** About Walley: name, one-line description, version, copyright, MIT licence and the project link. */
export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const { t } = useT(appShellMessages);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogShell title={t('about.title')} description={t('about.description')}>
        <p className="font-mono text-sm text-muted-foreground">{t('about.version', { version: __APP_VERSION__ })}</p>
        <p className="mt-3 text-sm text-foreground">{t('about.copyright')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('about.license')}</p>
        <p className="mt-3 text-sm">
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`rounded-sm text-accent-text underline underline-offset-2 ${FOCUS}`}
          >
            {t('about.repository')}
          </a>
        </p>
      </DialogShell>
    </Dialog>
  );
}
