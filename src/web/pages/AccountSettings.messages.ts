const en = {
  heading: 'Account / Security',
  signedInAs: 'Signed in as {email}',
  loading: 'Loading account...',
  loadError: 'Could not load the account. Reload the page to try again.',
  sessionExpired: 'Your session has expired. Sign in again to see your account.',
  password: {
    current: 'Current password',
    next: 'New password',
    confirm: 'Confirm new password',
    submit: 'Change password',
    mismatch: 'The new passwords do not match.',
    changed: 'Password changed. Your other sessions were signed out.',
  },
  registration: {
    heading: 'New accounts (whole server)',
    help: 'Admins only. When on, people can create an account. This applies to everyone on this server and takes effect at once.',
    label: 'Allow new accounts',
    on: 'On',
    off: 'Off',
    saved: 'Saved. The change applies now.',
    loadError: 'Could not load the registration setting. Reload the page to try again.',
    ceilingOff: 'ALLOW_REGISTRATION is off in the server settings, so no one can register whatever this switch says.',
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
  sessionExpired: 'Je sessie is verlopen. Log opnieuw in om je account te zien.',
  password: {
    current: 'Huidig wachtwoord',
    next: 'Nieuw wachtwoord',
    confirm: 'Bevestig nieuw wachtwoord',
    submit: 'Wachtwoord wijzigen',
    mismatch: 'De nieuwe wachtwoorden komen niet overeen.',
    changed: 'Wachtwoord gewijzigd. Uw andere sessies zijn afgemeld.',
  },
  registration: {
    heading: 'Nieuwe accounts (hele server)',
    help: 'Alleen voor beheerders. Als dit aan staat, kunnen mensen een account maken. Dit geldt voor iedereen op deze server en gaat meteen in.',
    label: 'Nieuwe accounts toestaan',
    on: 'Aan',
    off: 'Uit',
    saved: 'Opgeslagen. De wijziging geldt nu.',
    loadError: 'De registratie-instelling kon niet worden geladen. Laad de pagina opnieuw om het nog eens te proberen.',
    ceilingOff: 'ALLOW_REGISTRATION staat uit in de serverinstellingen, dus niemand kan zich registreren, wat deze schakelaar ook zegt.',
  },
  oidcNote: 'Uw wachtwoord wordt beheerd door uw identity provider.',
  identities: {
    heading: 'Gekoppelde identiteiten',
    issuer: 'Uitgever:',
    subject: 'Onderwerp:',
  },
};

export const accountSettingsMessages = { en, nl };
