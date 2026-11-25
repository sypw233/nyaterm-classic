import { supports, requireCapability } from "./backend/runtime";
import { Channel } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@/lib/invoke";
import { logger } from "@/lib/logger";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installed"
  | "error";

export interface UpdateProgress {
  downloaded: number;
  total: number;
}

export interface UpdateInfo {
  version: string;
  date?: string;
  body?: string;
}

/**
 * Process-wide updater state. Kept outside React so a background download
 * started on startup survives the update dialog opening/closing, and so a new
 * check invalidates progress from an older one (generation guard).
 */
interface UpdaterState {
  /** Monotonic id; stale results from an older generation are discarded. */
  generation: number;
  status: UpdateStatus;
  info: UpdateInfo | null;
  progress: UpdateProgress;
  error: string;
  portable: boolean;
  /** The `Update` resource must stay alive between download() and install(). */
  update: Update | null;
}

const state: UpdaterState = {
  generation: 0,
  status: "idle",
  info: null,
  progress: { downloaded: 0, total: 0 },
  error: "",
  portable: false,
  update: null,
};

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeUpdater(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUpdaterState(): Readonly<UpdaterState> {
  return state;
}

function resetState(portable: boolean) {
  state.generation += 1;
  state.status = "checking";
  state.info = null;
  state.progress = { downloaded: 0, total: 0 };
  state.error = "";
  state.portable = portable;
  // Close the previous Update resource before replacing it.
  const previous = state.update;
  state.update = null;
  if (previous) void previous.close().catch(() => {});
  notify();
}

/** Check for an update and cache it. `silent` failures are swallowed. */
export async function checkForUpdate(
  portable = false,
  silent = false,
): Promise<UpdateInfo | null> {
  if (!supports("updater")) return null;
  const generation = state.generation + 1;
  resetState(portable);
  logger.info({
    domain: "updater.flow",
    event: "update.check_started",
    message: "Checking for updates",
  });

  try {
    if (portable) {
      const update = await invoke<UpdateInfo | null>("check_portable_update");
      if (generation !== state.generation) return null;
      state.info = update;
      state.status = update ? "available" : "idle";
      logger.info({
        domain: "updater.flow",
        event: update ? "update.available" : "update.check_succeeded",
        message: update ? "Portable update available" : "No portable update available",
        data: update
          ? { version: update.version, release_date: update.date, mode: "portable" }
          : { mode: "portable" },
      });
      notify();
      return update;
    }

    const update = await check();
    if (generation !== state.generation) {
      // A newer check started while this one was in flight; release this resource.
      if (update) void update.close().catch(() => {});
      return null;
    }
    if (!update) {
      state.status = "idle";
      logger.info({
        domain: "updater.flow",
        event: "update.check_succeeded",
        message: "No update available",
      });
      notify();
      return null;
    }

    state.update = update;
    state.info = { version: update.version, date: update.date, body: update.body };
    state.status = "available";
    logger.info({
      domain: "updater.flow",
      event: "update.available",
      message: "Update available",
      data: { version: update.version, release_date: update.date },
    });
    notify();
    return state.info;
  } catch (error) {
    if (generation === state.generation) {
      state.error = error instanceof Error ? error.message : String(error);
      // Silent checks should not disturb the UI with an error state.
      state.status = silent ? "idle" : "error";
      notify();
    }
    logger[silent ? "warn" : "error"]({
      domain: "updater.flow",
      event: "update.check_failed",
      message: "Update check failed",
      error,
    });
    if (!silent) throw error;
    return null;
  }
}

/**
 * Download (and, for portable builds, stage) the cached update without
 * installing it. Call installUpdate() after the user confirms the restart.
 */
export async function downloadUpdate(
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  const generation = state.generation;
  if (state.status !== "available") throw new Error("No update available");
  state.status = "downloading";
  state.progress = { downloaded: 0, total: 0 };
  state.error = "";
  notify();

  const report = (progress: UpdateProgress) => {
    if (generation !== state.generation) return;
    state.progress = progress;
    notify();
    onProgress?.(progress);
  };

  if (state.portable) {
    const progressChannel = new Channel<UpdateProgress>();
    progressChannel.onmessage = report;
    logger.info({
      domain: "updater.flow",
      event: "update.download_started",
      message: "Starting portable update download",
      data: { mode: "portable" },
    });
    try {
      await invoke<void>("download_portable_update", { onProgress: progressChannel });
      if (generation !== state.generation) return;
      state.status = "ready";
      logger.info({
        domain: "updater.flow",
        event: "update.download_finished",
        message: "Portable update download and verification finished",
        data: { mode: "portable" },
      });
      notify();
      return;
    } catch (error) {
      if (generation === state.generation) {
        state.error = error instanceof Error ? error.message : String(error);
        state.status = "error";
        notify();
      }
      logger.error({
        domain: "updater.flow",
        event: "update.install_failed",
        message: "Portable update staging failed",
        data: { mode: "portable" },
        error,
      });
      throw error;
    }
  }

  const update = state.update;
  if (!update) throw new Error("No update available");

  logger.info({
    domain: "updater.flow",
    event: "update.download_started",
    message: "Starting update download",
    data: { version: update.version },
  });

  let downloaded = 0;
  let total = 0;
  try {
    await update.download((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? 0;
          report({ downloaded: 0, total });
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          report({ downloaded, total });
          break;
        case "Finished":
          report({ downloaded: total, total });
          logger.info({
            domain: "updater.flow",
            event: "update.download_finished",
            message: "Update download finished",
            data: { version: update.version, byte_size: total },
          });
          break;
      }
    });
    if (generation !== state.generation) return;
    state.status = "ready";
    notify();
  } catch (error) {
    if (generation === state.generation) {
      state.error = error instanceof Error ? error.message : String(error);
      state.status = "error";
      notify();
    }
    logger.error({
      domain: "updater.flow",
      event: "update.install_failed",
      message: "Update download failed",
      data: { version: update.version },
      error,
    });
    throw error;
  }
}

/**
 * Logically cancel an in-flight download.
 *
 * The Tauri updater plugin has no abort API, so the HTTP request cannot be
 * stopped here. We invalidate the generation, close the `Update` resource and
 * return to `available`, so the UI stops showing progress and the discarded
 * bytes can never be installed by a later confirm.
 */
export function cancelDownload(): void {
  if (state.status !== "downloading") return;
  state.generation += 1;
  state.status = "available";
  state.progress = { downloaded: 0, total: 0 };
  state.error = "";
  const previous = state.update;
  state.update = null;
  if (previous) void previous.close().catch(() => {});
  logger.info({
    domain: "updater.flow",
    event: "update.download_cancelled",
    message: "Update download cancelled by the user",
  });
  notify();
}

/**
 * Download and install an available update without user interaction.
 * Used by the automatic-update flow; the user is only asked to restart.
 */
export async function autoDownloadAndInstall(): Promise<boolean> {
  if (getUpdaterState().status !== "available") return false;
  await downloadUpdate();
  if (getUpdaterState().status !== "ready") return false;
  await installUpdate();
  return getUpdaterState().status === "installed";
}

/** Install a previously downloaded update. Only call after user confirmation. */
export async function installUpdate(): Promise<void> {
  if (state.status !== "ready") throw new Error("No downloaded update to install");
  const generation = state.generation;
  state.status = "downloading";
  notify();
  try {
    if (state.portable) {
      await invoke<void>("apply_portable_update");
    } else {
      const update = state.update;
      if (!update) throw new Error("No update available");
      await update.install();
    }
    if (generation === state.generation) {
      // The update is applied; only a restart remains. Track that explicitly
      // so the UI can show an "installed, restart to finish" prompt.
      state.status = "installed";
      notify();
    }
  } catch (error) {
    if (generation === state.generation) {
      state.error = error instanceof Error ? error.message : String(error);
      state.status = "error";
      notify();
    }
    logger.error({
      domain: "updater.flow",
      event: "update.install_failed",
      message: "Update install failed",
      error,
    });
    throw error;
  }
}

export async function relaunchApp(portable = state.portable): Promise<void> {
  requireCapability("updater");
  logger.info({
    domain: "updater.flow",
    event: "update.relaunch_requested",
    message: "Relaunching app after update",
  });
  if (portable) {
    // An automatic update may already have applied the staged portable update;
    // calling apply twice fails because the staged slot has been consumed. The
    // new executable is on disk either way, so only a manual restart remains.
    if (getUpdaterState().status !== "installed") {
      await invoke<void>("apply_portable_update");
    }
  } else {
    await relaunch();
  }
}
