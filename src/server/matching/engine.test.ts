import { describe, expect, it } from "vitest";
import { classifySavedPairs, type SavedMatch } from "./engine.js";

const pair = (
  w: string,
  a: string,
  status: SavedMatch["status"] = "LINKED",
): SavedMatch => ({
  wallosId: w,
  actualScheduleId: a,
  status,
});

describe("classifySavedPairs", () => {
  it("keeps a pair saved before the sync linked when both sides are present", () => {
    const r = classifySavedPairs([pair("w1", "a1")], ["w1"], ["a1"]);
    expect(r.pairs).toEqual([
      {
        wallosId: "w1",
        actualScheduleId: "a1",
        classification: "linked",
        savedStatus: "LINKED",
      },
    ]);
    expect(r.unlinkedWallosIds).toEqual([]);
    expect(r.unlinkedActualIds).toEqual([]);
  });

  it("flags a vanished Wallos side as orphaned_wallos", () => {
    const r = classifySavedPairs([pair("w1", "a1")], [], ["a1"]);
    expect(r.pairs[0]?.classification).toBe("orphaned_wallos");
    expect(r.unlinkedActualIds).toEqual([]);
  });

  it("flags a vanished Actual side as orphaned_actual", () => {
    const r = classifySavedPairs([pair("w1", "a1")], ["w1"], []);
    expect(r.pairs[0]?.classification).toBe("orphaned_actual");
    expect(r.unlinkedWallosIds).toEqual([]);
  });

  it("flags both sides gone as orphaned_both", () => {
    expect(
      classifySavedPairs([pair("w1", "a1")], [], []).pairs[0]?.classification,
    ).toBe("orphaned_both");
  });

  it("keeps the stored MISMATCH_DETECTED status on a present pair", () => {
    const r = classifySavedPairs(
      [pair("w1", "a1", "MISMATCH_DETECTED")],
      ["w1"],
      ["a1"],
    );
    expect(r.pairs[0]).toMatchObject({
      classification: "linked",
      savedStatus: "MISMATCH_DETECTED",
    });
  });

  it("preserves ignored rows and never links them", () => {
    const ignoredW: SavedMatch = {
      wallosId: "w2",
      actualScheduleId: null,
      status: "IGNORED_WALLOS",
    };
    const ignoredA: SavedMatch = {
      wallosId: null,
      actualScheduleId: "a2",
      status: "IGNORED_ACTUAL",
    };
    const r = classifySavedPairs([ignoredW, ignoredA], ["w2"], ["a2"]);
    expect(r.ignored).toEqual([ignoredW, ignoredA]);
    expect(r.pairs).toEqual([]);
    expect(r.unlinkedWallosIds).toEqual([]);
    expect(r.unlinkedActualIds).toEqual([]);
  });

  it("lists items that are in no saved pair as unlinked", () => {
    const r = classifySavedPairs(
      [pair("w1", "a1")],
      ["w1", "w2", "w3"],
      ["a1", "a9"],
    );
    expect(r.unlinkedWallosIds).toEqual(["w2", "w3"]);
    expect(r.unlinkedActualIds).toEqual(["a9"]);
  });

  it("returns all items unlinked for an empty saved list", () => {
    const r = classifySavedPairs([], ["w1", "w2"], ["a1"]);
    expect(r).toEqual({
      pairs: [],
      ignored: [],
      unlinkedWallosIds: ["w1", "w2"],
      unlinkedActualIds: ["a1"],
    });
  });

  it("documentation only: the caller scopes rows and ids per user, so a shared id across users is not handled here", () => {
    const r = classifySavedPairs([pair("w1", "a1")], ["w1"], ["a1"]);
    expect(r.pairs).toHaveLength(1);
  });
});
