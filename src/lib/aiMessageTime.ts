/**
 * Formatting for AI message timestamps.
 *
 * Messages store `createdAt` as an RFC3339 timestamp. The panel shows local
 * wall-clock time and keeps the date for messages that are not from today, so
 * an old answer is not mistaken for a fresh one.
 */
export function formatAiMessageTime(
  createdAt: string,
  now: Date = new Date(),
): string | null {
  if (!createdAt) return null;
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return null;

  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  const time = `${hours}:${minutes}`;

  const sameDay =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();
  if (sameDay) return time;

  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const year =
    parsed.getFullYear() === now.getFullYear() ? "" : `${parsed.getFullYear()}-`;
  return `${year}${month}-${day} ${time}`;
}
