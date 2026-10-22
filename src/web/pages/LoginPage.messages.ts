/** Login page strings. Server error codes from API calls use errorText (common.messages.ts). Dutch uses formal "u". */
const en = {
  title: 'Sign in to Walley',
  registerTitle: 'Create account',
  email: 'Email',
  password: 'Password',
  signIn: 'Sign in',
  createAccount: 'Create account',
  sso: 'Sign in with SSO',
  showRegister: 'Create an account',
  backToSignIn: 'Back to sign in',
  registerSent: 'If this address can be registered, check your email for a confirmation link.',
  loading: 'Loading sign-in options...',
  configFailed: 'Could not load sign-in options. Reload the page to try again.',
  pageErrors: {
    account_not_linked:
      'Your sign-in worked, but no Walley account is linked to it. Ask the person who runs this Walley instance for access.',
    oidc_failed: 'Sign-in failed. Try again or contact the person who runs this Walley instance.',
  },
};

const nl: typeof en = {
  title: 'Inloggen bij Walley',
  registerTitle: 'Account aanmaken',
  email: 'E-mailadres',
  password: 'Wachtwoord',
  signIn: 'Inloggen',
  createAccount: 'Account aanmaken',
  sso: 'Inloggen met SSO',
  showRegister: 'Een account aanmaken',
  backToSignIn: 'Terug naar inloggen',
  registerSent: 'Als dit adres kan worden geregistreerd, ontvangt u een e-mail met een bevestigingslink.',
  loading: 'Inlogopties laden...',
  configFailed: 'De inlogopties konden niet worden geladen. Laad de pagina opnieuw om het nog eens te proberen.',
  pageErrors: {
    account_not_linked:
      'Uw aanmelding is gelukt, maar er is geen Walley-account aan gekoppeld. Vraag de beheerder van deze Walley-omgeving om toegang.',
    oidc_failed: 'Inloggen is mislukt. Probeer het opnieuw of neem contact op met de beheerder van deze Walley-omgeving.',
  },
};

export const loginPageMessages = { en, nl };
