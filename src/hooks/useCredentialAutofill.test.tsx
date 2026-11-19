import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedCredential } from "@/types/global";
import { useCredentialAutofill } from "./useCredentialAutofill";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

const credential: SavedCredential = {
  id: "cred-1",
  sort_order: 0,
  name: "Server Login",
  username: "alice",
  password_prompt_regex: "Password:\\s*$",
  username_prompt_regex: null,
  enabled: true,
  has_password: true,
};

function refs() {
  return {
    terminalRef: { current: null },
    sessionIdRef: { current: "session-1" },
    activeRef: { current: true },
    visibleRef: { current: true },
    performanceModeRef: { current: "normal" },
  };
}

describe("useCredentialAutofill prompt detection gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_saved_credentials") {
        return Promise.resolve([credential]);
      }
      return Promise.resolve(null);
    });
    mocks.listen.mockResolvedValue(vi.fn());
  });

  it("does not detect or retain prompts while the detection gate is closed", async () => {
    let canDetect = false;
    const hookRefs = refs();
    const { result, rerender } = renderHook(() =>
      useCredentialAutofill(
        hookRefs.terminalRef,
        hookRefs.sessionIdRef,
        hookRefs.activeRef,
        hookRefs.visibleRef,
        hookRefs.performanceModeRef,
        () => canDetect,
      ),
    );

    act(() => {
      result.current.feedOutput("Password:");
    });
    expect(result.current.panelState).toBeNull();

    canDetect = true;
    rerender();

    act(() => {
      result.current.feedOutput(" ");
    });

    await waitFor(() => expect(result.current.panelState).toBeNull());
  });

  it("detects a matching prompt when the detection gate is open", async () => {
    const hookRefs = refs();
    const { result } = renderHook(() =>
      useCredentialAutofill(
        hookRefs.terminalRef,
        hookRefs.sessionIdRef,
        hookRefs.activeRef,
        hookRefs.visibleRef,
        hookRefs.performanceModeRef,
        () => true,
      ),
    );

    act(() => {
      result.current.feedOutput("Password:");
    });

    await waitFor(() => {
      expect(result.current.panelState?.kind).toBe("password");
      expect(result.current.panelState?.matches).toEqual([credential]);
    });
  });

  it("throttles prompt scans but still detects a prompt arriving during a burst", async () => {
    const hookRefs = refs();
    const { result } = renderHook(() =>
      useCredentialAutofill(
        hookRefs.terminalRef,
        hookRefs.sessionIdRef,
        hookRefs.activeRef,
        hookRefs.visibleRef,
        hookRefs.performanceModeRef,
        () => true,
      ),
    );

    // A repainting TUI emits many batches in quick succession. The prompt is in
    // the last one, so a trailing scan must still pick it up.
    act(() => {
      result.current.feedOutput("\u001b[2J\u001b[1;1Hworking");
      result.current.feedOutput("\r\nstill working");
      result.current.feedOutput("\r\nPassword:");
    });

    await waitFor(() => {
      expect(result.current.panelState?.kind).toBe("password");
    });
    expect(result.current.panelState?.matches).toEqual([credential]);
  });

  it("drops a pending throttled scan once detection is no longer allowed", async () => {
    let canDetect = true;
    const hookRefs = refs();
    const { result, rerender } = renderHook(() =>
      useCredentialAutofill(
        hookRefs.terminalRef,
        hookRefs.sessionIdRef,
        hookRefs.activeRef,
        hookRefs.visibleRef,
        hookRefs.performanceModeRef,
        () => canDetect,
      ),
    );

    act(() => {
      // The first batch scans immediately; the second falls inside the throttle
      // window and is deferred.
      result.current.feedOutput("working");
      result.current.feedOutput("\r\nPassword:");
    });

    // Close the gate before the deferred scan fires; the stale prompt must not
    // pop the panel afterwards.
    canDetect = false;
    rerender();
    act(() => {
      result.current.feedOutput("x");
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(result.current.panelState).toBeNull();
  });
});
