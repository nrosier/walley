const en = {
  checking: 'Loading...',
  sessionFailed: 'Could not reach Walley. Reload the page to try again.',
  logoutFailed: 'Could not sign you out. Check your connection and try again.',
  verifyEmail: { title: 'Verify your email' },
  documentTitle: '{page} - Walley',
  routes: { sync: 'Sync Dashboard', matches: 'Matches', settings: 'Settings', login: 'Sign in', verifyEmail: 'Verify your email' },
};

const nl: typeof en = {
  checking: 'Laden...',
  sessionFailed: 'Walley is niet bereikbaar. Laad de pagina opnieuw om het nog eens te proberen.',
  logoutFailed: 'Afmelden is niet gelukt. Controleer uw verbinding en probeer het opnieuw.',
  verifyEmail: { title: 'Bevestig uw e-mailadres' },
  documentTitle: '{page} - Walley',
  routes: { sync: 'Synchronisatie', matches: 'Koppelingen', settings: 'Instellingen', login: 'Inloggen', verifyEmail: 'Bevestig uw e-mailadres' },
};

export const appMessages = { en, nl };
