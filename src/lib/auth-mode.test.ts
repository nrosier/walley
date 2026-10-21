import { describe, expect, it } from 'vitest';
import { AUTH_METHODS, isAuthMethod } from './auth-mode.js';

describe('AUTH_METHODS', () => {
  it('lists local and oidc', () => {
    expect(AUTH_METHODS).toEqual(['local', 'oidc']);
  });
});

describe('isAuthMethod', () => {
  it('accepts local and oidc', () => {
    expect(isAuthMethod('local')).toBe(true);
    expect(isAuthMethod('oidc')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isAuthMethod('LOCAL')).toBe(false);
    expect(isAuthMethod('oidc ')).toBe(false);
    expect(isAuthMethod('')).toBe(false);
    expect(isAuthMethod('password')).toBe(false);
  });
});
