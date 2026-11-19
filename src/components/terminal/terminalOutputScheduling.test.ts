import { describe, expect, it } from "vitest";
import { XTERM_PERFORMANCE_CONFIG } from "@/lib/xtermPerformance";
import { TerminalOutputScheduler } from "./terminalOutputScheduling";

describe("TerminalOutputScheduler", () => {
  it("uses normal write chunks outside alternate screen", () => {
    const scheduler = new TerminalOutputScheduler({
      getQueueBytes: () => 1024,
      isAlternateScreenActive: () => false,
    });

    expect(scheduler.getWriteChunkBytes()).toBe(XTERM_PERFORMANCE_CONFIG.output.writeChunkBytes);
    expect(scheduler.getForegroundDelayMs()).toBe(0);
  });

  it("rate-limits alternate-screen repaints even with a small backlog", () => {
    // Regression: the cap used to be gated on a 32 KiB backlog, but a typical
    // TUI frame is far smaller, so the cap never engaged in practice.
    let now = 1000;
    const scheduler = new TerminalOutputScheduler({
      getQueueBytes: () => 512,
      isAlternateScreenActive: () => true,
      getAlternateScreenMaxFps: () => 20,
      now: () => now,
    });

    scheduler.noteWriteStart();
    now += 10; // 10ms since the last write, well under the 50ms frame budget

    const delay = scheduler.getForegroundDelayMs();
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(50);
  });

  it("honours a configured cap", () => {
    let now = 1000;
    const scheduler = new TerminalOutputScheduler({
      getQueueBytes: () => 512,
      isAlternateScreenActive: () => true,
      getAlternateScreenMaxFps: () => 10,
      now: () => now,
    });

    scheduler.noteWriteStart();
    now += 10;

    // 10 fps => 100ms interval; 10ms elapsed leaves roughly 90ms.
    const delay = scheduler.getForegroundDelayMs();
    expect(delay).toBeGreaterThan(80);
    expect(delay).toBeLessThanOrEqual(100);
  });

  it("treats a zero cap as unlimited", () => {
    let now = 1000;
    const scheduler = new TerminalOutputScheduler({
      getQueueBytes: () => 512,
      isAlternateScreenActive: () => true,
      getAlternateScreenMaxFps: () => 0,
      now: () => now,
    });

    scheduler.noteWriteStart();
    now += 1;

    expect(scheduler.getForegroundDelayMs()).toBe(0);
  });

  it("falls back to the built-in cap when no override is supplied", () => {
    let now = 1000;
    const scheduler = new TerminalOutputScheduler({
      getQueueBytes: () => 512,
      isAlternateScreenActive: () => true,
      now: () => now,
    });

    scheduler.noteWriteStart();
    now += 1;

    const intervalMs = 1000 / XTERM_PERFORMANCE_CONFIG.output.alternateScreenMaxWriteFps;
    const delay = scheduler.getForegroundDelayMs();
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(intervalMs);
  });
});
