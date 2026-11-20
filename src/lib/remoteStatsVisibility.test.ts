import { describe, expect, it } from "vitest";
import {
  IDLE_REMOTE_STATS_INTERVAL_SECONDS,
  isRemoteStatsDisplayed,
} from "./remoteStatsVisibility";
import type { UiConfig } from "@/types/global";

function ui(overrides: Partial<UiConfig> = {}): UiConfig {
  return {
    header_status_mode: "session",
    header_status_visible: true,
    show_remote_stats: true,
    active_left_panel: null,
    active_right_panel: null,
    left_open_panels: [],
    right_open_panels: [],
    start_workspace_mode: "workbench",
    activity_bar_layout: {
      left_top: ["fileExplorer", "resourceMonitor"],
      left_bottom: [],
      right_top: ["savedConnections"],
      right_bottom: [],
      hidden_items: [],
    },
    ...overrides,
  } as UiConfig;
}

const noTabs = { multiPanelOpen: false, hasOpenTabs: true };

describe("isRemoteStatsDisplayed", () => {
  it("is false for the default setup where only the session name is shown", () => {
    expect(isRemoteStatsDisplayed(ui(), noTabs)).toBe(false);
  });

  it("is true when the header shows remote resources", () => {
    expect(
      isRemoteStatsDisplayed(ui({ header_status_mode: "resources" }), noTabs),
    ).toBe(true);
  });

  it("is true when the header shows host details", () => {
    expect(
      isRemoteStatsDisplayed(ui({ header_status_mode: "host" }), noTabs),
    ).toBe(true);
  });

  it("ignores the header when it is hidden", () => {
    expect(
      isRemoteStatsDisplayed(
        ui({ header_status_mode: "resources", header_status_visible: false }),
        noTabs,
      ),
    ).toBe(false);
  });

  it("is true when the resource monitor panel is open", () => {
    expect(
      isRemoteStatsDisplayed(ui({ active_right_panel: "resourceMonitor" }), noTabs),
    ).toBe(true);
    // Multi-open mode filters by activity-bar order, so the panel must also be
    // placed on that side for the docked panel to count.
    expect(
      isRemoteStatsDisplayed(
        ui({
          right_open_panels: ["resourceMonitor"],
          activity_bar_layout: {
            left_top: ["fileExplorer"],
            left_bottom: [],
            right_top: ["savedConnections", "resourceMonitor"],
            right_bottom: [],
            hidden_items: [],
          },
        }),
        { multiPanelOpen: true, hasOpenTabs: true },
      ),
    ).toBe(true);
  });

  it("is true when the asset workspace is showing", () => {
    expect(
      isRemoteStatsDisplayed(ui({ start_workspace_mode: "assets" }), {
        multiPanelOpen: false,
        hasOpenTabs: false,
      }),
    ).toBe(true);
  });

  it("does not treat an open tab as the asset workspace", () => {
    expect(
      isRemoteStatsDisplayed(ui({ start_workspace_mode: "assets" }), {
        multiPanelOpen: false,
        hasOpenTabs: true,
      }),
    ).toBe(false);
  });

  it("uses a much slower interval when nothing is displayed", () => {
    // The idle interval exists so hardware metadata keeps flowing without
    // paying a shell round trip every few seconds.
    expect(IDLE_REMOTE_STATS_INTERVAL_SECONDS).toBeGreaterThanOrEqual(20);
  });
});
