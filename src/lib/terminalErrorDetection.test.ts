import { describe, expect, it } from "vitest";
import { hasErrorKeyword } from "./terminalErrorDetection";

describe("hasErrorKeyword: real failures are still detected", () => {
  it.each([
    "bash: foo: command not found",
    "make: *** [Makefile:12: all] Error 1",
    "npm ERR! code ELIFECYCLE",
    "gcc: error: main.c: No such file or directory",
    "fatal: not a git repository",
    "error: could not compile `foo`",
    "failed to connect to the server",
    "mkdir: cannot create directory '/x': Permission denied",
    "Connection refused",
    "Segmentation fault (core dumped)",
    "Out of memory: Killed process 1234",
  ])("detects %s", (line) => {
    expect(hasErrorKeyword(line)).toBe(true);
  });

  it("detects a failure that follows ordinary output", () => {
    const output = ["Building target...", "linking...", "error: undefined symbol foo"].join(
      "\n",
    );
    expect(hasErrorKeyword(output)).toBe(true);
  });
});

describe("hasErrorKeyword: benign occurrences are ignored", () => {
  it.each([
    // Paths, filenames and identifiers
    "src/utils/error.ts               1.2 KB",
    "error.html  error.rs  error_handler.go",
    "cat src/error.rs",
    "Successfully built error-handling-service",
    "Building target 'error-handling'",
    "git log --oneline --grep=error",
    "openai.errors imported",
    // Counts and negations
    "Error: 0  Warn: 0",
    "0 errors, 0 warnings",
    "errors: 0",
    "Running 0 tests, 0 failures",
    "mongo connected, errors: 0",
    "no error",
    "kubectl get pods  # no error",
    // Prose and metadata
    "INFO  error budget remaining: 99.9%",
    "Stored 3 error logs",
    "已处理 error 字段",
    "Searching for errors in documentation...",
  ])("ignores %s", (line) => {
    expect(hasErrorKeyword(line)).toBe(false);
  });
});

describe("hasErrorKeyword: full-screen TUI frames", () => {
  it("ignores a TUI that merely displays a path containing 'error'", () => {
    // Every repaint of the same screen used to fire this.
    const frame = "\x1b[2J\x1b[H~/work/error-service  |  build ok  |  tests 12 passed";
    expect(hasErrorKeyword(frame)).toBe(false);
  });

  it("ignores a window title containing 'error'", () => {
    // OSC titles are stripped before matching, so the path inside must not count.
    const output = "\x1b]2;user@host: ~/projects/error-handling\x07";
    expect(hasErrorKeyword(output)).toBe(false);
  });

  it("ignores a status line that lists an error counter", () => {
    expect(hasErrorKeyword("F1Help  F2Setup  F10Quit   Errors: 0")).toBe(false);
  });

  it("still detects a real failure printed inside a TUI", () => {
    const output = "\x1b[31merror: failed to load config\x1b[0m";
    expect(hasErrorKeyword(output)).toBe(true);
  });
});

describe("hasErrorKeyword: control sequence handling", () => {
  it("ignores escape bytes when checking the start of a line", () => {
    // The colour reset sits before the word; after stripping, "error:" still
    // opens the line.
    expect(hasErrorKeyword("\x1b[0merror: boom")).toBe(true);
  });

  it("returns false for output that is only control sequences", () => {
    expect(hasErrorKeyword("\x1b[2J\x1b[H\x1b[0m")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(hasErrorKeyword("")).toBe(false);
  });
});

describe("hasErrorKeyword: multiple lines", () => {
  it("detects a failure on any line", () => {
    const output = ["ok", "ok", "fatal: refusing to merge unrelated histories"].join("\n");
    expect(hasErrorKeyword(output)).toBe(true);
  });

  it("does not join two benign lines into a false positive", () => {
    const output = ["see src/error.ts", "for details"].join("\n");
    expect(hasErrorKeyword(output)).toBe(false);
  });
});
