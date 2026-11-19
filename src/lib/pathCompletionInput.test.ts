import { describe, expect, it } from "vitest";
import { shouldQueryPathCompletion } from "./pathCompletionInput";

describe("shouldQueryPathCompletion", () => {
  it("skips the first word of a line", () => {
    // A path completion always replaces a later token; the first word is the
    // command name.
    expect(shouldQueryPathCompletion("")).toBe(false);
    expect(shouldQueryPathCompletion("cd")).toBe(false);
    expect(shouldQueryPathCompletion("/usr/bin")).toBe(false);
  });

  it("queries once a second token can exist", () => {
    expect(shouldQueryPathCompletion("cd ")).toBe(true);
    expect(shouldQueryPathCompletion("cd /var/li")).toBe(true);
    expect(shouldQueryPathCompletion("ls\t")).toBe(true);
  });

  it("rejects oversized pasted lines", () => {
    expect(shouldQueryPathCompletion(`cd ${"a".repeat(9 * 1024)}`)).toBe(false);
  });
});
