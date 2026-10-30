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
