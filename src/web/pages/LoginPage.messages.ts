/** Login page strings. Server error codes from API calls use errorText (common.messages.ts). Dutch uses formal "u". */
const en = {
  title: 'Sign in to Walley',
  registerTitle: 'Create account',
  email: 'Email',
  password: 'Password',
  confirmPassword: 'Confirm password',
  signIn: 'Sign in',
  signingIn: 'Signing in...',
  creatingAccount: 'Creating account...',
  createAccount: 'Create account',
  sso: 'Sign in with SSO',
  showRegister: 'Create an account',
  backToSignIn: 'Back to sign in',
  registerSent: 'If this address can be registered, check your email for a confirmation link.',
  loading: 'Loading sign-in options...',
  configFailed: 'Could not load sign-in options. Reload the page to try again.',
  registerErrors: {
    email_invalid: 'Enter a valid email address.',
    password_too_short: 'The password is too short. Use at least {min} characters.',
    password_too_long: 'The password is too long. Use at most {max} characters.',
    password_mismatch: 'The passwords do not match.',
    invalid_request: 'Check your email address and password. The password must be {min} to {max} characters.',
    registration_disabled: 'Registration is turned off on this server.',
    rate_limited: 'Too many attempts. Wait a moment and try again.',
    local_auth_disabled: 'Password sign-in is turned off. Use Sign in with SSO.',
    internal: 'Something went wrong on the server. Try again later.',
    request_failed: 'The request failed. Check your connection and try again.',
  },
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
  confirmPassword: 'Bevestig wachtwoord',
  signIn: 'Inloggen',
  signingIn: 'Inloggen...',
  creatingAccount: 'Account aanmaken...',
  createAccount: 'Account aanmaken',
  sso: 'Inloggen met SSO',
  showRegister: 'Een account aanmaken',
  backToSignIn: 'Terug naar inloggen',
  registerSent: 'Als dit adres kan worden geregistreerd, ontvangt u een e-mail met een bevestigingslink.',
  loading: 'Inlogopties laden...',
  configFailed: 'De inlogopties konden niet worden geladen. Laad de pagina opnieuw om het nog eens te proberen.',
  registerErrors: {
    email_invalid: 'Voer een geldig e-mailadres in.',
    password_too_short: 'Het wachtwoord is te kort. Gebruik minimaal {min} tekens.',
    password_too_long: 'Het wachtwoord is te lang. Gebruik maximaal {max} tekens.',
    password_mismatch: 'De wachtwoorden komen niet overeen.',
    invalid_request: 'Controleer uw e-mailadres en wachtwoord. Het wachtwoord moet {min} tot {max} tekens bevatten.',
    registration_disabled: 'Registreren is uitgeschakeld op deze server.',
    rate_limited: 'Te veel pogingen. Wacht even en probeer het opnieuw.',
    local_auth_disabled: 'Inloggen met wachtwoord is uitgeschakeld. Gebruik Inloggen met SSO.',
    internal: 'Er is iets misgegaan op de server. Probeer het later opnieuw.',
    request_failed: 'Het verzoek is mislukt. Controleer uw verbinding en probeer het opnieuw.',
  },
  pageErrors: {
    account_not_linked:
      'Uw aanmelding is gelukt, maar er is geen Walley-account aan gekoppeld. Vraag de beheerder van deze Walley-omgeving om toegang.',
    oidc_failed: 'Inloggen is mislukt. Probeer het opnieuw of neem contact op met de beheerder van deze Walley-omgeving.',
  },
};

export const loginPageMessages = { en, nl };
