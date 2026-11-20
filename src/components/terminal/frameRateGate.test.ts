import { describe, expect, it } from "vitest";
import { FrameRateGate } from "./frameRateGate";

function clock(start = 1000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("FrameRateGate", () => {
  it("does not delay when the cap is disabled", () => {
    const gate = new FrameRateGate({ fps: 0 });
    expect(gate.delayMs()).toBe(0);
    gate.noteFrame();
    expect(gate.delayMs()).toBe(0);
  });

  it("delays until the interval has elapsed", () => {
    const c = clock();
    const gate = new FrameRateGate({ fps: 10, now: c.now });

    // 10 fps => 100ms interval.
    expect(gate.delayMs()).toBe(0);
    gate.noteFrame();
    c.advance(30);
    expect(gate.delayMs()).toBe(70);
    c.advance(70);
    expect(gate.delayMs()).toBe(0);
  });

  it("reports blocked while paused", () => {
    const gate = new FrameRateGate({ fps: 10 });
    gate.setPaused(true);
    expect(gate.delayMs()).toBeNull();
    expect(gate.tryAcquire()).toBe(false);
  });

  it("restarts the interval when resuming from a pause", () => {
    const c = clock();
    const gate = new FrameRateGate({ fps: 10, now: c.now });
    gate.setPaused(true);
    gate.setPaused(false);

    // Resuming starts a fresh interval rather than releasing immediately.
    expect(gate.delayMs()).toBeGreaterThan(0);
    c.advance(100);
    expect(gate.delayMs()).toBe(0);
  });

  it("never returns a delay below one millisecond", () => {
    const c = clock();
    const gate = new FrameRateGate({ fps: 1000, now: c.now });
    gate.noteFrame();
    c.advance(0.2);
    const delay = gate.delayMs();
    expect(delay).not.toBeNull();
    expect(delay as number).toBeGreaterThanOrEqual(1);
  });

  it("supports the polling form", () => {
    const c = clock();
    const gate = new FrameRateGate({ fps: 4, now: c.now });

    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);
    c.advance(250);
    expect(gate.tryAcquire()).toBe(true);
  });

  it("applies a reconfigured rate on the next query", () => {
    const c = clock();
    const gate = new FrameRateGate({ fps: 10, now: c.now });
    gate.noteFrame();
    c.advance(50);

    gate.configure(2); // 500ms interval
    expect(gate.delayMs()).toBe(450);
  });
});
