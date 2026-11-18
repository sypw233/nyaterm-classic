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

/**
 * True when an unquoted `|` joins commands; the right side then reads a pipe,
 * not a terminal, so it cannot open an interactive shell.
 */
function hasUnquotedPipe(input: string): boolean {
  const chars = [...input];
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "|" && chars[index + 1] !== "|" && chars[index - 1] !== "|") {
      return true;
    }
  }

  return false;
}

/**
 * Positional arguments, skipping options and the values of `withValue`
 * options, plus whether a `--` ended option parsing.
 */
function positionals(
  tokens: string[],
  withValue: readonly string[],
): { values: string[]; dashdash: boolean } {
  const values: string[] = [];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (token === "--") {
      return { values, dashdash: true };
    }
    if (withValue.includes(token)) {
      index += 2;
      continue;
    }
    if (token.startsWith("-") && token !== "-") {
      index += 1;
      continue;
    }
    values.push(token);
    index += 1;
  }

  return { values, dashdash: false };
}

function shortClusterHas(token: string, letters: string): boolean {
  if (!token.startsWith("-") || token.startsWith("--") || token.length <= 1) {
    return false;
  }
  const cluster = token.slice(1);
  return /^[A-Za-z]+$/u.test(cluster) && [...cluster].some((char) => letters.includes(char));
}

function containerExecIsInteractive(
  args: string[],
  short: string,
  long: readonly string[],
): boolean {
  return args.some(
    (token) =>
      long.includes(token) || (shortClusterHas(token, short) && !shortClusterHas(token, "d")),
  );
}

function segmentEntersForeignShell(segment: string): boolean {
  const { tokens } = unwrapCommand(tokenizeShellLike(segment));
  const first = tokens[0] ?? "";
  const name = commandName(first).replace(/\.exe$/u, "");
  const args = tokens.slice(1);
  const subcommands = args.filter((token) => !token.startsWith("-"));
  const sub = subcommands[0];

  switch (name) {
    // A remote command (`ssh host uptime`) or a forward-only flag returns to
    // the local prompt by itself, so only a bare `ssh host` opens a shell.
    case "ssh": {
      const value = [
        "-b", "-c", "-D", "-E", "-e", "-F", "-I", "-i", "-J", "-L", "-l", "-m", "-O", "-o",
        "-p", "-Q", "-R", "-S", "-W", "-w", "-B",
      ];
      const batch = args.some((token) =>
        ["-N", "-f", "-W", "-O", "-G", "-Q", "-V", "-s"].includes(token),
      );
      return !batch && positionals(args, value).values.length === 1;
    }
    case "mosh": {
      const value = ["--ssh", "--port", "-p", "--predict", "--family", "--server"];
      const parsed = positionals(args, value);
      return !parsed.dashdash && parsed.values.length === 1;
    }
    case "telnet":
      return positionals(args, ["-l", "-e", "-b", "-s"]).values.length > 0;
    case "docker":
    case "podman":
    case "nerdctl": {
      const verb = sub === "container" ? subcommands[1] : sub;
      return (
        (verb === "exec" || verb === "run" || verb === "attach") &&
        containerExecIsInteractive(args, "it", ["--interactive", "--tty"])
      );
    }
    case "kubectl":
    case "oc":
      if (sub === "rsh") return true;
      if (sub === "exec" || sub === "debug" || sub === "run") {
        return containerExecIsInteractive(args, "it", ["--stdin", "--tty"]);
      }
      return false;
    case "lxc":
    case "incus":
      return sub === "exec" || sub === "shell";
    case "machinectl":
      return sub === "shell" || sub === "login";
    case "multipass":
    case "limactl":
    case "distrobox":
    case "toolbox":
      return sub === "shell" || sub === "enter";
    case "vagrant":
      return sub === "ssh" && !hasOption(args, "--command", "-c");
    case "nsenter":
      return true;
    case "chroot":
      return positionals(args, []).values.length === 1;
    case "wsl": {
      const management = new Set([
        "-l", "--list", "--shutdown", "-t", "--terminate", "--install", "--update", "--status",
        "--version", "-v", "--set-default", "-s", "--set-version", "--unregister", "--export",
        "--import", "--mount", "--unmount", "-e", "--exec", "--help", "--manage",
        "--import-in-place", "--set-default-version",
      ]);
      const parsed = positionals(args, ["-d", "--distribution", "-u", "--user", "--cd"]);
      return (
        !parsed.dashdash &&
        !args.some((token) => management.has(token)) &&
        parsed.values.every((value) => value.startsWith("~"))
      );
    }
    case "adb":
      return positionals(args, ["-s", "-t", "-H", "-P", "-L"]).values.join(" ") === "shell";
    default:
      return false;
  }
}

/**
 * How many interactive shells on another host, container or distro this
 * submitted command line opens.
 *
 * Same-host switches (`su`, `sudo -i`, `bash`) do not count: the file system
 * the suggestions list stays the same. Neither do commands that return by
 * themselves (`ssh host cmd`, `ssh -N`, piped or backgrounded ssh).
 */
export function commandEntersForeignShell(command: string): number {
  const normalized = sanitizeTerminalCommand(command);
  if (!normalized) {
    return 0;
  }
  if (hasUnquotedPipe(normalized) || (normalized.endsWith("&") && !normalized.endsWith("&&"))) {
    return 0;
  }

  return splitCommandSegments(normalized).filter((segment) =>
    segmentEntersForeignShell(segment.text),
  ).length;
}

/** True when the submitted line ends the current shell (`exit`, `logout`). */
export function commandLeavesShell(command: string): boolean {
  return splitCommandSegments(sanitizeTerminalCommand(command)).some((segment) => {
    const { tokens } = unwrapCommand(tokenizeShellLike(segment.text));
    const name = commandName(tokens[0] ?? "");
    return name === "exit" || name === "logout";
  });
}

/**
 * Interactive shells a session opened on another host, container or distro.
 *
 * Path suggestions list the session's own file system, which is the wrong one
 * while this is non-zero. The depth survives a line reset: a password prompt or
 * alternate screen inside the nested shell must not make the outer host's
 * files look current.
 */
export class ForeignShellTracker {
  /** A bound keeps a runaway chain from overflowing; real nesting is shallow. */
  static readonly MAX_DEPTH = 8;

  private depth = 0;
  /** Prompt prefix of the outermost shell, to notice a return without `exit`. */
  private outerPrompt: string | null = null;

  isActive(): boolean {
    return this.depth > 0;
  }

  getDepth(): number {
    return this.depth;
  }

  enter(count: number, outerPrompt?: string | null): void {
    if (count <= 0) return;
    if (this.depth === 0) {
      const prompt = outerPrompt?.trim();
      this.outerPrompt = prompt ? (outerPrompt ?? null) : null;
    }
    this.depth = Math.min(ForeignShellTracker.MAX_DEPTH, this.depth + Math.trunc(count));
  }

  /** `exit`, `logout`, or Ctrl+D on an empty line. */
  leave(): void {
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth === 0) {
      this.outerPrompt = null;
    }
  }

  reset(): void {
    this.depth = 0;
    this.outerPrompt = null;
  }

  /**
   * The outermost shell's prompt is back on screen: the nested shell ended or
   * never started. Prompts that differ keep the guard on.
   */
  notePrompt(prompt: string): void {
    if (this.depth > 0 && this.outerPrompt !== null && this.outerPrompt === prompt) {
      this.reset();
    }
  }
}

