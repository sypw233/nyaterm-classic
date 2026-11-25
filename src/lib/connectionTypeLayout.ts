/**
 * Connection type tab layout.
 *
 * The new-connection editor shows one tab per connection type. Users can hide
 * types they never use and reorder the rest. Ordering is a list of ids; any
 * type missing from the list keeps its built-in position after the listed
 * ones, so a setting written by an older version (or one that does not know a
 * newly added type) never hides that type.
 *
 * Unknown ids are ignored rather than dropped, so a layout written by a newer
 * build round-trips safely through an older one.
 */

export interface ConnectionTypeLayoutEntry {
  /** Editor protocol id, e.g. "ssh" or "rdp". */
  id: string;
  visible: boolean;
}

export interface ConnectionTypeLayout {
  /** Ordered entries; the order here is the tab order. */
  entries: ConnectionTypeLayoutEntry[];
}

export const DEFAULT_CONNECTION_TYPE_ORDER = [
  "ssh",
  "local",
  "telnet",
  "serial",
  "rdp",
  "vnc",
] as const;

export type ConnectionTypeId = (typeof DEFAULT_CONNECTION_TYPE_ORDER)[number];

/**
 * Merge a stored layout with the built-in type order.
 *
 * Every built-in id appears exactly once: listed ids keep their stored order
 * and visibility, and ids the stored layout did not mention are appended in
 * their built-in order and treated as visible.
 */
export function resolveConnectionTypeLayout(
  stored: ConnectionTypeLayout | null | undefined,
  builtinOrder: readonly string[] = DEFAULT_CONNECTION_TYPE_ORDER,
): ConnectionTypeLayoutEntry[] {
  const builtin = new Set(builtinOrder);
  const seen = new Set<string>();
  const resolved: ConnectionTypeLayoutEntry[] = [];

  for (const entry of stored?.entries ?? []) {
    if (!entry || !builtin.has(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    resolved.push({ id: entry.id, visible: entry.visible !== false });
  }
  for (const id of builtinOrder) {
    if (seen.has(id)) continue;
    resolved.push({ id, visible: true });
  }
  return resolved;
}

/** Ids that should render tabs, in order. */
export function visibleConnectionTypeIds(
  stored: ConnectionTypeLayout | null | undefined,
  builtinOrder: readonly string[] = DEFAULT_CONNECTION_TYPE_ORDER,
): string[] {
  return resolveConnectionTypeLayout(stored, builtinOrder)
    .filter((entry) => entry.visible)
    .map((entry) => entry.id);
}

/** Toggle one type's visibility without disturbing order. */
export function setConnectionTypeVisible(
  stored: ConnectionTypeLayout | null | undefined,
  id: string,
  visible: boolean,
  builtinOrder: readonly string[] = DEFAULT_CONNECTION_TYPE_ORDER,
): ConnectionTypeLayout {
  const entries = resolveConnectionTypeLayout(stored, builtinOrder).map((entry) =>
    entry.id === id ? { ...entry, visible } : entry,
  );
  return { entries };
}

/** Move one type to a new index, clamping out-of-range targets. */
export function moveConnectionType(
  stored: ConnectionTypeLayout | null | undefined,
  id: string,
  targetIndex: number,
  builtinOrder: readonly string[] = DEFAULT_CONNECTION_TYPE_ORDER,
): ConnectionTypeLayout {
  const entries = resolveConnectionTypeLayout(stored, builtinOrder);
  const from = entries.findIndex((entry) => entry.id === id);
  if (from < 0) return { entries };
  const target = Math.max(0, Math.min(entries.length - 1, Math.trunc(targetIndex)));
  if (target === from) return { entries };
  const [moved] = entries.splice(from, 1);
  entries.splice(target, 0, moved);
  return { entries };
}
