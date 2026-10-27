import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { LanguageSelect, useT } from '@/i18n';
import { parseTheme } from '@/lib/theme';
import { useThemeControl } from '@/lib/theme-context';
import { AccountSettings } from './AccountSettings';
import { ActualSettings } from './ActualSettings';
import { MatchingSettings } from './MatchingSettings';
import { settingsPageMessages } from './SettingsPage.messages';
import { WallosSettings } from './WallosSettings';

const SECTIONS = [
  { id: 'settings-general', key: 'general' },
  { id: 'settings-wallos', key: 'wallos' },
  { id: 'settings-actual', key: 'actual' },
  { id: 'settings-matching', key: 'matching' },
  { id: 'settings-account', key: 'account' },
] as const;

function jumpTo(id: string) {
  const target = document.getElementById(id);
  if (target === null) return;
  target.scrollIntoView({ block: 'start' });
  target.focus({ preventScroll: true });
}

/** General (this device): language and theme. Both apply at once and say "Saved". */
function GeneralCard() {
  const { t } = useT(settingsPageMessages);
  const { theme, setTheme } = useThemeControl();
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const flash = () => {
    setSaved(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSaved(false);
    }, 4000);
  };
  return (
    <SettingsCard
      id="settings-general"
      headingId="settings-general-heading"
      title={t('sections.general')}
      scope="device"
      footer={
        <>
          <span role="status" aria-live="polite" className="inline-flex min-h-4 items-center gap-1.5 text-xs text-success">
            {saved ? (
              <>
                <Check className="size-3.5" aria-hidden="true" />
                {t('general.saved')}
              </>
            ) : null}
          </span>
          <span className="ml-auto text-xs text-muted">{t('general.instant')}</span>
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-6">
        <LanguageSelect onChange={flash} />
        <div className="grid gap-1 text-sm">
          <span id="settings-theme-label" className="text-muted">
            {t('theme.label')}
          </span>
          <SegmentedControl
            aria-label={t('theme.label')}
            value={theme}
            onValueChange={(value) => {
              setTheme(parseTheme(value));
              flash();
            }}
            options={[
              { value: 'dark', label: t('theme.dark') },
              { value: 'light', label: t('theme.light') },
            ]}
          />
        </div>
      </div>
    </SettingsCard>
  );
}

/** Settings page: a sticky section nav (a Select below 768px) beside the section cards. */
export function SettingsPage() {
  const { t } = useT(settingsPageMessages);
  const [current, setCurrent] = useState<string>(SECTIONS[0].id);
  const go = (id: string) => {
    setCurrent(id);
    jumpTo(id);
  };
  return (
    <div className="max-w-4xl">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      <p className="mb-4 text-sm text-muted">{t('intro')}</p>
      <div className="grid gap-4 md:grid-cols-[11rem_1fr]">
        <nav aria-label={t('nav.label')} className="hidden md:block">
          <ul className="sticky top-4 grid gap-1">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={current === s.id ? 'true' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    go(s.id);
                  }}
                  className="flex min-h-(--control-h) items-center rounded-md px-3 text-sm text-muted outline-none hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=true]:bg-hover aria-[current=true]:font-medium aria-[current=true]:text-foreground"
                >
                  {t(`sections.${s.key}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <label className="sticky top-0 z-10 grid gap-1 bg-background py-2 text-sm md:hidden">
          <span className="text-muted">{t('nav.select')}</span>
          <select
            value={current}
            onChange={(e) => {
              go(e.target.value);
            }}
            className="min-h-(--control-h) rounded-md border border-input-border bg-background px-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {SECTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {t(`sections.${s.key}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="grid min-w-0 gap-4">
          <GeneralCard />
          <WallosSettings />
          <ActualSettings />
          <MatchingSettings />
          <AccountSettings />
        </div>
      </div>
    </div>
  );
}
