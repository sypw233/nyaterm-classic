/**
 * Adaptive repaint cap for full-screen TUI programs.
 *
 * Full-screen programs repaint the entire viewport, and that cost dominates CPU
 * on hosts without GPU acceleration. A fixed cap is a blunt instrument: it
 * penalises a busy program and a quiet one equally. Instead, watch how much the
 * terminal actually repaints and only cap when it stays high.
 *
 * Two hysteresis rules keep this from oscillating:
 *
 * - Engaging requires `highWindows` consecutive samples above the threshold,
 *   so a single full-screen redraw does not trigger it.
 * - Releasing requires the rate to fall below the threshold for
 *   `lowWindows` consecutive samples, so hovering near the threshold does not
 *   flip the cap on and off every sample.
 *
 * The input is the terminal's own repaint rate, not system CPU. System CPU
 * would be polluted by unrelated processes and would create a feedback loop:
 * capping frames lowers CPU, which immediately releases the cap.
 */

export interface AdaptiveFrameLimitOptions {
  /** Repaint rate above which the cap engages, in rows per second. */
  thresholdRowsPerSecond: number;
  /** Frame rate cap applied while engaged. */
  cappedFps: number;
  /** Consecutive high samples required before engaging. */
  highWindows?: number;
  /** Consecutive low samples required before releasing. */
  lowWindows?: number;
}

export interface AdaptiveFrameLimitSnapshot {
  engaged: boolean;
  /** Frame cap currently in effect; 0 means unlimited. */
  activeFps: number;
  /** Most recent observed repaint rate. */
  lastRowsPerSecond: number;
  highStreak: number;
  lowStreak: number;
}

const DEFAULT_HIGH_WINDOWS = 2;
const DEFAULT_LOW_WINDOWS = 3;

export class AdaptiveFrameLimit {
  private readonly highWindows: number;
  private readonly lowWindows: number;
  private engaged = false;
  private lastRowsPerSecond = 0;
  private highStreak = 0;
  private lowStreak = 0;
  private configuredThreshold: number;
  private configuredFps: number;

  constructor(options: AdaptiveFrameLimitOptions) {
    this.configuredThreshold = options.thresholdRowsPerSecond;
    this.configuredFps = options.cappedFps;
    this.highWindows = Math.max(1, options.highWindows ?? DEFAULT_HIGH_WINDOWS);
    this.lowWindows = Math.max(1, options.lowWindows ?? DEFAULT_LOW_WINDOWS);
  }

  /**
   * Update the configured limits. Takes effect on the next sample; changing
   * settings should not immediately flip the current state.
   */
  configure(options: AdaptiveFrameLimitOptions): void {
    this.configuredThreshold = options.thresholdRowsPerSecond;
    this.configuredFps = options.cappedFps;
  }

  /**
   * Feed one sample of the terminal's repaint rate.
   *
   * Returns the frame cap that should be in effect: 0 when uncapped.
   */
  sample(rowsPerSecond: number): number {
    this.lastRowsPerSecond = rowsPerSecond;

    // A non-positive threshold disables adaptation entirely.
    if (this.configuredThreshold <= 0) {
      this.engaged = false;
      this.highStreak = 0;
      this.lowStreak = 0;
      return 0;
    }

    if (rowsPerSecond > this.configuredThreshold) {
      this.highStreak += 1;
      this.lowStreak = 0;
      if (!this.engaged && this.highStreak >= this.highWindows) {
        this.engaged = true;
      }
    } else {
      this.lowStreak += 1;
      this.highStreak = 0;
      if (this.engaged && this.lowStreak >= this.lowWindows) {
        this.engaged = false;
      }
    }

    return this.engaged ? Math.max(1, this.configuredFps) : 0;
  }

  /** Current frame cap without feeding a sample. */
  get activeFps(): number {
    return this.engaged ? Math.max(1, this.configuredFps) : 0;
  }

  snapshot(): AdaptiveFrameLimitSnapshot {
    return {
      engaged: this.engaged,
      activeFps: this.activeFps,
      lastRowsPerSecond: this.lastRowsPerSecond,
      highStreak: this.highStreak,
      lowStreak: this.lowStreak,
    };
  }

  reset(): void {
    this.engaged = false;
    this.lastRowsPerSecond = 0;
    this.highStreak = 0;
    this.lowStreak = 0;
  }
}
