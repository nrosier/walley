const en = {
  checking: 'Loading...',
  sessionFailed: 'Could not reach Walley. Reload the page to try again.',
  logoutFailed: 'Could not sign you out. Check your connection and try again.',
  sync: { title: 'Sync Dashboard', body: 'Content lands in a later milestone.' },
  matches: { title: 'Matches', body: 'Content lands in a later milestone.' },
  verifyEmail: { title: 'Verify your email' },
};

const nl: typeof en = {
  checking: 'Laden...',
  sessionFailed: 'Walley is niet bereikbaar. Laad de pagina opnieuw om het nog eens te proberen.',
  logoutFailed: 'Afmelden is niet gelukt. Controleer uw verbinding en probeer het opnieuw.',
  sync: { title: 'Synchronisatie', body: 'Inhoud volgt in een latere mijlpaal.' },
  matches: { title: 'Koppelingen', body: 'Inhoud volgt in een latere mijlpaal.' },
  verifyEmail: { title: 'Bevestig uw e-mailadres' },
};

export const appMessages = { en, nl };
