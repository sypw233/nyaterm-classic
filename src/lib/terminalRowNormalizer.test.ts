import { describe, expect, it } from "vitest";
import { normalizeTerminalOutput, normalizeTerminalRow } from "./terminalRowNormalizer";

describe("terminal row normalization", () => {
  it("leaves ordinary text unchanged", () => {
    expect(normalizeTerminalRow("hello world")).toBe("hello world");
    expect(normalizeTerminalOutput("first\nsecond")).toEqual(["first", "second"]);
  });

  it("collapses bare carriage-return progress to its final rendering", () => {
    expect(normalizeTerminalRow(" 10%\r 99%\r\n")).toBe(" 99%");
    expect(normalizeTerminalRow("aaaaaaaaaa\rbbbb")).toBe("bbbbaaaaaa");
  });

  it("overwrites cells rather than appending after a carriage return", () => {
    expect(normalizeTerminalRow("abcdef\rXY")).toBe("XYcdef");
  });

  it("honours erase-line and cursor-left edits", () => {
    expect(normalizeTerminalRow("abcdef\rXY\x1b[K")).toBe("XY");
    expect(normalizeTerminalRow("abcdef\r\x1b[2KXY")).toBe("XY");
    expect(normalizeTerminalRow("abc\r\x1b[2CX")).toBe("abX");
  });

  it("drops private and malformed control sequences", () => {
    expect(normalizeTerminalRow("\x1b[?25labc")).toBe("abc");
    expect(normalizeTerminalRow("a\x1b[2;3Db")).toBe("b");
    expect(normalizeTerminalRow("\x1b]0;title\x07abc")).toBe("abc");
    expect(normalizeTerminalRow("a\x1b[999999999999999999999Db")).toBe("b");
  });

  it("drops blank rows", () => {
    expect(normalizeTerminalOutput("one\n\n  \r\nthree")).toEqual(["one", "three"]);
  });
});
