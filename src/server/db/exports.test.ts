import { describe, expect, it } from 'vitest';
import * as accounts from './accounts.js';
import * as appSettings from './app-settings.js';
import * as lookup from './lookup.js';
import * as repo from './repo.js';

describe('data layer exports', () => {
  it('repo.ts exports only createUserRepo', () => {
    expect(Object.keys(repo).sort()).toEqual(['createUserRepo']);
  });

  it('accounts.ts exports only createUser', () => {
    expect(Object.keys(accounts).sort()).toEqual(['createUser']);
  });

  it('app-settings.ts exports only the registration toggle read and write', () => {
    expect(Object.keys(appSettings).sort()).toEqual(['getRegistrationEnabled', 'setRegistrationEnabled']);
  });

  it('lookup.ts exports only the five pre-sign-in reads', () => {
    expect(Object.keys(lookup).sort()).toEqual([
      'findEmailVerification',
      'findLinkCandidate',
      'findLoginByEmail',
      'findSessionByIdHash',
      'findUserIdByIdentity',
    ]);
  });
});
