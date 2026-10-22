/**
 * Password length limits shared by the server (src/server/auth/passwords.ts) and the web form
 * (src/web/pages/AccountSettings.tsx). Counted in Unicode code points after NFKC normalisation.
 */
export const PASSWORD_MIN_CODE_POINTS = 15;
export const PASSWORD_MAX_CODE_POINTS = 256;
