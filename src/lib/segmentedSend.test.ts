import { describe, expect, it } from "vitest";
import {
  defaultIntervalForMode,
  normalizeSegmentIntervalMs,
  planSegmentedUnits,
  segmentDelays,
  SEGMENTED_SEND_MAX_INTERVAL_MS,
} from "./segmentedSend";

describe("defaultIntervalForMode", () => {
  it("uses a slower default for lines than for characters", () => {
    expect(defaultIntervalForMode("line")).toBe(1000);
    expect(defaultIntervalForMode("character")).toBe(20);
  });
});

describe("normalizeSegmentIntervalMs", () => {
  it("clamps above the maximum and rejects invalid input", () => {
    expect(normalizeSegmentIntervalMs(5.6)).toBe(6);
    expect(normalizeSegmentIntervalMs(-1)).toBe(0);
    expect(normalizeSegmentIntervalMs(Number.NaN)).toBe(0);
    expect(normalizeSegmentIntervalMs(999_999)).toBe(SEGMENTED_SEND_MAX_INTERVAL_MS);
  });
});

describe("planSegmentedUnits", () => {
  it("splits on characters using Unicode code points", () => {
    expect(planSegmentedUnits("ab", { mode: "character" })).toEqual(["a", "b"]);
    expect(planSegmentedUnits("😀x", { mode: "character" })).toEqual(["😀", "x"]);
  });

  it("keeps each line terminator and does not submit a final unterminated line", () => {
    expect(planSegmentedUnits("one\ntwo\n", { mode: "line" })).toEqual([
      "one\n",
      "two\n",
    ]);
    expect(planSegmentedUnits("one\ntwo", { mode: "line" })).toEqual([
      "one\n",
      "two",
    ]);
  });

  it("keeps literal CR LF line endings as typed", () => {
    expect(planSegmentedUnits("one\r\ntwo", { mode: "line" })).toEqual([
      "one\r\n",
      "two",
    ]);
  });
});

describe("segmentDelays", () => {
  it("sends the first unit immediately and delays the rest", () => {
    expect(segmentDelays(3, 25)).toEqual([0, 25, 25]);
    expect(segmentDelays(0, 25)).toEqual([]);
  });
});
