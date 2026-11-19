import { describe, expect, it, vi } from "vitest";
import { TrailingThrottle, type TrailingThrottleTimers } from "./trailingThrottle";

function fakeClock() {
  let now = 1000;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();

  const timersApi: TrailingThrottleTimers = {
    setTimeout: (callback, delay) => {
      const handle = nextHandle++;
      timers.set(handle, { at: now + delay, callback });
      return handle;
    },
    clearTimeout: (handle) => {
      timers.delete(handle);
    },
    now: () => now,
  };

  return {
    timersApi,
    advance(ms: number) {
      now += ms;
      for (const [handle, timer] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= now) {
          timers.delete(handle);
          timer.callback();
        }
      }
    },
    now: () => now,
    pending: () => timers.size,
  };
}

describe("TrailingThrottle", () => {
  it("runs the first request immediately", () => {
    const clock = fakeClock();
    const throttle = new TrailingThrottle(50, clock.timersApi);
    const action = vi.fn();

    throttle.request(action);

    expect(action).toHaveBeenCalledTimes(1);
    expect(throttle.hasPending()).toBe(false);
  });

  it("coalesces requests inside the window into one trailing run", () => {
    const clock = fakeClock();
    const throttle = new TrailingThrottle(50, clock.timersApi);
    const action = vi.fn();

    throttle.request(action);
    clock.advance(10);
    throttle.request(action);
    clock.advance(10);
    throttle.request(action);

    expect(action).toHaveBeenCalledTimes(1);
    expect(throttle.hasPending()).toBe(true);

    clock.advance(40);
    expect(action).toHaveBeenCalledTimes(2);
    expect(throttle.hasPending()).toBe(false);
  });

  it("runs a fresh request immediately once the window has passed", () => {
    const clock = fakeClock();
    const throttle = new TrailingThrottle(50, clock.timersApi);
    const action = vi.fn();

    throttle.request(action);
    clock.advance(60);
    throttle.request(action);

    expect(action).toHaveBeenCalledTimes(2);
    expect(throttle.hasPending()).toBe(false);
  });

  it("cancel drops the pending run without invoking it", () => {
    const clock = fakeClock();
    const throttle = new TrailingThrottle(50, clock.timersApi);
    const action = vi.fn();

    throttle.request(action);
    clock.advance(10);
    throttle.request(action);
    throttle.cancel();

    expect(throttle.hasPending()).toBe(false);
    clock.advance(100);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("dispose drops the pending run", () => {
    const clock = fakeClock();
    const throttle = new TrailingThrottle(50, clock.timersApi);
    const action = vi.fn();

    throttle.request(action);
    clock.advance(10);
    throttle.request(action);
    throttle.dispose();

    clock.advance(100);
    expect(action).toHaveBeenCalledTimes(1);
    expect(throttle.hasPending()).toBe(false);
  });
});
