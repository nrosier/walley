import { useId } from 'react';
import { Select } from 'radix-ui';
import { Check, ChevronDown, Globe } from 'lucide-react';
import { commonMessages } from './common.messages';
import { useLocale, useT } from './context';
import { LOCALES, parseLocale, type Locale } from './locale';

/** Same look as the shared 44px input (AUTH_INPUT); not imported, because AuthCard imports this module's barrel. */
const TRIGGER_CLASS =
  'inline-flex h-11 w-full max-w-60 items-center justify-between gap-2 rounded-md border border-input-border bg-background px-3 text-left text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * Labelled language picker: a centred label above a custom dropdown (globe icon, current language, chevron) built on
 * the Radix Select. The choice is stored per device (localStorage). Used on Settings and the login page.
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
      <Select.Root
        name="locale"
        value={locale}
        onValueChange={(value) => {
          const next = parseLocale(value);
          if (next !== null) {
            setLocale(next);
            onChange?.(next);
          }
        }}
      >
        <Select.Trigger
          aria-labelledby={labelId}
          className={TRIGGER_CLASS}
        >
          <Globe className="size-4 shrink-0 text-muted" aria-hidden="true" />
          <span className="flex-1 truncate">
            <Select.Value>{t(`language.${locale}`)}</Select.Value>
          </span>
          <Select.Icon asChild>
            <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden="true" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={4}
            className="z-50 min-w-(--radix-select-trigger-width) rounded-md border bg-card p-1 text-sm shadow-overlay"
          >
            <Select.Viewport>
              {LOCALES.map((code) => (
                <Select.Item
                  key={code}
                  value={code}
                  lang={code}
                  className="flex min-h-(--control-h) cursor-default items-center justify-between gap-2 rounded-sm px-2 py-1.5 outline-none data-[highlighted]:bg-hover"
                >
                  <Select.ItemText>{t(`language.${code}`)}</Select.ItemText>
                  <Select.ItemIndicator>
                    <Check className="size-4" aria-hidden="true" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
