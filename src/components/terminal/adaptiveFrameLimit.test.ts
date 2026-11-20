import { describe, expect, it } from "vitest";
import { AdaptiveFrameLimit } from "./adaptiveFrameLimit";

const base = { thresholdRowsPerSecond: 200, cappedFps: 15 };

describe("AdaptiveFrameLimit", () => {
  it("stays uncapped below the threshold", () => {
    const limit = new AdaptiveFrameLimit(base);
    expect(limit.sample(50)).toBe(0);
    expect(limit.sample(199)).toBe(0);
    expect(limit.snapshot().engaged).toBe(false);
  });

  it("engages only after consecutive high samples", () => {
    const limit = new AdaptiveFrameLimit({ ...base, highWindows: 2 });

    // One spike must not engage the cap.
    expect(limit.sample(500)).toBe(0);
    expect(limit.snapshot().engaged).toBe(false);

    // The second consecutive high sample engages it.
    expect(limit.sample(500)).toBe(15);
    expect(limit.snapshot().engaged).toBe(true);
  });

  it("resets the high streak when a low sample appears", () => {
    const limit = new AdaptiveFrameLimit({ ...base, highWindows: 2 });

    limit.sample(500);
    limit.sample(10); // breaks the streak
    limit.sample(500);

    // Still not engaged: the streak restarted.
    expect(limit.snapshot().engaged).toBe(false);
    expect(limit.sample(500)).toBe(15);
  });

  it("releases only after consecutive low samples", () => {
    const limit = new AdaptiveFrameLimit({ ...base, highWindows: 1, lowWindows: 3 });
    limit.sample(500);
    expect(limit.snapshot().engaged).toBe(true);

    // Hovering just under the threshold must not release immediately.
    limit.sample(150);
    limit.sample(150);
    expect(limit.snapshot().engaged).toBe(true);

    limit.sample(150);
    expect(limit.snapshot().engaged).toBe(false);
    expect(limit.sample(150)).toBe(0);
  });

  it("does not oscillate when the rate hovers at the threshold", () => {
    const limit = new AdaptiveFrameLimit({ ...base, highWindows: 2, lowWindows: 3 });
    const rates = [210, 190, 210, 190, 210, 190, 210, 190];
    const states = rates.map((rate) => {
      limit.sample(rate);
      return limit.snapshot().engaged;
    });

    // Never stabilises into an engaged state while oscillating around the
    // threshold, and never engages/disengages on every single sample.
    const flips = states.filter((value, index) => index > 0 && value !== states[index - 1]);
    expect(flips.length).toBe(0);
    expect(states.every((value) => value === false)).toBe(true);
  });

  it("treats a non-positive threshold as disabled", () => {
    const limit = new AdaptiveFrameLimit({ ...base, highWindows: 1 });
    limit.sample(9999);
    expect(limit.snapshot().engaged).toBe(true);

    limit.configure({ thresholdRowsPerSecond: 0, cappedFps: 15 });
    expect(limit.sample(9999)).toBe(0);
    expect(limit.snapshot().engaged).toBe(false);
  });

  it("applies a changed cap without flipping the current state", () => {
    const limit = new AdaptiveFrameLimit({ ...base, highWindows: 1 });
    limit.sample(500);
    expect(limit.snapshot().engaged).toBe(true);

    limit.configure({ thresholdRowsPerSecond: 200, cappedFps: 10 });
    expect(limit.snapshot().engaged).toBe(true);
    expect(limit.sample(500)).toBe(10);
  });

  it("never returns a cap below 1 fps", () => {
    const limit = new AdaptiveFrameLimit({ ...base, highWindows: 1, cappedFps: 0 });
    limit.sample(500);
    expect(limit.activeFps).toBe(1);
  });

  it("reset returns to the uncapped state", () => {
    const limit = new AdaptiveFrameLimit({ ...base, highWindows: 1 });
    limit.sample(500);
    limit.reset();
    expect(limit.snapshot().engaged).toBe(false);
    expect(limit.activeFps).toBe(0);
  });
});
