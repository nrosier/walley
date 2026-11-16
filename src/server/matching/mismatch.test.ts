import { describe, expect, it } from "vitest";
import type { MatchFieldsInput } from "../../lib/match-fields.js";
import { hashMatchFields } from "./hash.js";
import { detectMismatches, type MismatchSavedRow } from "./mismatch.js";

const wallosItem: MatchFieldsInput = {
  name: "Netflix",
  amount: { kind: "single", cents: -1299 },
  frequency: "monthly",
  currency: "EUR",
  startDate: "2026-01-01",
};
const actualItem: MatchFieldsInput = { ...wallosItem };

const h = (input: MatchFieldsInput): string => {
  const v = hashMatchFields(input);
  if (v === null) throw new Error("unexpected null hash");
  return v;
};

const row = (over: Partial<MismatchSavedRow> = {}): MismatchSavedRow => ({
  wallosId: "w1",
  actualScheduleId: "a1",
  status: "LINKED",
  lastKnownWallosHash: h(wallosItem),
  lastKnownActualHash: h(actualItem),
  ...over,
});

const run = (
  rows: MismatchSavedRow[],
  w: MatchFieldsInput = wallosItem,
  a: MatchFieldsInput = actualItem,
) => detectMismatches(rows, new Map([["w1", w]]), new Map([["a1", a]]));

describe("detectMismatches", () => {
  it("keeps LINKED when nothing changed", () => {
    const { results, unmappable } = run([row()]);
    expect(unmappable).toEqual([]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      nextStatus: "LINKED",
      wallosHash: h(wallosItem),
      actualHash: h(actualItem),
      baseline: false,
      wallosDrift: false,
      actualDrift: false,
    });
  });

  it("sets MISMATCH_DETECTED when the Actual amount changed, keeping the stored baseline", () => {
    const changed: MatchFieldsInput = { ...actualItem, amount: { kind: "single", cents: -1499 } };
    const [r] = run([row()], wallosItem, changed).results;
    expect(r).toMatchObject({
      nextStatus: "MISMATCH_DETECTED",
      actualDrift: true,
      wallosDrift: false,
      actualHash: h(actualItem),
      currentActualHash: h(changed),
    });
  });

  it("does not flag a Wallos name change that differs only by case", () => {
    const [r] = run([row()], { ...wallosItem, name: "NETFLIX" }).results;
    expect(r?.nextStatus).toBe("LINKED");
    expect(r?.wallosDrift).toBe(false);
  });

  it("sets a baseline from a null stored hash without flagging", () => {
    const changed: MatchFieldsInput = { ...wallosItem, name: "Netflix Premium" };
    const [r] = run(
      [row({ lastKnownWallosHash: null, lastKnownActualHash: null })],
      changed,
    ).results;
    expect(r).toMatchObject({
      nextStatus: "LINKED",
      baseline: true,
      wallosHash: h(changed),
      actualHash: h(actualItem),
    });
  });

  it("still flags drift on the side that had a stored hash during a partial baseline", () => {
    const changed: MatchFieldsInput = { ...actualItem, amount: { kind: "single", cents: -1 } };
    const [r] = run([row({ lastKnownWallosHash: null })], wallosItem, changed).results;
    expect(r).toMatchObject({ nextStatus: "MISMATCH_DETECTED", baseline: true, actualDrift: true });
  });

  it("leaves ignored rows untouched", () => {
    const changed: MatchFieldsInput = { ...actualItem, amount: { kind: "single", cents: -1 } };
    const r = run(
      [
        row({ status: "IGNORED_WALLOS", actualScheduleId: null }),
        row({ status: "IGNORED_ACTUAL", wallosId: null }),
        row({ status: "IGNORED_ACTUAL" }),
      ],
      wallosItem,
      changed,
    );
    expect(r).toEqual({ results: [], unmappable: [] });
  });

  it("does not flag a pattern schedule and reports it as unmappable", () => {
    const pattern: MatchFieldsInput = { ...actualItem, patterns: [{ type: "day", value: 1 }] };
    const r = run([row()], wallosItem, pattern);
    expect(r.results).toEqual([]);
    expect(r.unmappable).toEqual([{ wallosId: "w1", actualScheduleId: "a1", side: "actual" }]);
  });

  it("skips orphaned pairs, which classifySavedPairs reports", () => {
    const r = detectMismatches([row()], new Map(), new Map([["a1", actualItem]]));
    expect(r).toEqual({ results: [], unmappable: [] });
  });

  it("returns a MISMATCH_DETECTED row to LINKED when the drift is gone", () => {
    const [r] = run([row({ status: "MISMATCH_DETECTED" })]).results;
    expect(r).toMatchObject({ previousStatus: "MISMATCH_DETECTED", nextStatus: "LINKED" });
  });

  it("keeps MISMATCH_DETECTED while the drift remains", () => {
    const changed: MatchFieldsInput = { ...actualItem, amount: { kind: "single", cents: -1 } };
    const [r] = run([row({ status: "MISMATCH_DETECTED" })], wallosItem, changed).results;
    expect(r?.nextStatus).toBe("MISMATCH_DETECTED");
  });
});

describe("detectMismatches entity re-baseline (0.2.0 raw-name hash)", () => {
  const escaped: MatchFieldsInput = { ...wallosItem, name: "Ray &amp; Jules" };
  const decoded: MatchFieldsInput = { ...wallosItem, name: "Ray & Jules" };
  const legacyOf = (current: MatchFieldsInput, raw: string): MatchFieldsInput => ({ ...current, name: raw });
  const runLegacy = (
    rows: MismatchSavedRow[],
    w: MatchFieldsInput,
    legacy: MatchFieldsInput,
    a: MatchFieldsInput = actualItem,
  ) => detectMismatches(rows, new Map([["w1", w]]), new Map([["a1", a]]), new Map([["w1", legacy]]));

  it("keeps a pair LINKED when only the entity decode changed the name, and advances the Wallos baseline", () => {
    const stored = h(escaped);
    const [r] = runLegacy(
      [row({ lastKnownWallosHash: stored })],
      decoded,
      legacyOf(decoded, "Ray &amp; Jules"),
    ).results;
    expect(r).toMatchObject({
      nextStatus: "LINKED",
      wallosRebaselined: true,
      wallosDrift: false,
      actualDrift: false,
      wallosHash: h(decoded),
      currentWallosHash: h(decoded),
    });
  });

  it("still flags drift when the stored hash matches neither the current nor the legacy hash", () => {
    const [r] = runLegacy(
      [row({ lastKnownWallosHash: h({ ...wallosItem, name: "Something Else" }) })],
      decoded,
      legacyOf(decoded, "Ray &amp; Jules"),
    ).results;
    expect(r).toMatchObject({
      nextStatus: "MISMATCH_DETECTED",
      wallosRebaselined: false,
      wallosDrift: true,
    });
  });

  it("still flags drift when the entity-encoded name and a real amount change happened together", () => {
    const changed: MatchFieldsInput = { ...decoded, amount: { kind: "single", cents: -1499 } };
    const [r] = runLegacy(
      [row({ lastKnownWallosHash: h(escaped) })],
      changed,
      legacyOf(changed, "Ray &amp; Jules"),
    ).results;
    expect(r).toMatchObject({
      nextStatus: "MISMATCH_DETECTED",
      wallosRebaselined: false,
      wallosDrift: true,
      wallosHash: h(escaped),
    });
  });
});

describe("detectMismatches rate margin (#229)", () => {
  const base = (cents: number, over: Partial<MatchFieldsInput> = {}): MatchFieldsInput => ({
    ...wallosItem,
    amount: { kind: "single", cents },
    ...over,
  });
  const own = { priceMinor: -2500, currencyCode: "USD" };
  const marginRow = (over: Partial<MismatchSavedRow> = {}): MismatchSavedRow =>
    row({
      lastKnownWallosHash: h(base(-1250)),
      lastKnownActualHash: h(base(-1250)),
      lastKnownWallosAmountCents: -1250,
      lastKnownWallosPriceMinor: -2500,
      lastKnownWallosCurrency: "USD",
      ...over,
    });
  const go = (
    rows: MismatchSavedRow[],
    w: MatchFieldsInput,
    opts: { own?: { priceMinor: number; currencyCode: string } | null; pct?: number; a?: MatchFieldsInput } = {},
  ) =>
    detectMismatches(
      rows,
      new Map([["w1", w]]),
      new Map([["a1", opts.a ?? base(-1250)]]),
      new Map(),
      {
        ...(opts.own === null ? {} : { wallosOwnById: new Map([["w1", opts.own ?? own]]) }),
        currencyDriftPercent: opts.pct ?? 2,
      },
    ).results[0];

  it("no baseline columns yet: exact comparison, then lazy fill when the hash matches", () => {
    const noCols = marginRow({
      lastKnownWallosAmountCents: null,
      lastKnownWallosPriceMinor: null,
      lastKnownWallosCurrency: null,
    });
    const r = go([noCols], base(-1238));
    expect(r).toMatchObject({ nextStatus: "MISMATCH_DETECTED", withinMargin: false, wallosBaselineWrite: "none" });
    expect(r?.rateMargin).toBeUndefined();
    expect(go([noCols], base(-1250))).toMatchObject({ nextStatus: "LINKED", wallosBaselineWrite: "fill" });
  });

  it("does not fill when columns are already set", () => {
    expect(go([marginRow()], base(-1250))?.wallosBaselineWrite).toBe("none");
  });

  it("sets the baseline together with a null stored Wallos hash", () => {
    expect(go([marginRow({ lastKnownWallosHash: null })], base(-1238))).toMatchObject({
      nextStatus: "LINKED",
      wallosBaselineWrite: "set",
    });
  });

  it("stays LINKED for a rate-only difference inside the margin and does not advance the baseline", () => {
    const r = go([marginRow()], base(-1238));
    expect(r).toMatchObject({
      nextStatus: "LINKED",
      withinMargin: true,
      wallosDrift: false,
      wallosHash: h(base(-1250)),
      actualHash: h(base(-1250)),
      wallosBaselineWrite: "none",
      rateMargin: { differenceCents: 12, marginCents: 25, marginPercent: 2, sourceChanged: false },
    });
  });

  it("stays LINKED exactly at the margin (percent part) and flags at margin + 1", () => {
    expect(go([marginRow()], base(-1225))).toMatchObject({ nextStatus: "LINKED", withinMargin: true });
    const r = go([marginRow()], base(-1224));
    expect(r).toMatchObject({ nextStatus: "MISMATCH_DETECTED", withinMargin: false, wallosDrift: true });
    expect(r?.rateMargin).toMatchObject({ differenceCents: 26, marginCents: 25, sourceChanged: false });
  });

  it("applies the 2-unit floor on a small amount: Actual -50 has margin 2", () => {
    const a = base(-50);
    const r = (cents: number) =>
      go([marginRow({ lastKnownWallosHash: h(base(-50)), lastKnownActualHash: h(a), lastKnownWallosAmountCents: -50 })], base(cents), { a });
    expect(r(-52)).toMatchObject({ nextStatus: "LINKED", withinMargin: true });
    expect(r(-48)).toMatchObject({ nextStatus: "LINKED", withinMargin: true });
    expect(r(-53)?.nextStatus).toBe("MISMATCH_DETECTED");
    expect(r(-47)?.nextStatus).toBe("MISMATCH_DETECTED");
  });

  it("handles a 0-decimal currency (JPY budget): Actual -1000 margin 20", () => {
    const jw = (c: number) => base(c, { currency: "JPY" });
    const rows = [marginRow({ lastKnownWallosHash: h(jw(-1000)), lastKnownActualHash: h(jw(-1000)), lastKnownWallosAmountCents: -1000 })];
    expect(go(rows, jw(-980), { a: jw(-1000) })).toMatchObject({ nextStatus: "LINKED", withinMargin: true });
    expect(go(rows, jw(-979), { a: jw(-1000) })?.nextStatus).toBe("MISMATCH_DETECTED");
  });

  it("flags a one-unit own price change even inside the margin (sourceChanged)", () => {
    const r = go([marginRow()], base(-1238), { own: { priceMinor: -2501, currencyCode: "USD" } });
    expect(r).toMatchObject({ nextStatus: "MISMATCH_DETECTED", withinMargin: false, wallosBaselineWrite: "none" });
    expect(r?.rateMargin).toMatchObject({ sourceChanged: true });
  });

  it("flags a currency code change even inside the margin (sourceChanged)", () => {
    const r = go([marginRow()], base(-1238), { own: { priceMinor: -2500, currencyCode: "GBP" } });
    expect(r).toMatchObject({ nextStatus: "MISMATCH_DETECTED", withinMargin: false });
    expect(r?.rateMargin).toMatchObject({ sourceChanged: true });
  });

  it("flags an Actual change, with or without a rate move", () => {
    const a = base(-1260);
    expect(go([marginRow()], base(-1250), { a })).toMatchObject({ nextStatus: "MISMATCH_DETECTED", actualDrift: true });
    expect(go([marginRow()], base(-1238), { a })).toMatchObject({
      nextStatus: "MISMATCH_DETECTED",
      actualDrift: true,
      withinMargin: false,
    });
  });

  it("flags a Wallos non-amount change together with a rate move", () => {
    for (const change of [{ name: "Other" }, { frequency: "weekly" }, { interval: 2 }, { startDate: "2026-02-01" }]) {
      const r = go([marginRow()], base(-1238, change));
      expect(r, JSON.stringify(change)).toMatchObject({ nextStatus: "MISMATCH_DETECTED", withinMargin: false });
    }
  });

  it("returns a MISMATCH_DETECTED row to LINKED when the rate is back inside the margin", () => {
    expect(go([marginRow({ status: "MISMATCH_DETECTED" })], base(-1238))).toMatchObject({
      previousStatus: "MISMATCH_DETECTED",
      nextStatus: "LINKED",
      withinMargin: true,
    });
  });

  it("margin 0 gives today's exact result and no rateMargin", () => {
    const r = go([marginRow()], base(-1238), { pct: 0 });
    expect(r).toMatchObject({ nextStatus: "MISMATCH_DETECTED", withinMargin: false });
    expect(r?.rateMargin).toBeUndefined();
    const legacy = detectMismatches([marginRow()], new Map([["w1", base(-1238)]]), new Map([["a1", base(-1250)]]));
    expect(legacy.results[0]).toMatchObject({ nextStatus: "MISMATCH_DETECTED", withinMargin: false });
  });

  it("a Wallos side that is now in the base currency keeps the exact comparison", () => {
    const r = go([marginRow()], base(-1238), { own: { priceMinor: -1238, currencyCode: "EUR" } });
    expect(r).toMatchObject({ nextStatus: "MISMATCH_DETECTED", withinMargin: false });
    expect(r?.rateMargin).toBeUndefined();
  });

  it("without wallosOwnById the margin never applies", () => {
    expect(go([marginRow()], base(-1238), { own: null })).toMatchObject({ nextStatus: "MISMATCH_DETECTED", withinMargin: false });
  });

  it("a range Actual schedule keeps the exact comparison", () => {
    const range: MatchFieldsInput = { ...base(-1250), amount: { kind: "range", num1: -1240, num2: -1260 } };
    const r = go([marginRow({ lastKnownActualHash: h(range) })], base(-1238), { a: range });
    expect(r).toMatchObject({ nextStatus: "MISMATCH_DETECTED", withinMargin: false });
    expect(r?.rateMargin).toBeUndefined();
  });

  it("a same-currency pair with a 1-cent difference flags", () => {
    const sameOwn = { priceMinor: -1249, currencyCode: "EUR" };
    const r = go([marginRow({ lastKnownWallosCurrency: "EUR", lastKnownWallosPriceMinor: -1250 })], base(-1249), { own: sameOwn });
    expect(r).toMatchObject({ nextStatus: "MISMATCH_DETECTED", withinMargin: false });
  });

  it("opposite signs never count as inside the margin", () => {
    expect(go([marginRow()], base(1238))?.nextStatus).toBe("MISMATCH_DETECTED");
  });
});
