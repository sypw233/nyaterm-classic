import { normalizeHeaderStatusMode } from "./headerStatus";
import { getSideOpenPanels } from "./appWorkspace";
import type { UiConfig } from "@/types/global";

/**
 * Whether anything on screen is currently consuming remote resource stats.
 *
 * The stats poll runs a shell script over SSH on a timer, so it is the most
 * expensive periodic work in the app. When nothing displays the result, the
 * poll is not stopped — asset metadata is still derived from these samples —
 * but it is slowed down substantially.
 *
 * Consumers are:
 *
 * - the header status area, when its mode displays remote values
 * - the resource monitor panel, docked on either side
 * - the asset workspace, which lists the collected hardware metadata
 */
export function isRemoteStatsDisplayed(
  ui: UiConfig,
  options: { multiPanelOpen: boolean; hasOpenTabs: boolean },
): boolean {
  // The header hides itself in pane-focus mode, but the mode setting is still
  // a reliable signal for "the user asked to see remote values".
  const headerStatusMode = normalizeHeaderStatusMode(ui.header_status_mode);
  const headerStatusVisible = ui.header_status_visible !== false;
  if (
    headerStatusVisible &&
    (headerStatusMode === "resources" || headerStatusMode === "host")
  ) {
    return true;
  }

  const sidePanels = [
    ...getSideOpenPanels(ui, "left", options.multiPanelOpen),
    ...getSideOpenPanels(ui, "right", options.multiPanelOpen),
  ];
  if (sidePanels.includes("resourceMonitor")) return true;

  // The asset workspace is only reachable when there are no open tabs.
  if (!options.hasOpenTabs && (ui.start_workspace_mode ?? "workbench") === "assets") {
    return true;
  }

  return false;
}

/**
 * Poll interval to use when nothing displays the stats.
 *
 * Deliberately slow rather than disabled: stopping would freeze the hardware
 * metadata written back to saved connections, and the panel can be opened at any
 * moment without a fresh fetch.
 */
export const IDLE_REMOTE_STATS_INTERVAL_SECONDS = 30;
