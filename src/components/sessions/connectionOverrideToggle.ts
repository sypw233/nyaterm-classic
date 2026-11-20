import type { ConnectionOverrides } from "@/types/global";

/**
 * Set or clear one override field from the editor's on/off switch.
 *
 * Enabling seeds the override with the current global value so the control
 * starts where the user expects. Disabling **deletes** the key instead of
 * writing that value back: writing it would pin the setting to whatever the
 * global happened to be at that moment, and later global changes would silently
 * stop reaching the connection — the exact confusion the override panel exists
 * to prevent.
 */
export function applyOverrideFieldToggle<K extends keyof ConnectionOverrides>(
  overrides: ConnectionOverrides,
  field: K,
  enabled: boolean,
  globalValue: ConnectionOverrides[K],
): ConnectionOverrides {
  const next = { ...overrides };
  if (enabled) {
    next[field] = globalValue;
  } else {
    delete next[field];
  }
  return next;
}
