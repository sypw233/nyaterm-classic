import { sanitizeTerminalCommand } from "@/lib/terminalCommand";

const INTERACTIVE_COMMANDS = new Set([
  "btop",
  "htop",
  "less",
  "man",
  "more",
  "nano",
  "nvim",
  "top",
  "vi",
  "vim",
  "watch",
]);

/**
 * Git subcommands that hand their output to the pager on a terminal.
 *
 * The pager process is `less`, not `git`, and git runs it with `LESS=FRX`, so
 * it stays on the normal screen. Neither the alternate-screen guard nor the
 * known-pager list can see it; the submitted command is the only evidence.
 */
const GIT_PAGED_SUBCOMMANDS = new Set([
  "annotate",
  "blame",
  "diff",
  "grep",
  "help",
  "log",
  "range-diff",
  "reflog",
  "shortlog",
  "show",
  "show-branch",
  "whatchanged",
]);

/** systemd tools only page for their read-only reporting verbs. */
const SYSTEMD_PAGED_SUBCOMMANDS = new Set([
  "cat",
  "help",
  "list-dependencies",
  "list-jobs",
  "list-machines",
  "list-sockets",
  "list-timers",
  "list-unit-files",
  "list-units",
  "show",
  "status",
]);

const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "--attr-source",
  "--config-env",
  "--exec-path",
  "--git-dir",
  "--namespace",
  "--super-prefix",
  "--work-tree",
]);

/**
 * Pager programs that do not consume interactive keys. Setting one of these
 * makes the command non-interactive even though it still writes the same text.
 */
const NON_INTERACTIVE_PAGER_COMMANDS = new Set([
  ":",
  "awk",
  "cat",
  "cut",
  "dd",
  "false",
  "head",
  "nl",
  "sed",
  "tail",
  "tee",
  "tr",
  "true",
  "wc",
]);

const SUDO_OPTION_REQUIRES_VALUE = new Set([
  "-C",
  "-g",
  "-h",
  "-p",
  "-T",
  "-u",
]);

interface CommandSegment {
  text: string;
  /** False once the segment pipes or redirects stdout away from the terminal. */
  stdoutIsTerminal: boolean;
}

/**
 * A `>` outside quotes means stdout no longer reaches the terminal, so a
 * pager-capable command prints straight through. `2>` and `2>&1` only touch
 * stderr and must not count, while `&>` redirects both streams.
 */
function stdoutRedirected(segment: string): boolean {
  let unquoted = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of segment) {
    if (escaped) {
      unquoted += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }

    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    // Quoted text cannot hold a redirect operator.
    unquoted += quote ? "x" : char;
  }

  for (const match of unquoted.matchAll(/(\d*)(&?)>/gu)) {
    if ((match[1] ?? "") === "2") {
      // `2>` / `2>&1` / `2>&-` leave stdout connected to the terminal.
      continue;
    }
    return true;
  }

  return false;
}

function splitCommandSegments(input: string): CommandSegment[] {
  const segments: CommandSegment[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const pushSegment = (stdoutIsTerminal: boolean) => {
    const text = current.trim();
    current = "";
    if (!text) {
      return;
    }
    segments.push({
      text,
      stdoutIsTerminal: stdoutIsTerminal && !stdoutRedirected(text),
    });
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    const next = input[index + 1] ?? "";

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      current += char;
      escaped = true;
      continue;
    }

    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      current += char;
      continue;
    }

    if (char === quote) {
      quote = null;
      current += char;
      continue;
    }

    if (!quote) {
      // `&>` redirects both streams; it is not a background separator.
      if (char === "&" && next === ">") {
        current += char;
        continue;
      }
      // `2>&1`, `>&2`: keep the descriptor duplication inside the segment.
      if (char === "&" && current.endsWith(">")) {
        current += char;
        continue;
      }
      if (char === "|" || char === ";" || char === "&") {
        pushSegment(char !== "|");
        continue;
      }
    }

    current += char;
  }

  pushSegment(true);

  return segments;
}

function tokenizeShellLike(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }

    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (!quote && /\s/u.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function commandName(token: string): string {
  const normalized = token.replace(/\\/gu, "/");
  return (normalized.split("/").pop() ?? normalized)
    .replace(/\.exe$/iu, "")
    .toLowerCase();
}

function skipEnvPrefix(tokens: string[], index: number): number {
  let next = index;
  while (
    next < tokens.length &&
    /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[next] ?? "")
  ) {
    next += 1;
  }
  return next;
}

function skipSudoLike(tokens: string[], index: number): number {
  let next = index + 1;
  while (next < tokens.length) {
    const token = tokens[next] ?? "";
    if (token === "--") {
      return next + 1;
    }
    if (!token.startsWith("-") || token === "-") {
      return next;
    }
    if (SUDO_OPTION_REQUIRES_VALUE.has(token)) {
      next += 2;
    } else {
      next += 1;
    }
  }
  return next;
}

function collectAssignments(
  tokens: string[],
  from: number,
  to: number,
  into: Map<string, string>,
): void {
  for (let index = from; index < to; index += 1) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(tokens[index] ?? "");
    if (match?.[1]) {
      into.set(match[1], match[2] ?? "");
    }
  }
}

function unwrapCommand(tokens: string[]): {
  tokens: string[];
  env: Map<string, string>;
} {
  const env = new Map<string, string>();
  const takeEnv = (from: number) => {
    const next = skipEnvPrefix(tokens, from);
    collectAssignments(tokens, from, next, env);
    return next;
  };

  let index = takeEnv(0);

  while (index < tokens.length) {
    const name = commandName(tokens[index] ?? "");

    if (name === "sudo" || name === "doas") {
      index = skipSudoLike(tokens, index);
      index = takeEnv(index);
      continue;
    }

    if (name === "env") {
      index = takeEnv(index + 1);
      continue;
    }

    if (
      name === "command" ||
      name === "builtin" ||
      name === "exec" ||
      name === "time"
    ) {
      index += 1;
      continue;
    }

    if (name === "nice" || name === "nohup") {
      index += 1;
      while (index < tokens.length && (tokens[index] ?? "").startsWith("-")) {
        index += 1;
      }
      continue;
    }

    break;
  }

  return { tokens: tokens.slice(index), env };
}

function hasOption(
  tokens: string[],
  longName: string,
  shortName?: string,
): boolean {
  return tokens.some(
    (token) => token === longName || (!!shortName && token.includes(shortName)),
  );
}

function pagerIsNonInteractive(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const tokens = tokenizeShellLike(value);
  if (tokens.length === 0) {
    return true;
  }

  return NON_INTERACTIVE_PAGER_COMMANDS.has(commandName(tokens[0] ?? ""));
}

function gitConfigDisabledPager(value: string): boolean {
  const separator = value.indexOf("=");
  if (separator < 0) {
    return false;
  }

  return (
    value.slice(0, separator).trim().toLowerCase() === "core.pager" &&
    pagerIsNonInteractive(value.slice(separator + 1))
  );
}

function gitPagesOutput(tokens: string[], env: Map<string, string>): boolean {
  let index = 1;
  let paginationDisabled = false;

  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (token === "--") {
      index += 1;
      break;
    }
    if (!token.startsWith("-") || token === "-") {
      break;
    }

    if (token === "--no-pager" || token === "-P") {
      paginationDisabled = true;
    } else if (token === "-c") {
      if (gitConfigDisabledPager(tokens[index + 1] ?? "")) {
        paginationDisabled = true;
      }
      index += 2;
      continue;
    } else if (token.startsWith("-c") && token.length > 2) {
      if (gitConfigDisabledPager(token.slice(2))) {
        paginationDisabled = true;
      }
    } else if (token.startsWith("--config-env=")) {
      if (gitConfigDisabledPager(token.slice("--config-env=".length))) {
        paginationDisabled = true;
      }
    } else if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(token)) {
      index += 2;
      continue;
    }

    index += 1;
  }

  if (paginationDisabled) {
    return false;
  }

  const subcommand = (tokens[index] ?? "").toLowerCase();
  if (!subcommand) {
    return false;
  }

  const pagerOverride = env.get("GIT_PAGER") ?? env.get("PAGER");
  if (pagerIsNonInteractive(pagerOverride)) {
    return false;
  }

  if (subcommand === "stash") {
    const action = (tokens[index + 1] ?? "").toLowerCase();
    return action === "list" || action === "show";
  }

  return GIT_PAGED_SUBCOMMANDS.has(subcommand);
}

function commandSegmentStartsInteractiveProgram(
  segment: CommandSegment,
): boolean {
  const { tokens, env } = unwrapCommand(tokenizeShellLike(segment.text));
  const name = commandName(tokens[0] ?? "");
  if (!name) {
    return false;
  }

  if (INTERACTIVE_COMMANDS.has(name)) {
    return true;
  }

  if (name === "git") {
    // The pager only appears when git still owns the terminal's stdout.
    return segment.stdoutIsTerminal && gitPagesOutput(tokens, env);
  }

  if (name === "journalctl") {
    return !hasOption(tokens, "--no-pager");
  }

  if (name === "systemctl" || name === "loginctl") {
    if (hasOption(tokens, "--no-pager")) {
      return false;
    }
    // Only the reporting verbs page; `start`/`enable`/`kill` never do.
    const subcommand = tokens.slice(1).find((token) => !token.startsWith("-"));
    return (
      !!subcommand && SYSTEMD_PAGED_SUBCOMMANDS.has(subcommand.toLowerCase())
    );
  }

  if (name === "tail") {
    return hasOption(tokens, "--follow", "f");
  }

  return false;
}

export function commandStartsSuggestionSuppressingProgram(
  command: string,
): boolean {
  const normalized = sanitizeTerminalCommand(command);
  if (!normalized) {
    return false;
  }

  return splitCommandSegments(normalized).some(
    commandSegmentStartsInteractiveProgram,
  );
}

export function isPagerSearchOrCommandInput(value: string): boolean {
  return /^[/?:]/u.test(value.trimStart());
}

export function isPagerSingleKeyInput(data: string): boolean {
  return [" ", "b", "g", "G", "n", "N", "q"].includes(data);
}
