import { describe, expect, it } from 'vitest';
import { NAME_MATCH_THRESHOLD, nameScore, namesMatch, normalizeName } from './name-match.js';

describe('normalizeName', () => {
  it('strips accents and punctuation', () => {
    expect(normalizeName('Café!')).toBe('cafe');
    expect(normalizeName('Café!')).toBe(normalizeName('cafe'));
  });

  it('collapses spaces and lowercases', () => {
    expect(normalizeName('  Apple   Music\t+ ')).toBe('apple music');
  });

  it('drops trailing legal suffixes, dotted or not', () => {
    expect(normalizeName('Netflix Inc.')).toBe('netflix');
    expect(normalizeName('Spotify AB B.V.')).toBe('spotify ab');
    expect(normalizeName('Acme Co. Ltd')).toBe('acme');
    expect(normalizeName('Acme GmbH & Co')).toBe('acme');
  });

  it('keeps a name that is only a suffix', () => {
    expect(normalizeName('Co')).toBe('co');
  });

  it('removes apostrophes without splitting the word', () => {
    expect(normalizeName("McDonald's")).toBe('mcdonalds');
  });
});

describe('nameScore', () => {
  it('matches Netflix Inc. with netflix above the threshold', () => {
    expect(nameScore('Netflix Inc.', 'netflix')).toBe(1);
    expect(namesMatch('Netflix Inc.', 'netflix')).toBe(true);
  });

  it('scores unrelated names low', () => {
    expect(nameScore('Netflix', 'Spotify')).toBe(0);
    expect(nameScore('Adobe Creative Cloud', 'Gym membership')).toBeLessThan(NAME_MATCH_THRESHOLD);
    expect(namesMatch('Netflix', 'Spotify')).toBe(false);
  });

  it('gives partial overlap a partial score', () => {
    const score = nameScore('YouTube Premium', 'Youtube');
    expect(score).toBeCloseTo(2 / 3);
    expect(score).toBeGreaterThanOrEqual(NAME_MATCH_THRESHOLD);
  });

  it('treats names equal without spaces as a full match', () => {
    expect(nameScore('Drop box', 'Dropbox')).toBe(1);
  });

  it('is symmetric and scores empty names 0', () => {
    expect(nameScore('Apple Music', 'Apple TV')).toBe(nameScore('Apple TV', 'Apple Music'));
    expect(nameScore('', 'netflix')).toBe(0);
    expect(nameScore('!!!', '???')).toBe(0);
  });
});
