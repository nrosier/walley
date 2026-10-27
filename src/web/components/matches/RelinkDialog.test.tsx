import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { relinkMatch } from '@/lib/matches.api';
import { createActualSchedule, createWallosSubscription } from '@/lib/create.api';
import { buildActualBody } from '../dashboard/create-submit';
import { catalogues } from '@/i18n/catalogues';
import type { SyncItem } from '../../../lib/sync-check-types';
import src from './RelinkDialog.tsx?raw';
import dialogSrc from '../ui/dialog.tsx?raw';
import { orderRelinkItems } from './relink-order';
import { relinkDialogMessages } from './RelinkDialog.messages';

const item = (id: string, name: string): SyncItem => ({ id, name, amountCents: 100, isRange: false, reason: null });
const ITEMS = [item('a', 'Alpha'), item('b', 'Bravo'), item('c', 'Charlie'), item('d', 'Delta')];

describe('Relink dialog ordering', () => {
  it('lists the suggested candidates first in server order, then every other item, unmappable ones included', () => {
    const withBad: SyncItem[] = [...ITEMS, { ...item('e', 'Echo'), amountCents: null, reason: 'patterns_unsupported' }];
    const out = orderRelinkItems(withBad, ['c', 'a']);
    expect(out.map((o) => o.item.id)).toEqual(['c', 'a', 'b', 'd', 'e']);
    expect(out.map((o) => o.suggested)).toEqual([true, true, false, false, false]);
  });
  it('ignores candidate ids that are no longer unlinked', () => {
    expect(orderRelinkItems(ITEMS, ['gone']).map((o) => o.item.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('Relink client and failure display', () => {
  it('posts only the item id to the relink route of the match', async () => {
    const f = vi.fn().mockResolvedValue(Response.json({ id: 'm 1', status: 'LINKED' }));
    await relinkMatch('m 1', 'w9', f);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/matches/m%201/relink');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ itemId: 'w9' });
  });
  it('a failed relink rejects with the server code, which the dialog shows as text', async () => {
    const f = vi.fn().mockResolvedValue(Response.json({ error: 'already_matched' }, { status: 409 }));
    await expect(relinkMatch('m1', 'w9', f)).rejects.toMatchObject({ code: 'already_matched' });
    expect(new ApiError(409, 'already_matched').code).toBe('already_matched');
    expect(src).toMatch(/setFailure\(err instanceof ApiError \? err\.code : 'request_failed'\)/);
    expect(src).toMatch(/<Alert variant="error">\{t\('failed', \{ reason: errorText\(failure\), code: failure \}\)\}/);
    expect(relinkDialogMessages.en.failed).toContain('{code}');
    expect(relinkDialogMessages.nl.failed).toContain('{code}');
  });
  it('stays open on failure: only success calls onClose', () => {
    expect(src).toMatch(/\(\) => \{\s*setPending\(false\);\s*props\.onLinked\(\);\s*props\.onClose\(\);/);
  });
  it('builds on DialogShell', () => {
    expect(src).toContain('<DialogShell');
  });
  it('close control is a 44px touch target below 768px', () => {
    // DialogShell renders DialogContent, whose close button carries the sizing.
    const close = /data-slot="dialog-close"\s+className="([^"]*)"/.exec(dialogSrc)?.[1] ?? '';
    expect(close).toContain('max-md:min-h-(--control-h)');
    expect(close).toContain('max-md:min-w-(--control-h)');
  });
});

describe('Recreate sends matchId', () => {
  it('adds matchId to the Actual create body only when given', async () => {
    expect(buildActualBody('w1', 'a1', 'p1', '', '', 'm7')).toMatchObject({ wallosSubscriptionId: 'w1', matchId: 'm7' });
    expect(buildActualBody('w1', 'a1', 'p1', '', '')).not.toHaveProperty('matchId');
    const f = vi.fn().mockResolvedValue(Response.json({ scheduleId: 's' }, { status: 201 }));
    await createActualSchedule(buildActualBody('w1', 'a1', 'p1', '', '', 'm7'), f);
    expect(JSON.parse((f.mock.calls[0] as [string, RequestInit])[1].body as string)).toMatchObject({ matchId: 'm7' });
  });
  it('adds matchId to the Wallos create body only when given', async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ wallosSubscriptionId: '1' }, { status: 201 })));
    await createWallosSubscription('s1', f, undefined, 'm7');
    await createWallosSubscription('s1', f);
    expect(JSON.parse((f.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ scheduleId: 's1', matchId: 'm7' });
    expect(JSON.parse((f.mock.calls[1] as [string, RequestInit])[1].body as string)).toEqual({ scheduleId: 's1' });
  });
});

describe('Relink catalogue', () => {
  it('is registered with identical en and nl keys', () => {
    expect(catalogues.relinkDialog).toBe(relinkDialogMessages);
    const keys = (o: object, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v as object, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(relinkDialogMessages.nl)).toEqual(keys(relinkDialogMessages.en));
  });
});
