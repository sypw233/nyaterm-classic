import { describe, expect, it } from "vitest";
import {
  detectCredentialPromptKind,
  isDefaultPasswordPrompt,
  mayContainCredentialPrompt,
  stripTerminalControlSequences,
} from "./credentialAutofill";

describe("stripTerminalControlSequences", () => {
  it("returns plain text untouched without allocating a copy", () => {
    const input = "plain output without escapes";
    // Identity, not just equality: the fast path must not copy.
    expect(stripTerminalControlSequences(input)).toBe(input);
  });

  it("still strips ANSI colour codes", () => {
    expect(stripTerminalControlSequences("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("still strips OSC sequences", () => {
    expect(stripTerminalControlSequences("\x1b]0;title\x07text")).toBe("text");
  });
});

describe("mayContainCredentialPrompt", () => {
  it("rejects output without a colon anywhere near the tail", () => {
    expect(mayContainCredentialPrompt("compile finished successfully\n")).toBe(false);
  });

  it("accepts an ASCII colon", () => {
    expect(mayContainCredentialPrompt("Password: ")).toBe(true);
  });

  it("accepts a full-width colon", () => {
    expect(mayContainCredentialPrompt("密码：")).toBe(true);
  });

  it("only inspects the tail", () => {
    // A colon thousands of bytes ago cannot be the prompt terminator.
    const output = `${"x".repeat(2000)}:${"y".repeat(2000)}\n`;
    expect(mayContainCredentialPrompt(output)).toBe(false);
  });
});

describe("detectCredentialPromptKind", () => {
  it("detects a password prompt", () => {
    expect(detectCredentialPromptKind("user@host's password: ")).toBe("password");
  });

  it("detects a username prompt", () => {
    expect(detectCredentialPromptKind("Login: ")).toBe("username");
  });

  it("returns null for output that has no prompt terminator", () => {
    expect(detectCredentialPromptKind("building target\n")).toBeNull();
  });
});

describe("isDefaultPasswordPrompt", () => {
  it("matches password prompts only", () => {
    expect(isDefaultPasswordPrompt("Password: ")).toBe(true);
    expect(isDefaultPasswordPrompt("Login: ")).toBe(false);
  });
});
