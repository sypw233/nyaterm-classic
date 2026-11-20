/**
 * Friday-night easter egg state.
 *
 * The greeting must show at most once per Friday. We remember the local
 * calendar date when it was last shown in localStorage; a different date makes
 * it eligible again. Keeping this in localStorage rather than AppSettings
 * avoids polluting backups/cloud sync with a purely decorative flag.
 */

const STORAGE_KEY = "nyaterm-friday-easter-egg-shown-on";

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** True when the greeting has already been shown on this local calendar date. */
export function wasFridayEggShownOn(date: Date): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === localDateKey(date);
  } catch {
    return false;
  }
}

/** Mark the greeting as shown for this local calendar date. */
export function markFridayEggShownOn(date: Date): void {
  try {
    localStorage.setItem(STORAGE_KEY, localDateKey(date));
  } catch {
    // Storage may be unavailable (private mode / strict settings). Falling back
    // to "not remembered" only means the greeting can reappear next launch,
    // which is harmless for a decorative easter egg.
  }
}

/** The greeting belongs to Friday night: Friday (day 5), at or after noon. */
export function isFridayNight(now: Date): boolean {
  return now.getDay() === 5 && now.getHours() >= 12;
}

/**
 * Whether the greeting is due now. It must be Friday night, the master switch
 * must be on, and it must not have been shown on this date yet. Calling this
 * records the marker, so the greeting shows once per Friday.
 */
export function consumeFridayEgg(now: Date, eggsEnabled: boolean): boolean {
  if (!eggsEnabled || !isFridayNight(now)) return false;
  if (wasFridayEggShownOn(now)) return false;
  markFridayEggShownOn(now);
  return true;
}

/** Milliseconds from `now` to the next Friday noon (strictly in the future). */
export function msUntilNextFridayNoon(now: Date): number {
  const target = new Date(now);
  // day 5 = Friday. Distance in days from the current weekday to Friday.
  let daysUntilFriday = (5 - now.getDay() + 7) % 7;
  // On Friday before noon, the next trigger is noon today, not next week.
  if (daysUntilFriday === 0 && now.getHours() < 12) {
    target.setHours(12, 0, 0, 0);
    return target.getTime() - now.getTime();
  }
  if (daysUntilFriday === 0) daysUntilFriday = 7;
  target.setDate(now.getDate() + daysUntilFriday);
  target.setHours(12, 0, 0, 0);
  return target.getTime() - now.getTime();
}
