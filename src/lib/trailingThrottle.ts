/**
 * Trailing throttle for repeated, cheap-to-skip work driven by a high-frequency
 * event stream.
 *
 * Terminal output arrives in many small batches: a repainting TUI can produce
 * dozens per second. Re-running prompt detection (ANSI stripping plus regexes)
 * for each batch buys nothing, because a credential prompt is a static line.
 * This keeps detection responsive while capping its rate:
 *
 * - the first request runs immediately, so a prompt is not delayed;
 * - requests inside the window are coalesced into a single trailing run that
 *   observes the newest state;
 * - `cancel` drops any pending run, used when detection stops being allowed.
 */
export interface TrailingThrottleTimers {
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (handle: number) => void;
  now: () => number;
}

function defaultTimers(): TrailingThrottleTimers {
  return {
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (handle) => window.clearTimeout(handle),
    now: () => Date.now(),
  };
}

export class TrailingThrottle {
  private readonly timers: TrailingThrottleTimers;
  private lastRunAt = Number.NEGATIVE_INFINITY;
  private timer: number | null = null;

  constructor(
    private readonly intervalMs: number,
    timers: Partial<TrailingThrottleTimers> = {},
  ) {
    this.timers = { ...defaultTimers(), ...timers };
  }

  /** Run `action` now, or schedule it for the end of the current window. */
  request(action: () => void): void {
    const now = this.timers.now();
    const elapsed = now - this.lastRunAt;
    if (elapsed >= this.intervalMs) {
      this.clearTimer();
      this.lastRunAt = now;
      action();
      return;
    }
    if (this.timer !== null) return;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      this.lastRunAt = this.timers.now();
      action();
    }, this.intervalMs - elapsed);
  }

  /** Drop any pending run without running it. */
  cancel(): void {
    this.clearTimer();
  }

  hasPending(): boolean {
    return this.timer !== null;
  }

  dispose(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}
