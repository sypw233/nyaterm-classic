import type { FuzzyResult } from "@/types/global";

/** Rows kept in the popup after all providers are merged. */
export const COMMAND_SUGGESTION_LIMIT = 12;

/**
 * Merge suggestion providers into one ranked list.
 *
 * Path rows already carry the whole replacement line and are scored far above
 * history and catalog rows once the user typed a directory part, so ordering by
 * score alone puts them first exactly when they are useful. Duplicate commands
 * collapse to the highest-scoring provider, and the list is capped so a large
 * directory cannot crowd out history.
 */
export function mergeCommandSuggestions(
  providers: FuzzyResult[][],
  limit = COMMAND_SUGGESTION_LIMIT,
): FuzzyResult[] {
  const best = new Map<string, FuzzyResult>();
  for (const provider of providers) {
    for (const result of provider) {
      const existing = best.get(result.command);
      if (!existing || result.score > existing.score) {
        best.set(result.command, result);
      }
    }
  }
  return [...best.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
