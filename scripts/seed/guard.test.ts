// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { assertTestInstances, isAllowedTestUrl, SeedGuardError, TEST_INSTANCE_ALLOWLIST } from './guard.js';
import { missingKeys, parseEnvFile } from './env.js';

const OK = { wallosUrl: 'http://localhost:8282', actualUrl: 'http://localhost:5006' };

describe('seed URL guard', () => {
  it('accepts the localhost and 127.0.0.1 test containers', () => {
    expect(assertTestInstances(OK)).toEqual({
      wallosOrigin: 'http://localhost:8282',
      actualOrigin: 'http://localhost:5006',
    });
    expect(
      assertTestInstances({ wallosUrl: 'http://127.0.0.1:8282/', actualUrl: ' http://127.0.0.1:5006 ' }),
    ).toEqual({ wallosOrigin: 'http://127.0.0.1:8282', actualOrigin: 'http://127.0.0.1:5006' });
  });

  it('keeps the allowlist in one constant', () => {
    expect(TEST_INSTANCE_ALLOWLIST.wallos).toEqual(['http://localhost:8282', 'http://127.0.0.1:8282']);
    expect(TEST_INSTANCE_ALLOWLIST.actual).toEqual(['http://localhost:5006', 'http://127.0.0.1:5006']);
  });

  it.each([
    ['a live host', 'https://wallos.example.com'],
    ['the wrong port', 'http://localhost:8283'],
    ['https on the test port', 'https://localhost:8282'],
    ['a look-alike host', 'http://localhost.evil.test:8282'],
    ['credentials in the URL', 'http://user:pw@localhost:8282'],
    ['a path', 'http://localhost:8282/wallos'],
    ['a query', 'http://localhost:8282/?x=1'],
    ['a private network host', 'http://192.168.1.10:8282'],
    ['an empty value', ''],
    ['text that is not a URL', 'not a url'],
  ])('refuses a non-test Wallos URL: %s', (_label, wallosUrl) => {
    expect(() => assertTestInstances({ ...OK, wallosUrl })).toThrow(SeedGuardError);
  });

  it.each([
    ['a live host', 'https://actual.example.com'],
    ['the Wallos port', 'http://localhost:8282'],
    ['https on the test port', 'https://localhost:5006'],
    ['an empty value', ''],
  ])('refuses a non-test Actual URL: %s', (_label, actualUrl) => {
    expect(() => assertTestInstances({ ...OK, actualUrl })).toThrow(SeedGuardError);
  });

  it('refuses before any request and never puts the URL in the message', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const secretUrl = 'https://user:topsecret@wallos.example.com/path';
    let message = '';
    try {
      assertTestInstances({ ...OK, wallosUrl: secretUrl });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('topsecret');
    expect(message).not.toContain('wallos.example.com');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('isAllowedTestUrl is strict per instance', () => {
    expect(isAllowedTestUrl('wallos', 'http://localhost:5006')).toBe(false);
    expect(isAllowedTestUrl('actual', 'http://localhost:8282')).toBe(false);
    expect(isAllowedTestUrl('actual', 'http://localhost:5006')).toBe(true);
  });
});

describe('test env file parser', () => {
  it('reads KEY: value lines and ignores comments and blanks', () => {
    const env = parseEnvFile('# note\n\nA_KEY: one\nB_KEY:two words\nC_KEY: "quoted"\nD_KEY=ignored\nE_KEY:\n');
    expect(env.get('A_KEY')).toBe('one');
    expect(env.get('B_KEY')).toBe('two words');
    expect(env.get('C_KEY')).toBe('quoted');
    expect(env.has('D_KEY')).toBe(false);
    expect(env.get('E_KEY')).toBe('');
  });

  it('keeps colons inside a value', () => {
    expect(parseEnvFile('URL: http://localhost:8282').get('URL')).toBe('http://localhost:8282');
  });

  it('reports missing keys by name only', () => {
    const env = parseEnvFile('A: 1\nB:\n');
    expect(missingKeys(env, ['A', 'B', 'C'])).toEqual(['B', 'C']);
  });
});
