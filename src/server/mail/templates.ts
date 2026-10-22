/**
 * Verification tokens expire 24 hours after they are issued. Owner decision for issue #99.
 */
export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface MailContent {
  readonly subject: string;
  readonly text: string;
}

/**
 * The verification link. The token sits in the URL fragment, so browsers never send it to the
 * server in a request line or a Referer header.
 */
export function buildVerificationLink(publicOrigin: string, token: string): string {
  return `${publicOrigin}/verify-email#token=${token}`;
}

/** Plain-text verification email. Contains the link and nothing else that is account data. */
export function verificationEmail(publicOrigin: string, token: string): MailContent {
  const link = buildVerificationLink(publicOrigin, token);
  return {
    subject: 'Verify your Walley email address',
    text: [
      'Hello,',
      '',
      'Open this link to verify your Walley email address:',
      link,
      '',
      'The link expires in 24 hours. If you did not create a Walley account, ignore this email.',
      '',
    ].join('\n'),
  };
}

/** Plain-text notice sent when someone registers with an address that already has an account. */
export function alreadyRegisteredEmail(publicOrigin: string): MailContent {
  return {
    subject: 'Walley account already exists',
    text: [
      'Hello,',
      '',
      `A Walley account already exists for this email address. Sign in at ${publicOrigin}.`,
      '',
      'If you did not try to create an account, ignore this email.',
      '',
    ].join('\n'),
  };
}
