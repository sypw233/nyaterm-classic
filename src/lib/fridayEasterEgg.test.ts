import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeFridayEgg,
  isFridayNight,
  localDateKey,
  msUntilNextFridayNoon,
} from "./fridayEasterEgg";

function at(day: number, hour: number): Date {
  // 2026-11-20 is a Friday.
  const date = new Date(2026, 10, 20, hour, 0, 0);
  date.setDate(date.getDate() + (day - 5));
  return date;
}

describe("fridayEasterEgg", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });

  it("formats a stable local date key", () => {
    expect(localDateKey(at(5, 20))).toBe("2026-11-20");
  });

  it("treats Friday noon onward as Friday night", () => {
    expect(isFridayNight(at(5, 11))).toBe(false);
    expect(isFridayNight(at(5, 12))).toBe(true);
    expect(isFridayNight(at(5, 23))).toBe(true);
    expect(isFridayNight(at(6, 20))).toBe(false);
  });

  it("shows once on Friday night and not again the same day", () => {
    expect(consumeFridayEgg(at(5, 20), true)).toBe(true);
    expect(consumeFridayEgg(at(5, 23), true)).toBe(false);
  });

  it("respects the master switch and does not mark when disabled", () => {
    expect(consumeFridayEgg(at(5, 20), false)).toBe(false);
    // Enabling later on the same Friday still allows it (nothing was marked).
    expect(consumeFridayEgg(at(5, 20), true)).toBe(true);
  });

  it("shows again on a later Friday but not on other days", () => {
    expect(consumeFridayEgg(at(5, 20), true)).toBe(true);
    expect(consumeFridayEgg(at(6, 20), true)).toBe(false); // Saturday
    expect(consumeFridayEgg((
      () => {
        const d = at(5, 20);
        d.setDate(d.getDate() + 7);
        return d;
      }
    )(), true)).toBe(true); // the next Friday
  });

  it("computes the wait to the next Friday noon", () => {
    expect(msUntilNextFridayNoon(at(5, 10))).toBe(2 * 60 * 60 * 1000);
    // Friday after noon: next week's Friday noon.
    expect(msUntilNextFridayNoon(at(5, 13))).toBe(7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000);
    // Monday noon -> Friday noon = 4 days.
    expect(msUntilNextFridayNoon(at(1, 12))).toBe(4 * 24 * 60 * 60 * 1000);
  });
});
