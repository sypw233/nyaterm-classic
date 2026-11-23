import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./invoke", () => ({ invoke: mocks.invoke }));
vi.mock("./backend/runtime", () => ({ runtime: "desktop" }));

import { TerminalInputBatcher } from "./terminalInputBatcher";

describe("TerminalInputBatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("coalesces several keyboard fragments into one batch IPC", async () => {
    const batcher = new TerminalInputBatcher({ sessionId: "s1" });
    batcher.enqueue("h", { preview: null });
    batcher.enqueue("e", { preview: null });
    batcher.enqueue("l", { preview: null });
    batcher.enqueue("l", { preview: null });
    batcher.enqueue("o", { preview: null });
    await batcher.flush();

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("write_to_session_batch", {
      sessionId: "s1",
      inputs: [
        {
          data: "h",
          origin: "keyboard",
          sensitivity: undefined,
          registerSubmission: undefined,
        },
        {
          data: "e",
          origin: "keyboard",
          sensitivity: undefined,
          registerSubmission: undefined,
        },
        {
          data: "l",
          origin: "keyboard",
          sensitivity: undefined,
          registerSubmission: undefined,
        },
        {
          data: "l",
          origin: "keyboard",
          sensitivity: undefined,
          registerSubmission: undefined,
        },
        {
          data: "o",
          origin: "keyboard",
          sensitivity: undefined,
          registerSubmission: undefined,
        },
      ],
    });
  });

  it("flushes queued fragments before an immediate control character", async () => {
    const batcher = new TerminalInputBatcher({ sessionId: "s1" });
    batcher.enqueue("a", { preview: null });
    batcher.enqueue("b", { preview: null });
    await batcher.enqueue("\r", {
      preview: null,
      registerSubmission: "uptime",
    });

    // Three calls: the batched "ab", the submission registration, and the
    // immediate Enter write via the ordinary path (sendSessionInput registers
    // the submission separately from the write).
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    expect(mocks.invoke).toHaveBeenCalledWith("register_command_submission", {
      sessionId: "s1",
      command: "uptime",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("write_to_session", {
      sessionId: "s1",
      data: "\r",
      origin: "keyboard",
      sensitivity: undefined,
    });
  });

  it("keeps control characters out of the batch window", async () => {
    const batcher = new TerminalInputBatcher({ sessionId: "s1" });
    await batcher.enqueue("\x03", { preview: null }); // Ctrl+C
    await batcher.enqueue("\x04", { preview: null }); // Ctrl+D
    await batcher.enqueue("\x1b", { preview: null }); // ESC
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    for (const data of ["\x03", "\x04", "\x1b"]) {
      expect(mocks.invoke).toHaveBeenCalledWith(
        "write_to_session",
        expect.objectContaining({ data }),
      );
    }
  });

  it("uses the ordinary path for a single trailing fragment", async () => {
    const batcher = new TerminalInputBatcher({ sessionId: "s1" });
    batcher.enqueue("x", { preview: null });
    await batcher.flush();

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("write_to_session", {
      sessionId: "s1",
      data: "x",
      origin: "keyboard",
      sensitivity: undefined,
      registerSubmission: undefined,
    });
  });

  it("fans out batched input to sync peers while keeping one primary batch", async () => {
    const batcher = new TerminalInputBatcher({
      sessionId: "s1",
      peerSessionIds: ["p1"],
    });
    batcher.enqueue("a", { preview: null });
    batcher.enqueue("b", { preview: null });
    await batcher.flush();

    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "write_to_session_batch",
      expect.objectContaining({ sessionId: "s1" }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "write_to_session",
      expect.objectContaining({
        sessionId: "p1",
        data: "a",
        origin: "sync_input",
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "write_to_session",
      expect.objectContaining({
        sessionId: "p1",
        data: "b",
        origin: "sync_input",
      }),
    );
  });

  it("observes sync-group changes through the live peers getter", async () => {
    let livePeers: string[] = [];
    const batcher = new TerminalInputBatcher({
      sessionId: "s1",
      getPeerSessionIds: () => livePeers,
    });
    livePeers = ["p2"];
    batcher.enqueue("a", { preview: null });
    batcher.enqueue("b", { preview: null });
    await batcher.flush();

    expect(mocks.invoke).toHaveBeenCalledWith(
      "write_to_session",
      expect.objectContaining({ sessionId: "p2", data: "a", origin: "sync_input" }),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "write_to_session",
      expect.objectContaining({ sessionId: "p1" }),
    );
  });

  it("flushes pending fragments on dispose", async () => {
    const batcher = new TerminalInputBatcher({ sessionId: "s1" });
    batcher.enqueue("a", { preview: null });
    batcher.enqueue("b", { preview: null });
    batcher.dispose();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.invoke).toHaveBeenCalledWith(
      "write_to_session_batch",
      expect.objectContaining({ sessionId: "s1" }),
    );
  });
});
