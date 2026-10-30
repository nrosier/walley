import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { followInApp } from '@/lib/route';
import { notFoundMessages } from './NotFound.messages';

/** Shown inside the app shell for a path Walley does not have. */
export function NotFound() {
  const { t } = useT(notFoundMessages);
  return (
    <section aria-labelledby="not-found-title" className="mx-auto max-w-lg py-8 text-center">
      <h1 id="not-found-title" className="mb-2 text-lg font-semibold">
        {t('title')}
      </h1>
      <p className="mb-4 text-sm text-muted-foreground">{t('message')}</p>
      <Button asChild>
        <a href="/sync" onClick={(e) => { followInApp(e, '/sync'); }}>
          {t('toSync')}
        </a>
      </Button>
    </section>
  );
}
