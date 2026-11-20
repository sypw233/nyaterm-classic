/**
 * Decide whether a chunk of terminal output contains a real command failure.
 *
 * The previous check was `/\b(error|failed|...)\b/`, which fires on the word
 * appearing anywhere: `cat error.rs`, `git log --grep=error`,
 * `Successfully built error-service`, `INFO error budget: 99.9%`, and every
 * full-screen TUI that happens to show a path or title containing "error".
 *
 * Detection is split into two tiers:
 *
 * - **Strong phrases** are unambiguous on their own (`permission denied`,
 *   `command not found`, …). They are matched anywhere in the line.
 * - **Weak words** (`error`, `failed`, `fatal`) only count when they appear in
 *   a position a shell or compiler actually uses to report a failure: at the
 *   start of a line, or right after a prompt-ish prefix such as `make:` or
 *   `npm ERR!`.
 *
 * Everything else is ignored, including negations (`no error`), zero counts
 * (`0 errors`, `errors: 0`), and identifier/path contexts (`error.rs`,
 * `error-handler`, `/error/`).
 */

/** Phrases that mean failure on their own, wherever they appear. */
const STRONG_PHRASES = [
  "permission denied",
  "no space left on device",
  "connection refused",
  "connection reset by peer",
  "segmentation fault",
  "out of memory",
  "cannot allocate memory",
  "command not found",
  "module not found",
  "port already in use",
  "address already in use",
  "fatal error",
  "unhandled exception",
  "stack trace",
] as const;

/** Words that only indicate failure in a report position. */
const WEAK_WORDS = ["error", "failed", "failure", "fatal"] as const;

/**
 * Report markers that indicate failure without containing a weak word, e.g.
 * npm's `npm ERR!` and make's `*** [target] Error 1`.
 */
const REPORT_MARKERS = ["err!", "*** error", "*** [", "error 1"] as const;

/** A line whose whole shape is a count, not a report: `0 errors`, `errors: 0`. */
const ZERO_COUNT_PATTERN =
  /^(?:0|no|zero)\b[^\n]{0,20}$|^[^\n]{0,20}?[:=\s](?:0|none)\s*$/i;

/**
 * Characters that mean a weak word is part of a longer identifier or path.
 *
 * Note that `:` is deliberately absent: `gcc: error:` puts the word right after
 * a program-name colon, which is a report position, not an identifier.
 */
function isIdentifierChar(char: string | undefined): boolean {
  if (!char) return false;
  return /[A-Za-z0-9_\-./\\~]/.test(char);
}

/**
 * True when `word` occurs in `text` as a standalone word, meaning it is not
 * glued to an identifier, path segment or extension.
 */
function hasStandaloneWord(text: string, word: string): boolean {
  let index = text.indexOf(word);
  while (index !== -1) {
    const before = text[index - 1];
    const after = text[index + word.length];
    if (!isIdentifierChar(before) && !isIdentifierChar(after)) {
      return true;
    }
    index = text.indexOf(word, index + 1);
  }
  return false;
}

/** Strip ANSI/OSC sequences so escape bytes do not break line starts. */
const ANSI_PATTERN =
  /[\u001b\u009b][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;
const OSC_PATTERN = /\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function stripControlSequences(text: string): string {
  return text
    .replace(OSC_PATTERN, "")
    .replace(ANSI_PATTERN, "")
    .replace(CONTROL_PATTERN, "");
}

/**
 * Whether one line looks like a failure report.
 *
 * `line` must already be free of control sequences.
 */
function lineLooksLikeFailure(line: string): boolean {
  const lower = line.toLowerCase();

  // Strong phrases are unambiguous anywhere in the line.
  for (const phrase of STRONG_PHRASES) {
    if (lower.includes(phrase)) return true;
  }

  // A bare count is never a report, even if it contains a weak word.
  if (ZERO_COUNT_PATTERN.test(lower.trim())) return false;

  const trimmed = lower.trimStart();

  // Tool-specific failure markers that carry no weak word of their own:
  // `npm ERR!`, `make: *** [target] Error 1`.
  for (const marker of REPORT_MARKERS) {
    if (trimmed.includes(marker)) return true;
  }

  for (const word of WEAK_WORDS) {
    const wordIndex = trimmed.indexOf(word);
    if (wordIndex === -1 || !hasStandaloneWord(trimmed, word)) continue;

    // Report position: the word opens the line (`error: ...`, `failed to ...`).
    if (trimmed.startsWith(word)) return true;

    // Report prefix: `<program>: error: ...` (gcc, bash, make), or a tool
    // marker such as `npm ERR!` / `make: ***`.
    const before = trimmed.slice(0, wordIndex);
    if (before.includes("***") || /\b(?:err!|fatal:|failed:|failure:)\s*$/u.test(before)) {
      return true;
    }
    // A colon immediately before the word is a report delimiter: `gcc: error:`.
    if (/:\s*$/u.test(before)) return true;
  }

  return false;
}

/**
 * Whether terminal output contains a real failure.
 *
 * Only whole lines are considered, so a weak word in the middle of ordinary
 * prose or a full-screen TUI's status area is not a failure report.
 */
export function hasErrorKeyword(output: string): boolean {
  if (!output) return false;
  const cleaned = stripControlSequences(output);
  if (!cleaned) return false;

  for (const line of cleaned.split(/\r\n|\r|\n/u)) {
    if (lineLooksLikeFailure(line)) return true;
  }
  return false;
}
