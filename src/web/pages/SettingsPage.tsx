import { LanguageSelect, useT } from '@/i18n';
import { AccountSettings } from './AccountSettings';
import { ActualSettings } from './ActualSettings';
import { MatchingSettings } from './MatchingSettings';
import { settingsPageMessages } from './SettingsPage.messages';
import { WallosSettings } from './WallosSettings';

/** Settings page: General, then the per-account sections, then Account / Security. */
export function SettingsPage() {
  const { t } = useT(settingsPageMessages);
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      <section aria-labelledby="settings-general-heading" className="space-y-2">
        <h2 id="settings-general-heading" className="text-sm font-semibold">
          {t('sections.general')}
        </h2>
        <LanguageSelect />
      </section>
      <div className="space-y-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('scope.yourAccount')}</p>
        <WallosSettings />
        <ActualSettings />
        <MatchingSettings />
      </div>
      <AccountSettings />
    </div>
  );
}
