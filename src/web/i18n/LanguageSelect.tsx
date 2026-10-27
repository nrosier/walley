import { commonMessages } from './common.messages';
import { useLocale, useT } from './context';
import { LOCALES, parseLocale, type Locale } from './locale';

/** Labelled language picker. The choice is stored per device (localStorage). */
export function LanguageSelect({ className, onChange }: { className?: string; onChange?: (locale: Locale) => void }) {
  const { locale, setLocale } = useLocale();
  const { t } = useT(commonMessages);
  return (
    <label className={className ?? 'block text-sm'}>
      <span className="mb-1 block text-muted">
        {t('language.label')} <span className="text-xs">({t('language.scope')})</span>
      </span>
      <select
        name="locale"
        value={locale}
        onChange={(e) => {
          const next = parseLocale(e.target.value);
          if (next !== null) {
            setLocale(next);
            onChange?.(next);
          }
        }}
        className="min-h-(--control-h) rounded-md border border-input-border bg-background px-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {t(`language.${code}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
