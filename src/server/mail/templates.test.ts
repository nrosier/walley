import { describe, expect, it } from 'vitest';
import {
  VERIFICATION_TOKEN_TTL_MS,
  alreadyRegisteredEmail,
  buildVerificationLink,
  verificationEmail,
} from './templates.js';

const ORIGIN = 'https://walley.example.com';
const TOKEN = 'a'.repeat(43);

describe('buildVerificationLink', () => {
  it('puts the token in the fragment, not the path or query', () => {
    expect(buildVerificationLink(ORIGIN, TOKEN)).toBe(
      `https://walley.example.com/verify-email#token=${TOKEN}`,
    );
    const url = new URL(buildVerificationLink(ORIGIN, TOKEN));
    expect(url.search).toBe('');
    expect(url.pathname).toBe('/verify-email');
    expect(url.hash).toBe(`#token=${TOKEN}`);
  });
});

describe('verificationEmail', () => {
  it('contains the link and the 24 hour expiry, and nothing else of the account', () => {
    const { subject, text } = verificationEmail(ORIGIN, TOKEN);
    expect(subject).toBe('Verify your Walley email address');
    expect(text).toContain(buildVerificationLink(ORIGIN, TOKEN));
    expect(text).toContain('24 hours');
    expect(text).toContain('If you did not sign up, do not open this link.');
    expect(text).not.toContain('password');
    expect(text).not.toContain('user_id');
  });

  it('keeps the TTL at 24 hours', () => {
    expect(VERIFICATION_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('alreadyRegisteredEmail', () => {
  it('points to the sign-in page and holds no token or address', () => {
    const { subject, text } = alreadyRegisteredEmail(ORIGIN);
    expect(subject).toBe('Walley account already exists');
    expect(text).toContain(ORIGIN);
    expect(text).not.toContain('#token=');
    expect(text).not.toContain('@');
  });
});
