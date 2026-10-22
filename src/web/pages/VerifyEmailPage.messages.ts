/** Verify-email page strings. Other server error codes use errorText (common.messages.ts). Dutch uses formal "u". */
const en = {
  title: 'Verify your email',
  verifying: 'Confirming your email address...',
  success: 'Your email address is confirmed. You can now sign in.',
  signIn: 'Go to sign in',
  invalid:
    'This link is invalid or has expired. Links expire 24 hours after they are sent. Register again to get a new link.',
  disabled: 'Password sign-in is turned off on this server, so there is nothing to confirm. Use Sign in with SSO.',
  missing: 'This link is incomplete. Open the link from the email again, or register again to get a new one.',
};

const nl: typeof en = {
  title: 'Bevestig uw e-mailadres',
  verifying: 'Uw e-mailadres wordt bevestigd...',
  success: 'Uw e-mailadres is bevestigd. U kunt nu inloggen.',
  signIn: 'Naar inloggen',
  invalid:
    'Deze link is ongeldig of verlopen. Links verlopen 24 uur nadat ze zijn verstuurd. Registreer opnieuw om een nieuwe link te ontvangen.',
  disabled:
    'Inloggen met wachtwoord is uitgeschakeld op deze server, dus er valt niets te bevestigen. Gebruik Inloggen met SSO.',
  missing:
    'Deze link is onvolledig. Open de link uit de e-mail opnieuw, of registreer opnieuw om een nieuwe link te ontvangen.',
};

export const verifyEmailPageMessages = { en, nl };
