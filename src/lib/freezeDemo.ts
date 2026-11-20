/**
 * Freeze-demo easter egg.
 *
 * Blocks the UI thread with a deliberately busy loop so the window becomes
 * genuinely unresponsive for the configured duration, then recovers on its
 * own. The loop checks its own deadline: while the thread is blocked, timers
 * and events cannot run, so a setTimeout-based release would never fire.
 */

export const FREEZE_MIN_MS = 500;
export const FREEZE_MAX_MS = 30_000;
export const FREEZE_DEFAULT_MS = 3000;

/** Clamp a configured duration into the supported range. */
export function normalizeFreezeMs(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return FREEZE_DEFAULT_MS;
  return Math.min(FREEZE_MAX_MS, Math.max(FREEZE_MIN_MS, Math.round(n)));
}

/**
 * Busy-wait on the current thread for roughly `ms` milliseconds.
 * Uses Date.now() so it works regardless of high-resolution timer behaviour.
 */
export function blockMainThread(ms: number): void {
  const duration = normalizeFreezeMs(ms);
  const deadline = Date.now() + duration;
  while (Date.now() < deadline) {
    // Deliberately empty: the goal is to keep the thread busy.
  }
}
