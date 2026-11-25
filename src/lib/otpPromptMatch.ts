import type { OtpEntry } from "@/types/global";

/**
 * Matching of stored OTP entries against terminal prompts.
 *
 * An OTP can be suggested during credential entry when its own optional
 * prompt pattern matches the remote prompt. The code is never stored in the
 * suggestion: only the entry is offered, and the current code is generated at
 * selection time through the existing sensitive input path, so it does not
 * enter history, sync, or recordings.
 */

export function compileOtpPromptRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "im");
  } catch {
    return null;
  }
}

export function otpMatchesPrompt(entry: OtpEntry, prompt: string): boolean {
  const pattern = entry.prompt_regex?.trim();
  if (!pattern) return false;
  const regex = compileOtpPromptRegex(pattern);
  if (!regex) return false;
  return regex.test(prompt);
}

/** OTP entries whose own pattern matches, in stored order. */
export function findMatchingOtps(entries: readonly OtpEntry[], prompt: string): OtpEntry[] {
  return entries.filter((entry) => otpMatchesPrompt(entry, prompt));
}
