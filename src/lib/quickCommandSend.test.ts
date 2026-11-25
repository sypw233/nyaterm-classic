import { describe, expect, it, vi } from "vitest";
import type { SendSessionInputOptions } from "@/lib/sessionInput";

const { sendSessionInputMock, sendSessionInputWithSyncMock } = vi.hoisted(() => ({
  sendSessionInputMock: vi.fn(),
  sendSessionInputWithSyncMock: vi.fn(),
}));

vi.mock("@/lib/sessionInput", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sessionInput")>(
    "@/lib/sessionInput",
  );
  return {
    ...actual,
    sendSessionInput: sendSessionInputMock,
    sendSessionInputWithSync: sendSessionInputWithSyncMock,
  };
});

import { sendQuickCommand } from "./quickCommandSend";
import { SEGMENTED_SEND_MAX_UNITS } from "./segmentedSend";

const target = { sessionId: "s1", peerSessionIds: [] };
const options: SendSessionInputOptions = { preview: null };

describe("sendQuickCommand", () => {
  it("sends the whole command at once without segmented settings", async () => {
    sendSessionInputMock.mockReset();
    await sendQuickCommand(target, "ls -la", true, undefined, options);
    expect(sendSessionInputMock).toHaveBeenCalledTimes(1);
    expect(sendSessionInputMock).toHaveBeenCalledWith("s1", "ls -la\r", options);
  });

  it("delivers each line with a delay and preserves line terminators", async () => {
    sendSessionInputMock.mockReset();
    const sleeps: number[] = [];
    await sendQuickCommand(target, "yes\nno\n", true, { mode: "line", interval_ms: 25 }, options, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(sendSessionInputMock.mock.calls.map((call) => call[1])).toEqual([
      "yes\n",
      "no\n",
    ]);
    expect(sleeps).toEqual([25]);
  });

  it("delivers each character separately in character mode", async () => {
    sendSessionInputMock.mockReset();
    const sleeps: number[] = [];
    await sendQuickCommand(target, "ab", true, { mode: "character", interval_ms: 10 }, options, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(sendSessionInputMock.mock.calls.map((call) => call[1])).toEqual([
      "a",
      "b",
    ]);
    expect(sleeps).toEqual([10]);
  });

  it("stops before the next unit when the send is cancelled", async () => {
    sendSessionInputMock.mockReset();
    let delivered = 0;
    sendSessionInputMock.mockImplementation(async () => {
      delivered += 1;
    });
    await sendQuickCommand(target, "abc", true, { mode: "character", interval_ms: 1 }, options, {
      isCancelled: () => delivered >= 1,
      sleep: async () => {},
    });
    // First unit is delivered, then cancellation is observed before unit two.
    expect(sendSessionInputMock).toHaveBeenCalledTimes(1);
    expect(sendSessionInputMock).toHaveBeenCalledWith("s1", "a", expect.anything());
  });

  it("refuses an oversized segmented plan", async () => {
    sendSessionInputMock.mockReset();
    const huge = "a".repeat(SEGMENTED_SEND_MAX_UNITS + 1);
    await expect(
      sendQuickCommand(target, huge, true, { mode: "character", interval_ms: 1 }, options),
    ).rejects.toThrow(/limit/);
    expect(sendSessionInputMock).not.toHaveBeenCalled();
  });

  it("uses the synced delivery path when peer sessions are present", async () => {
    sendSessionInputWithSyncMock.mockReset();
    sendSessionInputMock.mockReset();
    await sendQuickCommand(
      { sessionId: "s1", peerSessionIds: ["s2"] },
      "x",
      true,
      undefined,
      options,
    );

    expect(sendSessionInputWithSyncMock).toHaveBeenCalledWith(
      "s1",
      "x\r",
      ["s2"],
      options,
    );
    expect(sendSessionInputMock).not.toHaveBeenCalled();
  });
});
