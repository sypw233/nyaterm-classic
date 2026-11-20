import { describe, expect, it } from "vitest";
import {
  blockMainThread,
  FREEZE_DEFAULT_MS,
  FREEZE_MAX_MS,
  FREEZE_MIN_MS,
  normalizeFreezeMs,
} from "./freezeDemo";

describe("freezeDemo", () => {
  it("clamps durations into the supported range", () => {
    expect(normalizeFreezeMs(10)).toBe(FREEZE_MIN_MS);
    expect(normalizeFreezeMs(99_999)).toBe(FREEZE_MAX_MS);
    expect(normalizeFreezeMs(1234)).toBe(1234);
    expect(normalizeFreezeMs(1234.6)).toBe(1235);
  });

  it("falls back to the default for invalid values", () => {
    expect(normalizeFreezeMs("nope")).toBe(FREEZE_DEFAULT_MS);
    expect(normalizeFreezeMs(NaN)).toBe(FREEZE_DEFAULT_MS);
  });

  it("blocks for at least the requested duration", () => {
    const start = Date.now();
    blockMainThread(FREEZE_MIN_MS);
    expect(Date.now() - start).toBeGreaterThanOrEqual(FREEZE_MIN_MS - 5);
  });
});
