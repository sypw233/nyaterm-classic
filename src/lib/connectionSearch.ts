import type { SavedConnection } from "@/types/global";

/**
 * Text relevance for the saved-connection catalog.
 *
 * Ported from 2.x `nyaterm-core::connection_search`: exact matches rank above
 * prefixes, which rank above substring hits, and a hit on the direct fields
 * (name/host) outranks the same hit in descriptive text. Weight tiers are kept
 * from 2.x so both product lines order results the same way.
 */
export type ConnectionSearchRank = number;

export const NO_SEARCH_RANK: ConnectionSearchRank = 0;

const DIRECT_WEIGHTS = [1000, 900, 800] as const;
const TAG_WEIGHTS = [500, 450, 400] as const;
const GROUP_WEIGHTS = [350, 325, 300] as const;
const KIND_WEIGHTS = [250, 225, 200] as const;
const DESCRIPTION_WEIGHTS = [150, 125, 100] as const;
const ID_WEIGHTS = [75, 50, 25] as const;

export function normalizeConnectionSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

function textRank(
  text: string | null | undefined,
  query: string,
  weights: readonly number[],
): number {
  if (!text) return NO_SEARCH_RANK;
  const value = text.toLowerCase();
  if (value === query) return weights[0];
  if (value.startsWith(query)) return weights[1];
  if (value.includes(query)) return weights[2];
  return NO_SEARCH_RANK;
}

/** Rank of a group name, or 0 when this group itself does not match. */
export function rankGroupName(name: string, query: string): number {
  const normalized = normalizeConnectionSearchQuery(query);
  return normalized
    ? textRank(name, normalized, GROUP_WEIGHTS)
    : NO_SEARCH_RANK;
}

/**
 * Highest rank inherited from the group path. A group hit promotes its whole
 * subtree, matching 2.x behaviour, so a connection inside a matching group is
 * found even when its own fields do not contain the query.
 */
export function rankConnection(
  connection: SavedConnection,
  query: string,
  groupRank = NO_SEARCH_RANK,
): ConnectionSearchRank | null {
  const normalized = normalizeConnectionSearchQuery(query);
  if (!normalized) return NO_SEARCH_RANK;

  const tagRank = (connection.tags ?? []).reduce(
    (best, tag) => Math.max(best, textRank(tag, normalized, TAG_WEIGHTS)),
    NO_SEARCH_RANK,
  );

  const haystack = [
    connection.name,
    connection.host,
    connection.username,
    connection.description,
    connection.group_id ?? "",
    connection.tags?.join(" ") ?? "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    groupRank === NO_SEARCH_RANK &&
    tagRank === NO_SEARCH_RANK &&
    !haystack.includes(normalized)
  ) {
    return null;
  }

  let rank = Math.max(groupRank, tagRank, 1);
  for (const [text, weights] of [
    [connection.name, DIRECT_WEIGHTS],
    [connection.host, DIRECT_WEIGHTS],
    [connection.port_name, KIND_WEIGHTS],
    [connection.type, KIND_WEIGHTS],
    [connection.username, DESCRIPTION_WEIGHTS],
    [connection.description, DESCRIPTION_WEIGHTS],
    [connection.id, ID_WEIGHTS],
  ] as const) {
    rank = Math.max(rank, textRank(text, normalized, weights));
  }
  return rank;
}

/**
 * Stable relevance ordering. Records that do not match are dropped when a
 * query is present, and ties keep the caller's existing order.
 */
export function sortByConnectionRelevance<T>(
  records: readonly T[],
  query: string,
  getConnection: (record: T) => SavedConnection,
  getGroupRank?: (record: T) => number,
): T[] {
  const normalized = normalizeConnectionSearchQuery(query);
  if (!normalized) return [...records];

  const scored: { record: T; rank: number; index: number }[] = [];
  records.forEach((record, index) => {
    const rank = rankConnection(
      getConnection(record),
      normalized,
      getGroupRank?.(record) ?? NO_SEARCH_RANK,
    );
    if (rank !== null) scored.push({ record, rank, index });
  });

  scored.sort(
    (left, right) => right.rank - left.rank || left.index - right.index,
  );
  return scored.map((item) => item.record);
}
