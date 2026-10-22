import { commonMessages } from './common.messages';
import { useLocale, useT } from './context';
import { LOCALES, parseLocale } from './locale';

/** Labelled language picker. The choice is stored per device (localStorage). */
export function LanguageSelect({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const { t } = useT(commonMessages);
  return (
    <label className={className ?? 'block text-sm'}>
      <span className="mb-1 block text-muted-foreground">
        {t('language.label')} <span className="text-xs">({t('language.scope')})</span>
      </span>
      <select
        name="locale"
        value={locale}
        onChange={(e) => {
          const next = parseLocale(e.target.value);
          if (next !== null) setLocale(next);
        }}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm"
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
