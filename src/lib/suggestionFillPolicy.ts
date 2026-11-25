/**
 * Fill policy for command suggestions when input can fan out.
 *
 * Synchronized input (broadcast or group sync) sends the same bytes to every
 * peer session, but each peer's echoed command line may differ from the active
 * one. A suggestion fill that rewrites the active line — backspacing it, or
 * Ctrl-U then retyping — would therefore corrupt the peers. Only a suffix
 * append at the end of the line is safe, because it is the same edit every peer
 * can accept without losing text only the active session has.
 *
 * Suggestions stay visible while routing is shared; only the fill is
 * restricted. This module is pure so the keystroke plans can be tested without
 * a terminal.
 */

export type SuggestionFillPolicy = "rewrite" | "append-only" | "reject";

export interface SuggestionFillInput {
  /** Current tracked command line. */
  line: string;
  /** Caret offset within `line`. */
  cursor: number;
  /** The suggestion the user picked. */
  suggestion: string;
  /** True when input may be delivered to more than one session. */
  mayFanOut: boolean;
}

export interface SuggestionFillPlan {
  policy: SuggestionFillPolicy;
  /** Bytes to send when a plan is allowed. */
  data: string;
}

/**
 * Plan a whole-line suggestion fill.
 *
 * When routing is not shared the historical rewrite is used: backspace the
 * tracked line, then type the suggestion. When routing is shared, only accept
 * a suggestion that extends the line at the end; everything typed so far is
 * already identical on every peer, so appending the missing suffix is safe.
 * A suggestion that would change already-typed text, or a caret in the middle
 * of the line, is rejected rather than rewritten.
 */
export function planSuggestionFill(input: SuggestionFillInput): SuggestionFillPlan {
  const { line, cursor, suggestion, mayFanOut } = input;

  if (!mayFanOut) {
    // Caret at the end: backspace the tracked line and type the suggestion.
    const data =
      cursor === line.length
        ? `${"\x7f".repeat(line.length)}${suggestion}`
        : `\u0005\u0015${suggestion}`;
    return { policy: "rewrite", data };
  }

  const caretAtEnd = cursor === line.length;
  if (!caretAtEnd || !suggestion.startsWith(line)) {
    // Rewriting is unsafe while every keystroke reaches the peers.
    return { policy: "reject", data: "" };
  }

  return { policy: "append-only", data: suggestion.slice(line.length) };
}
