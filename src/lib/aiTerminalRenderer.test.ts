import { describe, expect, it } from "vitest";
import { renderAiCommandEnd, renderAiCommandStart } from "./aiTerminalRenderer";

describe("AI command terminal rendering", () => {
  it("labels the source, step and INPUT section in the start block", () => {
    const start = renderAiCommandStart({
      type: "commandStart",
      command: "echo ok",
      stepIndex: 0,
    });
    expect(start).toContain("AI #1");
    expect(start).toContain("INPUT");
    expect(start).toContain("$ echo ok");
  });

  it("labels external MCP commands with their step", () => {
    const start = renderAiCommandStart({
      type: "commandStart",
      command: "echo ok",
      stepIndex: 1,
      source: "MCP",
    });
    expect(start).toContain("MCP #2");
  });

  it("renders output and a success status in the end block", () => {
    const end = renderAiCommandEnd({
      type: "commandEnd",
      output: "first\nsecond",
      exitCode: 0,
      durationMs: 1200,
      truncated: false,
    });
    expect(end).toContain("OUTPUT");
    expect(end).toContain("first");
    expect(end).toContain("second");
    expect(end).toContain("✓ success");
    expect(end).toContain("1.2s");
  });

  it("marks non-zero exits and truncation", () => {
    const end = renderAiCommandEnd({
      type: "commandEnd",
      output: "line",
      exitCode: 2,
      durationMs: 700,
      truncated: true,
    });
    expect(end).toContain("✗ exit 2");
    expect(end).toContain("output truncated");
    expect(end).toContain("700ms");
  });

  it("shows a placeholder when there is no output", () => {
    const end = renderAiCommandEnd({
      type: "commandEnd",
      output: "",
      exitCode: 0,
      durationMs: 5,
      truncated: false,
    });
    expect(end).toContain("(no output)");
  });
});
