const en = {
  heading: 'Account / Security',
  signedInAs: 'Signed in as {email}',
  loading: 'Loading account...',
  loadError: 'Could not load the account. Reload the page to try again.',
  password: {
    current: 'Current password',
    next: 'New password',
    confirm: 'Confirm new password',
    submit: 'Change password',
    mismatch: 'The new passwords do not match.',
    changed: 'Password changed. Your other sessions were signed out.',
  },
  oidcNote: 'Your password is managed by your identity provider.',
  identities: {
    heading: 'Linked identities',
    issuer: 'Issuer:',
    subject: 'Subject:',
  },
};

const nl: typeof en = {
  heading: 'Account / Beveiliging',
  signedInAs: 'Aangemeld als {email}',
  loading: 'Account wordt geladen...',
  loadError: 'Het account kon niet worden geladen. Laad de pagina opnieuw om het nog eens te proberen.',
  password: {
    current: 'Huidig wachtwoord',
    next: 'Nieuw wachtwoord',
    confirm: 'Bevestig nieuw wachtwoord',
    submit: 'Wachtwoord wijzigen',
    mismatch: 'De nieuwe wachtwoorden komen niet overeen.',
    changed: 'Wachtwoord gewijzigd. Uw andere sessies zijn afgemeld.',
  },
  oidcNote: 'Uw wachtwoord wordt beheerd door uw identity provider.',
  identities: {
    heading: 'Gekoppelde identiteiten',
    issuer: 'Uitgever:',
    subject: 'Onderwerp:',
  },
};

export const accountSettingsMessages = { en, nl };
