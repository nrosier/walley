import { describe, expect, it } from 'vitest';
import * as accounts from './accounts.js';
import * as repo from './repo.js';

describe('data layer exports', () => {
  it('repo.ts exports only createUserRepo', () => {
    expect(Object.keys(repo).sort()).toEqual(['createUserRepo']);
  });

  it('accounts.ts exports only createUser', () => {
    expect(Object.keys(accounts).sort()).toEqual(['createUser']);
  });
});
