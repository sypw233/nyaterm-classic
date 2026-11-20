const LEADING_ENV_PREFIX = /^\(([^()\r\n]+)\)\s*/u;
const BRACKET_PROMPT_PREFIX = /^\[[^\]\r\n]+\]\s*[#$]\s*/u;
const POSIX_PROMPT_PREFIX = /^[^\s@]+@[^:\s]+:[^#$\r\n]*[#$]\s*/u;
const SIMPLE_POSIX_PROMPT_PREFIX = /^\$[ \t]+/u;
const POWERSHELL_PROMPT_PREFIX = /^PS\s+[^>\r\n]+>\s*/u;
const WINDOWS_PROMPT_PREFIX = /^[A-Za-z]:(?:[\\/][^>\r\n]*)?>\s*/u;
const CLI_PROMPT_PREFIX = /^\S+[ \t]*[#$](?=[ \t]|$)/u;

function stripLeadingEnvPrefixes(input: string): string {
  let remaining = input;

  while (true) {
    const match = remaining.match(LEADING_ENV_PREFIX);
    if (!match) {
      return remaining;
    }
    remaining = remaining.slice(match[0].length);
  }
}

function stripKnownPromptPrefix(input: string): string {
  for (const matcher of [
    BRACKET_PROMPT_PREFIX,
    POSIX_PROMPT_PREFIX,
    SIMPLE_POSIX_PROMPT_PREFIX,
    POWERSHELL_PROMPT_PREFIX,
    WINDOWS_PROMPT_PREFIX,
  ]) {
    const match = input.match(matcher);
    if (match) {
      return input.slice(match[0].length);
    }
  }

  return input;
}

/**
 * Strip a device-style CLI prompt such as `console:/ #` or `switch#`. The
 * prompt is one whitespace-free token ending in `#`/`$`; requiring whitespace
 * or end-of-input after the marker keeps shell text like `echo $DISPLAY` from
 * being misread as a prompt.
 */
function stripCliPromptPrefix(input: string): string | null {
  const match = input.match(CLI_PROMPT_PREFIX);
  if (!match) return null;
  return input.slice(match[0].length).replace(/^[ \t]+/u, "");
}

function stripKnownPromptPrefixWithCli(input: string): string {
  const known = stripKnownPromptPrefix(input);
  if (known !== input) return known;
  return stripCliPromptPrefix(input) ?? input;
}

/** Remove known shell prompt prefixes while preserving command spacing. */
export function stripTerminalCommandPrompt(input: string): string {
  const withoutLeadingWhitespace = input.trimStart();
  if (!withoutLeadingWhitespace.trim()) {
    return "";
  }

  return stripKnownPromptPrefixWithCli(
    stripLeadingEnvPrefixes(withoutLeadingWhitespace),
  );
}

/** Remove known shell prompt prefixes so command parsing stays stable across shells. */
export function sanitizeTerminalCommand(input: string): string {
  const withoutPrompt = stripTerminalCommandPrompt(input);
  return withoutPrompt.trim();
}

/**
 * True when a terminal line holds nothing but a recognizable shell prompt.
 *
 * Used to detect that a pager or full-screen program has exited and the shell
 * is accepting input again. Requiring a known prompt prefix keeps ordinary
 * output lines, which never start with one, from releasing that state.
 */
export function isBareShellPrompt(input: string): boolean {
  const trimmed = input.trimStart();
  if (!trimmed.trim()) {
    return false;
  }

  const match = [
    BRACKET_PROMPT_PREFIX,
    POSIX_PROMPT_PREFIX,
    SIMPLE_POSIX_PROMPT_PREFIX,
    POWERSHELL_PROMPT_PREFIX,
    WINDOWS_PROMPT_PREFIX,
  ].some((matcher) => matcher.test(trimmed));

  // Device-style CLIs (serial/network equipment) use a single token prompt
  // such as `console:/ #` or `switch#`. Recognize the bare form so pressing
  // Enter on an idle device does not learn the prompt as a command, while a
  // typed command after it stays visible and can still be recorded.
  if (!match && CLI_PROMPT_PREFIX.test(trimmed)) {
    return stripCliPromptPrefix(trimmed)?.trim() === "";
  }

  return match && !stripKnownPromptPrefix(trimmed).trim();
}
