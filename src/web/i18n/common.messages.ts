/**
 * Shared strings: server error codes (errors.<code>), the generic fallback, and the language selector.
 * Dutch uses formal "u".
 */
const en = {
  genericError: 'Something went wrong. Try again.',
  errors: {
    invalid_request: 'Some fields are missing or invalid. Check them and try again.',
    invalid_credentials: 'Email or password is incorrect, or the email address is not verified yet.',
    rate_limited: 'Too many attempts. Wait a moment and try again.',
    local_auth_disabled: 'Password sign-in is turned off. Use Sign in with SSO.',
    registration_disabled: 'Registration is turned off on this server.',
    invalid_token: 'This link is invalid or has expired.',
    invalid_url: 'Enter a valid URL starting with http:// or https://.',
    wallos_auth_failed: 'Wallos rejected the API key. Check the key and try again.',
    wallos_rejected: 'Wallos rejected the request.',
    wallos_unavailable: 'Could not reach Wallos. Check the URL and try again.',
    wallos_not_configured: 'Wallos is not set up yet. Add it in Settings.',
    actual_not_configured: 'Actual Budget is not set up yet. Add it in Settings.',
    actual_unavailable: 'Could not reach Actual Budget. Check the server URL and try again.',
    internal_error: 'Something went wrong on the server. Try again later.',
    request_failed: 'The request failed. Check your connection and try again.',
    unauthenticated: 'Your session has ended. Sign in again.',
    out_of_range: 'The value is out of range.',
    already_matched: 'One of these items is already linked or ignored. Run the sync check again.',
    not_candidate: 'These items are not a suggested pair. Run the sync check again.',
    item_not_found: 'That item no longer exists. Run the sync check again.',
  },
  language: {
    label: 'Language',
    scope: 'This device',
    en: 'English',
    nl: 'Nederlands',
  },
};

const nl: typeof en = {
  genericError: 'Er ging iets mis. Probeer het opnieuw.',
  errors: {
    invalid_request: 'Sommige velden ontbreken of zijn ongeldig. Controleer ze en probeer het opnieuw.',
    invalid_credentials: 'E-mailadres of wachtwoord is onjuist, of het e-mailadres is nog niet bevestigd.',
    rate_limited: 'Te veel pogingen. Wacht even en probeer het opnieuw.',
    local_auth_disabled: 'Inloggen met wachtwoord is uitgeschakeld. Gebruik Inloggen met SSO.',
    registration_disabled: 'Registreren is uitgeschakeld op deze server.',
    invalid_token: 'Deze link is ongeldig of verlopen.',
    invalid_url: 'Voer een geldige URL in die begint met http:// of https://.',
    wallos_auth_failed: 'Wallos heeft de API-sleutel geweigerd. Controleer de sleutel en probeer het opnieuw.',
    wallos_rejected: 'Wallos heeft het verzoek geweigerd.',
    wallos_unavailable: 'Wallos is niet bereikbaar. Controleer de URL en probeer het opnieuw.',
    wallos_not_configured: 'Wallos is nog niet ingesteld. Voeg het toe bij Instellingen.',
    actual_not_configured: 'Actual Budget is nog niet ingesteld. Voeg het toe bij Instellingen.',
    actual_unavailable: 'Actual Budget is niet bereikbaar. Controleer de server-URL en probeer het opnieuw.',
    internal_error: 'Er ging iets mis op de server. Probeer het later opnieuw.',
    request_failed: 'Het verzoek is mislukt. Controleer uw verbinding en probeer het opnieuw.',
    unauthenticated: 'Uw sessie is beëindigd. Log opnieuw in.',
    out_of_range: 'De waarde valt buiten het toegestane bereik.',
    already_matched: 'Een van deze items is al gekoppeld of genegeerd. Voer de synchronisatiecontrole opnieuw uit.',
    not_candidate: 'Deze items zijn geen voorgesteld paar. Voer de synchronisatiecontrole opnieuw uit.',
    item_not_found: 'Dit item bestaat niet meer. Voer de synchronisatiecontrole opnieuw uit.',
  },
  language: {
    label: 'Taal',
    scope: 'Dit apparaat',
    en: 'English',
    nl: 'Nederlands',
  },
};

export const commonMessages = { en, nl };
