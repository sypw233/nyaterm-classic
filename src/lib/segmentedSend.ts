/**
 * Planning for segmented quick-command delivery.
 *
 * A quick command can be sent all at once (the legacy behaviour), split into
 * lines, or split into individual characters. Each unit after the first waits
 * the configured interval, which gives interactive CLI wizards time to read
 * each answer before the next one arrives.
 */

export type SegmentedSendMode = "line" | "character";

export interface SegmentedSendSettings {
  mode?: SegmentedSendMode;
  interval_ms?: number;
}

export const SEGMENTED_SEND_MAX_INTERVAL_MS = 60_000;
export const SEGMENTED_SEND_LINE_INTERVAL_MS = 1_000;
export const SEGMENTED_SEND_CHARACTER_INTERVAL_MS = 20;

export function defaultIntervalForMode(mode: SegmentedSendMode): number {
  return mode === "character"
    ? SEGMENTED_SEND_CHARACTER_INTERVAL_MS
    : SEGMENTED_SEND_LINE_INTERVAL_MS;
}

/** Normalize a user-entered interval (seconds) to a bounded millisecond value. */
export function normalizeSegmentIntervalMs(intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs < 0) return 0;
  return Math.min(SEGMENTED_SEND_MAX_INTERVAL_MS, Math.round(intervalMs));
}

/**
 * Split command text into units. Line mode preserves each line's own terminator
 * and never invents one for the final line, so a command that ends without a
 * newline is not implicitly submitted. Character mode emits one Unicode code
 * point per unit (not one UTF-16 code unit).
 */
export function planSegmentedUnits(
  text: string,
  settings: SegmentedSendSettings,
): string[] {
  const mode = settings.mode === "character" ? "character" : "line";
  if (mode === "character") return Array.from(text);

  const lines = text.split("\n");
  const units: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const isLast = index === lines.length - 1;
    const line = lines[index];
    if (isLast) {
      if (line.length > 0) units.push(line);
    } else {
      units.push(`${line}\n`);
    }
  }
  return units;
}

export function segmentDelays(unitCount: number, intervalMs: number): number[] {
  const interval = normalizeSegmentIntervalMs(intervalMs);
  return Array.from({ length: unitCount }, (_, index) => (index === 0 ? 0 : interval));
}
