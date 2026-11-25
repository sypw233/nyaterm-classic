import { describe, expect, it } from "vitest";
import type { OtpEntry } from "@/types/global";
import { findMatchingOtps, otpMatchesPrompt } from "./otpPromptMatch";

function entry(overrides: Partial<OtpEntry> = {}): OtpEntry {
  return {
    id: "otp-1",
    otp_type: "totp",
    issuer: "Example",
    username: "alice",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    counter: 0,
    prompt_regex: "Verification code:",
    ...overrides,
  };
}

describe("otpMatchesPrompt", () => {
  it("matches only when the entry has a pattern that matches the prompt", () => {
    expect(otpMatchesPrompt(entry(), "Verification code: ")).toBe(true);
    expect(otpMatchesPrompt(entry(), "Password: ")).toBe(false);
  });

  it("never matches without a pattern", () => {
    expect(otpMatchesPrompt(entry({ prompt_regex: undefined }), "Verification code:")).toBe(false);
    expect(otpMatchesPrompt(entry({ prompt_regex: "  " }), "Verification code:")).toBe(false);
  });

  it("ignores an invalid pattern instead of throwing", () => {
    expect(otpMatchesPrompt(entry({ prompt_regex: "(" }), "Verification code:")).toBe(false);
  });
});

describe("findMatchingOtps", () => {
  it("returns only the matching entries in stored order", () => {
    const entries = [
      entry({ id: "a", prompt_regex: "Verification code:" }),
      entry({ id: "b", prompt_regex: "Enter OTP:" }),
      entry({ id: "c", prompt_regex: "Confirmation code:" }),
    ];
    expect(findMatchingOtps(entries, "Enter OTP: ").map((item) => item.id)).toEqual(["b"]);
  });

  it("does not list unrelated entries when nothing matches", () => {
    const entries = [
      entry({ id: "a", prompt_regex: "Verification code:" }),
      entry({ id: "b", prompt_regex: "Enter OTP:" }),
    ];
    expect(findMatchingOtps(entries, "Password: ")).toEqual([]);
  });
});
