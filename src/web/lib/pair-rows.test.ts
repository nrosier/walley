import { describe, expect, it } from 'vitest';
import type { SyncCandidate, SyncCheckResult, SyncLinked } from '../../lib/sync-check-types';
import { buildPairRows, cellsOf } from './pair-rows';

const item = (id: string, name: string) => ({ id, name, amountCents: 1000, isRange: false, reason: null });
const cand = (wallosId: string, actualScheduleId: string, nameScore: number): SyncCandidate => ({
  wallosId,
  actualScheduleId,
  nameScore,
  wallosName: wallosId,
  actualName: actualScheduleId,
  wallosAmountCents: 1000,
  actualAmountCents: 1000,
  isRange: false,
});
const link = (wallosId: string, actualScheduleId: string, extra: Partial<SyncLinked> = {}): SyncLinked => ({
  matchId: `m-${wallosId}`,
  wallosId,
  actualScheduleId,
  status: 'LINKED',
  orphan: null,
  wallosName: `Wallos ${wallosId}`,
  actualName: `Actual ${actualScheduleId}`,
  wallosAmountCents: 500,
  actualAmountCents: 500,
  isRange: false,
  relinkCandidateIds: [],
  ...extra,
});

const result = (extra: Partial<SyncCheckResult> = {}): SyncCheckResult => ({
  checkedAt: '2026-01-01T00:00:00Z',
  baseCurrency: 'EUR',
  unlinkedWallos: [item('w1', 'Netflix'), item('w2', 'Gym'), item('w3', 'Spotify')],
  unlinkedActual: [item('a1', 'NETFLIX.COM'), item('a2', 'Rent'), item('a3', 'Spotify AB')],
  candidates: [cand('w1', 'a1', 0.6), cand('w3', 'a3', 0.9)],
  mismatches: [],
  unmappable: [],
  orphaned: [],
  linked: [link('wl', 'al')],
  ignored: [],
  ...extra,
});

const shape = (rows: ReturnType<typeof buildPairRows>) => rows.map((r) => [r.kind, r.wallos?.id ?? null, r.actual?.id ?? null]);

describe('buildPairRows ordering (#142)', () => {
  it('orders linked pairs, then suggested pairs by score, then Wallos-only, then Actual-only', () => {
    expect(shape(buildPairRows(result(), ''))).toEqual([
      ['linked', 'wl', 'al'],
      ['suggested', 'w3', 'a3'],
      ['suggested', 'w1', 'a1'],
      ['wallos', 'w2', null],
      ['actual', null, 'a2'],
    ]);
  });

  it('shows a linked pair in one row with both names and its status badge', () => {
    const [row] = buildPairRows(result({ linked: [link('wl', 'al', { status: 'MISMATCH_DETECTED' })] }), '');
    expect(row?.wallos?.name).toBe('Wallos wl');
    expect(row?.actual?.name).toBe('Actual al');
    expect(row?.badge).toBe('mismatch');
    expect(buildPairRows(result(), '')[0]?.badge).toBe('synced');
  });

  it('shows each Wallos item and each Actual item in at most one row', () => {
    // w1 is a candidate for both a1 and a2; a1 is a candidate for both w1 and w2.
    const r = result({
      unlinkedWallos: [item('w1', 'One'), item('w2', 'Two')],
      unlinkedActual: [item('a1', 'Uno'), item('a2', 'Dos')],
      candidates: [cand('w1', 'a2', 0.5), cand('w1', 'a1', 0.9), cand('w2', 'a1', 0.8), cand('w2', 'a2', 0.7)],
      linked: [],
    });
    const rows = buildPairRows(r, '');
    expect(shape(rows)).toEqual([
      ['suggested', 'w1', 'a1'],
      ['suggested', 'w2', 'a2'],
    ]);
    const ids = (side: 'wallos' | 'actual') => cellsOf(rows, side).map((c) => c.id);
    expect(new Set(ids('wallos')).size).toBe(ids('wallos').length);
    expect(new Set(ids('actual')).size).toBe(ids('actual').length);
  });

  it('leaves an item whose only candidate partner is taken as an unpaired row of its own side', () => {
    const r = result({
      unlinkedWallos: [item('w1', 'One'), item('w2', 'Two')],
      unlinkedActual: [item('a1', 'Uno')],
      candidates: [cand('w1', 'a1', 0.9), cand('w2', 'a1', 0.8)],
      linked: [],
    });
    expect(shape(buildPairRows(r, ''))).toEqual([
      ['suggested', 'w1', 'a1'],
      ['wallos', 'w2', null],
    ]);
  });

  it('never lists an ignored item, and ignores a candidate that names an item no longer unlinked', () => {
    const r = result({
      unlinkedWallos: [item('w1', 'Netflix')],
      unlinkedActual: [],
      candidates: [cand('w1', 'gone', 0.9)],
      linked: [],
      ignored: [{ matchId: 'm1', side: 'wallos', itemId: 'w9', name: 'Old', amountCents: 5, isRange: false, reason: null }],
    });
    expect(shape(buildPairRows(r, ''))).toEqual([['wallos', 'w1', null]]);
  });
});

describe('buildPairRows empty placeholder (#142)', () => {
  it('leaves the missing side null so the row can render an empty placeholder', () => {
    const rows = buildPairRows(result(), '');
    expect(rows.find((r) => r.kind === 'wallos')?.actual).toBeNull();
    expect(rows.find((r) => r.kind === 'actual')?.wallos).toBeNull();
  });
  it('keeps a linked row whose Actual side vanished, with a null Actual cell', () => {
    const rows = buildPairRows(result({ linked: [link('wl', 'al', { actualName: null, orphan: 'orphaned_actual' })] }), '');
    expect(rows[0]?.actual).toBeNull();
    expect(rows[0]?.wallos?.id).toBe('wl');
    expect(rows[0]?.badge).toBe('orphaned');
  });
});

describe('buildPairRows search (#142)', () => {
  it('keeps a row when either side matches, case-insensitively', () => {
    // "netflix" matches the Wallos name of w1 and the Actual name NETFLIX.COM of the same row.
    expect(shape(buildPairRows(result(), 'NETFLIX'))).toEqual([['suggested', 'w1', 'a1']]);
    // "spotify ab" matches only the Actual side of the pair; the row stays with its Wallos cell.
    expect(shape(buildPairRows(result(), 'spotify ab'))).toEqual([['suggested', 'w3', 'a3']]);
    // "actual al" matches only the Actual side of the linked row.
    expect(shape(buildPairRows(result(), 'actual al'))).toEqual([['linked', 'wl', 'al']]);
  });
  it('drops every row when nothing matches, and keeps all rows on a blank query', () => {
    expect(buildPairRows(result(), 'zzz')).toEqual([]);
    expect(buildPairRows(result(), '   ')).toHaveLength(5);
  });
});
