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
    // Must start on a fresh line so the frame never lands on the prompt.
    expect(start.startsWith("\r\n")).toBe(true);
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

  it("collapses PowerShell progress fragments from Get-ComputerInfo", () => {
    const output =
      "List of devices attached\rfo\x1b[Kfo\rGet-ComputerIn\rfo\r正在加载处理器信息\r__NT_S_366ec1935c31__\r\n" +
      "List of devices attached\r正在加载网络适配器信息\rGet-ComputerInfo\r__NT_S_366ec1935c31__\r\n" +
      "List of devices attached\rCsName                  : NWVM-051021\r\n" +
      "OsName                  : Microsoft Windows 10 企业版";
    const end = renderAiCommandEnd({
      type: "commandEnd",
      output,
      exitCode: 0,
      durationMs: 2718,
      truncated: false,
    });
    const visible = end.replace(/\x1b\[[0-9;]*m/gu, "");
    // Progress and marker fragments must not appear as scattered rail lines.
    expect(visible).not.toContain("正在加载处理器信息");
    expect(visible).not.toContain("正在加载网络适配器信息");
    expect(visible).not.toContain("__NT_S_");
    expect(visible).toContain("CsName");
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

  it("collapses bare carriage-return progress to its final rendered state", () => {
    const progress = "正在加载操作系统信息...\r正在加载计算机信息...\r主机名: NWVM-051021";
    const end = renderAiCommandEnd({
      type: "commandEnd",
      output: progress,
      exitCode: 0,
      durationMs: 2718,
      truncated: false,
    });
    const visible = end.replace(/\x1b\[[0-9;]*m/gu, "");
    // A real terminal overwrites the row on each bare \r, so only the last
    // rendering must remain visible, not scattered progress fragments.
    expect(visible).toContain("│   主机名: NWVM-051021");
    expect(visible).not.toContain("正在加载操作系统信息");
    expect(visible).not.toContain("正在加载计算机信息");

    const wide = "x".repeat(180);
    const wrapped = renderAiCommandEnd({
      type: "commandEnd",
      output: wide,
      exitCode: 0,
      durationMs: 10,
      truncated: false,
    });
    const visibleWrapped = wrapped.replace(/\x1b\[[0-9;]*m/gu, "");
    expect(visibleWrapped).toContain(`│   ${"x".repeat(100)}`);
    expect(visibleWrapped).toContain(`│   ${"x".repeat(80)}`);
  });
});
