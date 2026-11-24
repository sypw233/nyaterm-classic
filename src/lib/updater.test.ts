import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  invoke: vi.fn(),
  close: vi.fn(),
  updateDownload: vi.fn(),
  updateInstall: vi.fn(),
  relaunch: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/backend/runtime", () => ({
  supports: () => true,
  requireCapability: () => {},
}));
vi.mock("@tauri-apps/api/core", () => ({ Channel: class {} }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.logInfo, warn: mocks.logWarn, error: mocks.logError },
}));

import {
  checkForUpdate,
  downloadUpdate,
  getUpdaterState,
  installUpdate,
  subscribeUpdater,
} from "./updater";

function fakeUpdate(version = "9.9.9") {
  return {
    version,
    date: "2026-11-24",
    body: "notes",
    close: mocks.close,
    download: mocks.updateDownload,
    install: mocks.updateInstall,
  };
}

describe("updater background flow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.updateDownload.mockResolvedValue(undefined);
    mocks.updateInstall.mockResolvedValue(undefined);
    mocks.relaunch.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
    mocks.check.mockResolvedValue(fakeUpdate());
  });

  it("moves from checking to available and then ready after download only", async () => {
    const info = await checkForUpdate(false);
    expect(info?.version).toBe("9.9.9");
    expect(getUpdaterState().status).toBe("available");

    await downloadUpdate();
    expect(getUpdaterState().status).toBe("ready");
    // Download must not install — the user is prompted to restart first.
    expect(mocks.updateInstall).not.toHaveBeenCalled();
    expect(mocks.updateDownload).toHaveBeenCalledOnce();
  });

  it("installs only when the user confirms", async () => {
    await checkForUpdate(false);
    await downloadUpdate();
    await installUpdate();
    expect(mocks.updateInstall).toHaveBeenCalledOnce();
  });

  it("notifies subscribers on state changes", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUpdater(listener);
    await checkForUpdate(false);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    const count = listener.mock.calls.length;
    await downloadUpdate();
    expect(listener).toHaveBeenCalledTimes(count);
  });

  it("swallows failures on silent checks", async () => {
    mocks.check.mockRejectedValueOnce(new Error("offline"));
    await expect(checkForUpdate(false, true)).resolves.toBeNull();
    expect(getUpdaterState().status).toBe("idle");
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it("surfaces failures on manual checks", async () => {
    mocks.check.mockRejectedValueOnce(new Error("offline"));
    await expect(checkForUpdate(false)).rejects.toThrow("offline");
    expect(getUpdaterState().status).toBe("error");
  });

  it("uses the portable commands for portable builds", async () => {
    mocks.invoke.mockResolvedValueOnce({ version: "9.9.9" });
    await checkForUpdate(true);
    expect(mocks.invoke).toHaveBeenCalledWith("check_portable_update");
    await downloadUpdate();
    expect(mocks.invoke).toHaveBeenCalledWith(
      "download_portable_update",
      expect.objectContaining({ onProgress: expect.anything() }),
    );
    expect(getUpdaterState().status).toBe("ready");
  });
});
