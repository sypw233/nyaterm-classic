/**
 * Word-level completion for the terminal command line.
 *
 * History only stores whole command lines, so typing `co` after having run
 * `conda deactivate` offered no row: the stored command starts with `conda`,
 * not `co`, and fuzzy-matching the whole line barely scores. What the user
 * actually wants is to complete the word under the cursor, which may be the
 * command (`conda`), a subcommand (`activate`) or any later argument.
 *
 * The approach is deliberately narrow, so it does not fight the existing
 * whole-line history and quick-command providers:
 *
 * - Only the whitespace-delimited token that contains the caret is completed.
 * - Candidates come from the same tokens of previously used commands, so the
 *   user only sees words they have actually typed before.
 * - The popup shows the bare word; selecting it replaces only that token,
 *   leaving the rest of the line untouched.
 *
 * Everything here is pure text handling so it can be unit tested without a
 * terminal, an IPC round trip, or a session.
 */

/** A single token of a command line, with its byte-free character range. */
export interface WordToken {
  /** Token text, quotes removed when the token was fully quoted. */
  text: string;
  /** Start index of the replaceable span within the original line. */
  start: number;
  /** End index (exclusive) of the replaceable span within the original line. */
  end: number;
}

/**
 * Characters the shell treats as word boundaries in addition to whitespace.
 *
 * These are the operators that separate arguments in practice. Including them
 * means `a && b` offers `b` as its own word instead of `&& b`, and `cmd|x`
 * offers `x`.
 */
const WORD_BREAK_CHARS = new Set([" ", "\t", "|", "&", ";", "(", ")", "<", ">"]);

/** Quotes that delimit a token and are not part of the word itself. */
function isQuote(char: string): boolean {
  return char === '"' || char === "'";
}

/**
 * Split a command line into word tokens, recording where each one starts and
 * ends in the original string.
 *
 * Quoted spans are kept as a single token so `echo "a b"` yields `a b`; the
 * returned range still covers the quotes, so replacing the token keeps the
 * line valid.
 */
export function tokenizeCommandLine(line: string): WordToken[] {
  const tokens: WordToken[] = [];
  let index = 0;

  while (index < line.length) {
    // Skip separators between words.
    while (index < line.length && WORD_BREAK_CHARS.has(line[index])) {
      index += 1;
    }
    if (index >= line.length) break;

    const start = index;
    let quote: string | null = null;
    let text = "";

    while (index < line.length) {
      const char = line[index];
      if (quote) {
        if (char === quote) {
          quote = null;
        } else {
          text += char;
        }
        index += 1;
        continue;
      }
      if (isQuote(char)) {
        quote = char;
        index += 1;
        continue;
      }
      if (WORD_BREAK_CHARS.has(char)) break;
      text += char;
      index += 1;
    }

    // An unclosed quote still yields a usable token: the user is mid-typing.
    tokens.push({ text, start, end: index });
  }

  return tokens;
}

/**
 * The token containing (or ending at) the caret, and the text typed so far in
 * it.
 *
 * A caret sitting immediately after a token counts as being in that token, so
 * typing `co` and pressing Tab completes `co`. A caret after a space belongs to
 * the new, still-empty token.
 */
export function tokenAtCursor(
  line: string,
  cursor: number,
): { token: WordToken; prefix: string; index: number } | null {
  const clamped = Math.max(0, Math.min(cursor, line.length));
  const tokens = tokenizeCommandLine(line);

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (clamped >= token.start && clamped <= token.end) {
      // Characters before the caret are already typed; the rest is what a
      // completion would extend. Compute this from the raw line rather than
      // from `token.text`, because the token text has its quotes removed and
      // would misalign the cursor index for quoted words.
      const rawTyped = line.slice(token.start, Math.min(token.end, clamped));
      const prefix = rawTyped.split("").filter((char) => !isQuote(char)).join("");
      return {
        token,
        prefix,
        index: i,
      };
    }
  }

  // Caret sits in whitespace after the last token: complete a fresh word.
  if (clamped > 0 && !WORD_BREAK_CHARS.has(line[clamped - 1])) {
    return null;
  }
  return null;
}

/** Whether a token can be offered as a completion of the typed prefix. */
export function isWordCompletionCandidate(
  candidate: string,
  prefix: string,
  minChars: number,
): boolean {
  if (!candidate || !prefix) return false;
  // Never offer the word back unchanged: there would be nothing to complete.
  if (candidate === prefix) return false;
  if (prefix.length < minChars) return false;
  return candidate.toLowerCase().startsWith(prefix.toLowerCase());
}

/**
 * Collect unique words from previously used command lines, in first-seen order.
 *
 * The first token of a command is its program name and later tokens are
 * subcommands or arguments; both are exactly what should be completable, so no
 * position filter is applied. Duplicates collapse case-insensitively while the
 * first spelling wins, so `conda` does not appear twice because the user ran it
 * in mixed case.
 */
export function collectKnownWords(commands: readonly string[], limit = 2000): string[] {
  const seen = new Set<string>();
  const words: string[] = [];

  for (const command of commands) {
    for (const token of tokenizeCommandLine(command)) {
      const word = token.text.trim();
      if (!word) continue;
      // Flags are handled by the shell's own completion; offering them as word
      // completions would bury real subcommands.
      if (word.startsWith("-")) continue;
      const key = word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      words.push(word);
      if (words.length >= limit) return words;
    }
  }

  return words;
}

/**
 * Replace the token under the caret with `completion`, returning the new line
 * and the caret index that follows the inserted word.
 */
export function applyWordCompletion(
  line: string,
  token: WordToken,
  completion: string,
  preserveQuote?: string,
): { line: string; cursor: number } {
  const replacement =
    preserveQuote === '"' || preserveQuote === "'"
      ? `${preserveQuote}${completion}${preserveQuote}`
      : completion;
  const nextLine = `${line.slice(0, token.start)}${replacement}${line.slice(token.end)}`;
  return { line: nextLine, cursor: token.start + replacement.length };
}

/**
 * The quote character wrapping a token, if it is quoted end to end.
 *
 * Used so completing `"act` keeps the opening quote instead of dropping it.
 */
export function tokenQuote(token: WordToken, line: string): string | undefined {
  const first = line[token.start];
  if (first !== '"' && first !== "'") return undefined;
  const last = line[token.end - 1];
  return last === first ? first : first;
}

/**
 * Keystrokes that rewrite `line` with `token` replaced by `completion`, leaving
 * the caret right after the inserted word.
 *
 * The terminal only accepts input, so the edit is expressed as: move to the end
 * of the line, clear it, retype the whole line, then walk the caret back to the
 * insertion point. Retyping is deliberate — a partial edit would need the shell
 * to interpret cursor movement in the middle of an unsubmitted line, which not
 * every line editor (and none of the Windows consoles) does identically.
 *
 * `CURSOR_LEFT` is the ANSI sequence the input tracker already models, so the
 * tracked cursor stays in sync with what the shell receives.
 */
export function buildWordCompletionKeystrokes(
  line: string,
  token: WordToken,
  completion: string,
  quote?: string,
): string {
  const edited = applyWordCompletion(line, token, completion, quote);
  const backSteps = edited.line.length - edited.cursor;
  return `\u0005\u0015${edited.line}${"\x1b[D".repeat(Math.max(0, backSteps))}`;
}

