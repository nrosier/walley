import { useId } from 'react';
import { Globe } from 'lucide-react';
import { commonMessages } from './common.messages';
import { useLocale, useT } from './context';
import { LOCALES, parseLocale, type Locale } from './locale';

/** Native select with the shared field look (44px, same border, background and focus ring as the auth inputs). */
const SELECT_CLASS =
  'h-11 w-full rounded-md border border-input-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * Labelled language picker: a centred label above a native select (globe icon beside it). The choice is stored per
 * device (localStorage). Used on Settings and the login page.
 */
export function LanguageSelect({ className, onChange }: { className?: string; onChange?: (locale: Locale) => void }) {
  const { locale, setLocale } = useLocale();
  const { t } = useT(commonMessages);
  const labelId = useId();
  return (
    <div className={className ?? 'flex flex-col items-center gap-1.5 text-sm'}>
      <span id={labelId} className="text-center text-muted">
        {t('language.labelWithScope')}
      </span>
      <div className="relative w-full max-w-60">
        <Globe className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <select
          name="locale"
          aria-labelledby={labelId}
          value={locale}
          onChange={(e) => {
            const next = parseLocale(e.target.value);
            if (next !== null) {
              setLocale(next);
              onChange?.(next);
            }
          }}
          className={SELECT_CLASS}
        >
          {LOCALES.map((code) => (
            <option key={code} value={code} lang={code}>
              {t(`language.${code}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
