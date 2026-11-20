/**
 * Simple wall-clock frame rate gate.
 *
 * Used for two things:
 *
 * - Capping repaint speed while the window is unfocused, where the goal is to
 *   keep output progressing (so a long build still advances) without paying
 *   full rendering cost for a window nobody is looking at.
 * - Pausing rendering entirely while unfocused, by reporting "blocked".
 *
 * This deliberately does not use `requestAnimationFrame`: an unfocused window
 * may have its frame callbacks throttled or stopped by the compositor, which
 * would make the cap unpredictable. Wall-clock timing is stable either way.
 */

export interface FrameRateGateOptions {
  /** Target frames per second; values <= 0 disable the gate. */
  fps: number;
  now?: () => number;
}

export class FrameRateGate {
  private readonly now: () => number;
  private fps: number;
  private lastReleaseAt = Number.NEGATIVE_INFINITY;
  private paused = false;

  constructor(options: FrameRateGateOptions = { fps: 0 }) {
    this.fps = options.fps;
    this.now = options.now ?? (() => Date.now());
  }

  configure(fps: number): void {
    this.fps = fps;
  }

  /** When paused, `delayMs` always reports "blocked" until resumed. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    // Leaving a pause should not immediately release a frame; start a fresh
    // interval so resuming does not produce a burst.
    if (!paused) this.lastReleaseAt = this.now();
  }

  /**
   * Milliseconds the caller should wait before the next frame, or `null` when
   * rendering is paused and the caller should not schedule anything.
   */
  delayMs(): number | null {
    if (this.paused) return null;
    if (this.fps <= 0) return 0;

    const interval = 1000 / this.fps;
    const elapsed = this.now() - this.lastReleaseAt;
    return elapsed >= interval ? 0 : Math.max(1, interval - elapsed);
  }

  /** Record that a frame was just rendered. */
  noteFrame(): void {
    this.lastReleaseAt = this.now();
  }

  /**
   * True when a frame may be rendered now. Convenience for callers that poll
   * rather than schedule.
   */
  tryAcquire(): boolean {
    if (this.paused) return false;
    if (this.fps <= 0) {
      this.lastReleaseAt = this.now();
      return true;
    }
    const interval = 1000 / this.fps;
    if (this.now() - this.lastReleaseAt < interval) return false;
    this.lastReleaseAt = this.now();
    return true;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get frameRate(): number {
    return this.fps;
  }
}
