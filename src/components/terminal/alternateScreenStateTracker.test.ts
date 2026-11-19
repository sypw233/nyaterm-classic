import { describe, expect, it } from "vitest";
import { AlternateScreenStateTracker } from "./alternateScreenStateTracker";

describe("AlternateScreenStateTracker", () => {
  it("detects alternate-screen enter and leave sequences", () => {
    const tracker = new AlternateScreenStateTracker();

    expect(tracker.ingest("before\x1b[?1049hafter").alternateScreen).toBe(true);
    expect(tracker.ingest("\x1b[?1049l").alternateScreen).toBe(false);
    expect(tracker.ingest("\x1b[?47h").alternateScreen).toBe(true);
    expect(tracker.ingest("\x1b[?47l").alternateScreen).toBe(false);
  });

  it("detects split CSI sequences across chunks", () => {
    const tracker = new AlternateScreenStateTracker();

    expect(tracker.ingest("\x1b[?10").alternateScreen).toBe(false);
    expect(tracker.snapshot().pendingSequence).toBe("\x1b[?10");
    expect(tracker.ingest("49hpayload").alternateScreen).toBe(true);
    expect(tracker.snapshot().pendingSequence).toBe("");
  });

  it("supports multiple CSI params without modifying payload ownership", () => {
    const tracker = new AlternateScreenStateTracker();
    const payload = "\x1b[?1;1047hhello";

    const before = payload;
    expect(tracker.ingest(payload).alternateScreen).toBe(true);
    expect(payload).toBe(before);
    expect(tracker.ingest("\x1b[?1;1047l").alternateScreen).toBe(false);
  });

  it("bounds malformed CSI buffering", () => {
    const tracker = new AlternateScreenStateTracker();

    tracker.ingest("\x1b[?1234567890123456789012345678901234567890");

    expect(tracker.snapshot().pendingSequence.length).toBeLessThanOrEqual(32);
    expect(tracker.ingest("not-a-final").alternateScreen).toBe(false);
  });

  it("accepts xterm buffer type as authoritative after parser catches up", () => {
    const tracker = new AlternateScreenStateTracker();

    tracker.ingest("\x1b[?1049h");
    expect(tracker.isAlternateScreenActive()).toBe(true);
    tracker.setXtermBufferType("normal");
    expect(tracker.isAlternateScreenActive()).toBe(false);
    tracker.setXtermBufferType("alternate");
    expect(tracker.isAlternateScreenActive()).toBe(true);
  });

  it("leaves state untouched for output that carries no escape byte", () => {
    const tracker = new AlternateScreenStateTracker();

    tracker.ingest("\x1b[?1049h");
    expect(tracker.isAlternateScreenActive()).toBe(true);

    // A plain line cannot change the mode; the fast path must not clear the
    // current state or invent a pending sequence.
    const snapshot = tracker.ingest("plain log output without escapes\n");
    expect(snapshot.alternateScreen).toBe(true);
    expect(snapshot.pendingSequence).toBe("");

    tracker.ingest("\x1b[?1049l");
    expect(tracker.isAlternateScreenActive()).toBe(false);
    expect(tracker.ingest("more plain output").alternateScreen).toBe(false);
  });

  it("still resolves a sequence split across an escape-free chunk", () => {
    const tracker = new AlternateScreenStateTracker();

    expect(tracker.ingest("\x1b[?104").alternateScreen).toBe(false);
    // No ESC in this chunk, but the carried-over partial sequence must be
    // completed rather than skipped by the fast path.
    expect(tracker.ingest("9h").alternateScreen).toBe(true);
    expect(tracker.snapshot().pendingSequence).toBe("");
  });
});
