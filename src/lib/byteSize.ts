/**
 * Byte-size formatting for display.
 *
 * Values are always 1024-based, so the labels are IEC units (`KiB`, `MiB`, …).
 * Labelling 1024-based values as `KB`/`MB` understates the real size by
 * ~2.4% per tier; 2.x switched to IEC labels and the panels here follow suit.
 */

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;

export const NOT_APPLICABLE = "-";

function unitIndex(value: number, unitCount: number): number {
  if (value <= 0) return 0;
  return Math.min(Math.floor(Math.log(value) / Math.log(1024)), unitCount - 1);
}

/** `undefined`/`null` render as `-`; zero renders as `0 B`. */
export function formatBytes(
  bytes: number | null | undefined,
  notApplicable = NOT_APPLICABLE,
): string {
  if (bytes == null || !Number.isFinite(bytes)) return notApplicable;
  if (bytes <= 0) return "0 B";
  const index = unitIndex(bytes, BYTE_UNITS.length);
  const value = bytes / 1024 ** index;
  const precision = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${BYTE_UNITS[index]}`;
}

/** Per-second byte rate, e.g. `1.5 MiB/s`. */
export function formatByteRate(
  bytesPerSec: number | null | undefined,
  notApplicable = NOT_APPLICABLE,
): string {
  if (bytesPerSec == null || !Number.isFinite(bytesPerSec))
    return notApplicable;
  if (bytesPerSec <= 0) return "0 B/s";
  const index = unitIndex(bytesPerSec, BYTE_UNITS.length);
  const value = bytesPerSec / 1024 ** index;
  const precision = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${BYTE_UNITS[index]}/s`;
}

/** `2.0 GiB`-style compact form with one decimal whenever a unit is scaled. */
export function formatBytesCompact(
  bytes: number | null | undefined,
  notApplicable = NOT_APPLICABLE,
): string {
  if (bytes == null || !Number.isFinite(bytes)) return notApplicable;
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  const index = unitIndex(bytes, BYTE_UNITS.length);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(1)} ${BYTE_UNITS[index]}`;
}
