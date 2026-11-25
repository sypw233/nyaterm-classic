/**
 * Path completion for the file browser's path input.
 *
 * Completion is a pure text operation over a directory listing: the caller
 * lists the parent directory, this module picks the single candidate that
 * extends what the user typed. Keeping it pure means it can be tested without a
 * backend and reused by any pane that edits a remote or local path.
 */

export interface PathCompletionCandidate {
  name: string;
  /** Directories are the only useful completion target for navigation. */
  isDirectory: boolean;
}

export interface PathCompletionResult {
  /** Replacement text for the whole input. */
  value: string;
  /** True when exactly one candidate was chosen. */
  completed: boolean;
}

function splitPath(input: string): { parent: string; fragment: string; separator: string } {
  const separator = input.includes("\\") && !input.includes("/") ? "\\" : "/";
  const index = input.lastIndexOf(separator);
  if (index < 0) return { parent: "", fragment: input, separator };
  return {
    parent: input.slice(0, index),
    fragment: input.slice(index + 1),
    separator,
  };
}

/**
 * Complete the final path segment against a directory listing.
 *
 * Only directories are considered: completing to a file name would leave the
 * path pointing at a file the browser cannot open as a directory. When several
 * candidates share the typed prefix, the shared prefix is returned so repeated
 * Tab presses keep narrowing instead of picking arbitrarily. A single
 * candidate gets a trailing separator so the next segment can be typed.
 */
export function completePathFragment(
  input: string,
  candidates: readonly PathCompletionCandidate[],
): PathCompletionResult {
  const { parent, fragment, separator } = splitPath(input);
  const directories = candidates.filter((candidate) => candidate.isDirectory);
  const matches = directories.filter((candidate) =>
    candidate.name.toLowerCase().startsWith(fragment.toLowerCase()),
  );
  if (matches.length === 0) return { value: input, completed: false };

  const prefix = `${parent}${parent ? separator : ""}`;
  if (matches.length === 1) {
    return { value: `${prefix}${matches[0].name}${separator}`, completed: true };
  }

  // Longest common prefix of the matching names, case preserved from the first.
  let common = matches[0].name;
  for (const match of matches.slice(1)) {
    let index = 0;
    while (
      index < common.length &&
      index < match.name.length &&
      common[index].toLowerCase() === match.name[index].toLowerCase()
    ) {
      index += 1;
    }
    common = common.slice(0, index);
    if (!common) break;
  }
  if (common.length <= fragment.length) {
    // No further narrowing possible; leave the input alone.
    return { value: input, completed: false };
  }
  return { value: `${prefix}${common}`, completed: false };
}
