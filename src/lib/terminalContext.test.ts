import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SavedConnection,
  SessionInfo,
  TerminalSessionPane,
} from "@/types/global";
import {
  buildAIContext,
  registerTerminalContextProvider,
} from "./terminalContext";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("./invoke", () => ({ invoke: invokeMock }));

const pane: TerminalSessionPane = {
  id: "pane-1",
  kind: "leaf",
  paneKind: "terminal",
  sessionId: "term-1",
  name: "prod",
  type: "SSH",
  connectionId: "conn-1",
};

describe("AI terminal context", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue("/srv/app");
  });

  it("sends selected connection metadata and runtime profile without credential-bearing config", async () => {
    const connection: SavedConnection = {
      id: "conn-1",
      name: "production",
      type: "ssh",
      host: "prod.example",
      port: 2222,
      username: "ops",
      description: "API server",
      tags: ["production"],
      group_id: "api",
      ai_execution_profile: "powershell",
      auth: {
        mode: "password",
        password: "do-not-send-password",
        key_id: "do-not-send-key-reference",
      },
      shell_args: "do-not-send-shell-args",
    };
    const unregister = registerTerminalContextProvider(pane.sessionId, {
      getRecentOutput: () => "output",
      getSelectedText: () => "selected",
      getInputBuffer: () => "input",
      insertCommand: vi.fn(),
      focus: vi.fn(),
    });
    try {
      const context = await buildAIContext({
        pane,
        connection,
        lineLimit: 50,
        sessionInfo: {
          id: pane.sessionId,
          session_type: "SSH",
          ai_execution_profile: "posix",
        } as SessionInfo,
        groups: [
          { id: "prod", name: "Production", sort_order: 0 },
          { id: "api", name: "API", parent_id: "prod", sort_order: 0 },
        ],
      });
      expect(context).toMatchObject({
        connectionName: "production",
        sessionType: "SSH",
        host: "prod.example",
        port: 2222,
        username: "ops",
        description: "API server",
        tags: ["production"],
        groupPath: ["Production", "API"],
        executionProfile: "posix",
        cwd: "/srv/app",
        os: null,
        arch: null,
        kernelVersion: null,
        hostname: null,
        aiSystemPrompt: null,
        recentOutput: "output",
        selectedText: "selected",
        inputBuffer: "input",
      });
      expect(JSON.stringify(context)).not.toContain("do-not-send");
      expect(context).not.toHaveProperty("auth");
    } finally {
      unregister();
    }
  });

  it("passes the saved asset metadata and the per-connection AI prompt", async () => {
    const unregister = registerTerminalContextProvider(pane.sessionId, {
      getRecentOutput: () => "",
      getSelectedText: () => "",
      getInputBuffer: () => "",
      insertCommand: vi.fn(),
      focus: vi.fn(),
    });
    try {
      const context = await buildAIContext({
        pane,
        lineLimit: 50,
        connection: {
          id: "conn-1",
          name: "edge router",
          type: "ssh",
          host: "edge.example",
          username: "admin",
          ai_system_prompt: "This device runs OpenWrt; use busybox tools.",
          asset: {
            os_name: "OpenWrt 23.05",
            architecture: "mips",
            kernel_version: "5.15.150",
            hostname: "edge-01",
          },
        },
      });
      expect(context).toMatchObject({
        os: "OpenWrt 23.05",
        arch: "mips",
        kernelVersion: "5.15.150",
        hostname: "edge-01",
        aiSystemPrompt: "This device runs OpenWrt; use busybox tools.",
      });
    } finally {
      unregister();
    }
  });

  it("leaves collected facts and the custom prompt unset when the connection has none", async () => {
    const context = await buildAIContext({
      pane,
      lineLimit: 50,
      connection: { id: "conn-1", name: "plain", type: "ssh", host: "h" },
    });
    expect(context).toMatchObject({
      os: null,
      arch: null,
      kernelVersion: null,
      hostname: null,
      aiSystemPrompt: null,
    });
  });

  it("keeps unavailable runtime data unknown and ignores obsolete saved execution profiles", async () => {
    invokeMock.mockRejectedValue(new Error("session unavailable"));
    const context = await buildAIContext({
      pane: { ...pane, type: "Local" },
      lineLimit: 50,
      connection: {
        id: "local",
        name: "Local",
        type: "local_terminal",
        shell_path: "pwsh.exe",
        ai_execution_profile: "cmd",
      },
    });
    expect(context).toMatchObject({
      shellPath: "pwsh.exe",
      executionProfile: null,
      cwd: null,
      os: null,
      arch: null,
      aiSystemPrompt: null,
    });
  });

  it("handles serial and unsaved sessions without assuming a network host or Shell", async () => {
    const serial = await buildAIContext({
      pane: { ...pane, type: "Serial" },
      lineLimit: 50,
      connection: {
        id: "serial",
        name: "Switch",
        type: "serial",
        port_name: "COM3",
        baud_rate: 115200,
      },
    });
    expect(serial).toMatchObject({
      sessionType: "Serial",
      serialPort: "COM3",
      baudRate: 115200,
      host: null,
      shellPath: null,
    });
    const unsaved = await buildAIContext({ pane, lineLimit: 50 });
    expect(unsaved).toMatchObject({
      connectionName: "prod",
      sessionType: "SSH",
      description: null,
      groupPath: [],
      tags: [],
      executionProfile: null,
    });
  });
});
