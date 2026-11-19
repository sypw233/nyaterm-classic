import { XTERM_PERFORMANCE_CONFIG } from "@/lib/xtermPerformance";

export interface TerminalOutputSchedulerOptions {
  getQueueBytes: () => number;
  isAlternateScreenActive: () => boolean;
  /**
   * Maximum frames per second for repaint-heavy alternate-screen output.
   * 0 disables the cap. Read on every call so a settings change applies without
   * rebuilding the scheduler.
   */
  getAlternateScreenMaxFps?: () => number;
  now?: () => number;
}

export interface TerminalOutputSchedulingSnapshot {
  alternateScreen: boolean;
  queueBytes: number;
  severeBacklog: boolean;
  writeChunkBytes: number;
  foregroundDelayMs: number;
}

export class TerminalOutputScheduler {
  private lastAlternateScreenWriteAt = 0;
  private readonly now: () => number;

  constructor(private readonly options: TerminalOutputSchedulerOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  getWriteChunkBytes() {
    return this.options.isAlternateScreenActive()
      ? XTERM_PERFORMANCE_CONFIG.output.alternateScreenWriteChunkBytes
      : XTERM_PERFORMANCE_CONFIG.output.writeChunkBytes;
  }

  getForegroundDelayMs() {
    if (!this.shouldThrottleAlternateScreen()) return 0;

    const intervalMs = 1000 / this.resolveMaxFps();
    const elapsedMs = this.now() - this.lastAlternateScreenWriteAt;
    return this.lastAlternateScreenWriteAt > 0 && elapsedMs < intervalMs
      ? Math.max(1, intervalMs - elapsedMs)
      : 0;
  }

  noteWriteStart() {
    if (this.options.isAlternateScreenActive()) {
      this.lastAlternateScreenWriteAt = this.now();
    }
  }

  reset() {
    this.lastAlternateScreenWriteAt = 0;
  }

  snapshot(): TerminalOutputSchedulingSnapshot {
    const queueBytes = this.options.getQueueBytes();
    const alternateScreen = this.options.isAlternateScreenActive();
    const severeBacklog =
      alternateScreen &&
      queueBytes > XTERM_PERFORMANCE_CONFIG.output.alternateScreenThrottleBacklogBytes;

    return {
      alternateScreen,
      queueBytes,
      severeBacklog,
      writeChunkBytes: this.getWriteChunkBytes(),
      foregroundDelayMs: this.getForegroundDelayMs(),
    };
  }

  private resolveMaxFps(): number {
    const configured = this.options.getAlternateScreenMaxFps?.();
    // Undefined means "no override": use the built-in default.
    if (configured === undefined) {
      return XTERM_PERFORMANCE_CONFIG.output.alternateScreenMaxWriteFps;
    }
    // Explicit 0 or negative means "no cap".
    return configured;
  }

  /**
   * Alternate-screen repaints are full-screen and therefore the dominant cost
   * on software-rendered hosts. Rate-limit them whenever a cap is configured,
   * not only under heavy backlog: a typical TUI frame is well under the backlog
   * threshold, so a backlog-gated cap never engaged in practice.
   */
  private shouldThrottleAlternateScreen() {
    if (!this.options.isAlternateScreenActive()) return false;
    // A non-positive cap explicitly disables throttling.
    return this.resolveMaxFps() > 0;
  }
}
