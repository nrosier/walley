/**
 * The single registry of every *.messages.ts catalogue. The parity test in i18n.test.ts reads it.
 * Adding a catalogue: import it and add one line below.
 */
import { commonMessages } from './common.messages';
import { appMessages } from '../App.messages';
import { appShellMessages } from '../components/AppShell.messages';
import { healthStatusMessages } from '../components/HealthStatus.messages';
import { accountSettingsMessages } from '../pages/AccountSettings.messages';
import { actualSettingsMessages } from '../pages/ActualSettings.messages';
import { matchingSettingsMessages } from '../pages/MatchingSettings.messages';
import { settingsPageMessages } from '../pages/SettingsPage.messages';
import { loginPageMessages } from '../pages/LoginPage.messages';
import { verifyEmailPageMessages } from '../pages/VerifyEmailPage.messages';
import { wallosSettingsMessages } from '../pages/WallosSettings.messages';
import type { Catalogue } from './translate';

export const catalogues: Readonly<Record<string, Catalogue<object>>> = {
  common: commonMessages,
  app: appMessages,
  appShell: appShellMessages,
  healthStatus: healthStatusMessages,
  settingsPage: settingsPageMessages,
  loginPage: loginPageMessages,
  verifyEmailPage: verifyEmailPageMessages,
  actualSettings: actualSettingsMessages,
  wallosSettings: wallosSettingsMessages,
  accountSettings: accountSettingsMessages,
  matchingSettings: matchingSettingsMessages,
};
