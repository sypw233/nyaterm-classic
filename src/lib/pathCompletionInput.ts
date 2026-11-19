/**
 * Cheap gate in front of the `path_completion_candidates` call.
 *
 * Path completion only ever replaces a non-first token: the parser needs a
 * preceding command word, which means at least one space or tab before the
 * token being completed. Without this check every keystroke of an ordinary
 * command name would cost one IPC round-trip that cannot produce candidates.
 *
 * Oversized lines are dropped here as a fast path; the backend parser also
 * enforces its own byte limit.
 */
export const MAX_PATH_COMPLETION_INPUT_BYTES = 8 * 1024;

export function shouldQueryPathCompletion(input: string): boolean {
  if (!input || input.length > MAX_PATH_COMPLETION_INPUT_BYTES) return false;
  return /[ \t]/.test(input);
}
