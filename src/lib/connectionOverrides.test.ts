import { describe, expect, it } from "vitest";
import type { AppSettings, ConnectionOverrides } from "@/types/global";
import {
  connectionsOverridingField,
  hasAnyOverride,
  hasOverride,
  overriddenFieldCount,
  overriddenFields,
  type ResolvedTerminalSettings,
  resolveTerminalSettings,
} from "./connectionOverrides";

function globalSettings(): ResolvedTerminalSettings {
  const appearance = {
    theme: "github-dark",
    theme_mode: "manual",
    light_theme: "github-light",
    dark_theme: "github-dark",
    custom_themes: [],
    font_family: "Global Mono",
    ui_font_family: "UI Sans",
    font_size: 16,
    font_weight: 400,
    font_weight_bold: 700,
    bold_default_foreground_highlight: false,
    background_opacity: 1,
    background_image_path: null,
    background_image_fit: "cover",
    background_image_opacity: 0.45,
    cursor_style: "block",
    cursor_blink: true,
    ui_font_size: 16,
    terminal_theme: null,
    minimum_contrast_ratio: 1,
    panel_multi_open: false,
    window_transparency: "none",
    window_transparency_tint: 1,
    window_transparency_blur: false,
  } as AppSettings["appearance"];
  const terminal = {
    scrollback_lines: 10000,
    keep_alive_mode: "compatible",
    keep_alive_interval: 60,
    font_size_delta: 0,
    hardware_acceleration: false,
    keyword_highlights_enabled: true,
    keyword_highlights_across_wrapped_lines: false,
    keyword_highlight_builtin_rules: {},
    keyword_highlights: [
      {
        id: "global-rule",
        name: "Global rule",
        patterns: ["ERROR"],
        color_dark: "#ff0000",
        color_light: "#aa0000",
        enabled: true,
      },
    ],
    action_links_enabled: true,
    action_links_matchers: { ipv4: true, archive: true, host_port: true },
    show_workspace_padding: false,
    show_line_numbers: false,
    show_timestamps: false,
    timestamp_format: "[HH:mm:ss]",
    show_multi_line_paste_dialog: true,
    paste_image_as_path: true,
    reconnect_restore_cwd: false,
    render_frame_limit_enabled: false,
    render_max_fps: 30,
  } as AppSettings["terminal"];
  return {
    appearance,
    terminal,
    interaction: {} as AppSettings["interaction"],
    translation: {} as AppSettings["translation"],
    search: {} as AppSettings["search"],
    ai: {} as AppSettings["ai"],
    keybindings: {},
    transfer: {} as AppSettings["transfer"],
  };
}

describe("connection overrides", () => {
  it("returns the global object itself when nothing is overridden", () => {
    const global = globalSettings();
    expect(resolveTerminalSettings(global, undefined)).toBe(global);
    expect(resolveTerminalSettings(global, {})).toBe(global);
    expect(hasAnyOverride({})).toBe(false);
  });

  it("changes only the overridden field", () => {
    const global = globalSettings();
    const overrides: ConnectionOverrides = { font_size: 12 };
    const resolved = resolveTerminalSettings(global, overrides);
    expect(resolved).not.toBe(global);
    expect(resolved.appearance.font_size).toBe(12);
    expect(resolved.appearance.font_family).toBe("Global Mono");
    expect(resolved.terminal.scrollback_lines).toBe(10000);
    // The global value is not mutated.
    expect(global.appearance.font_size).toBe(16);
  });

  it("lets a connection follow a later global change for fields it did not override", () => {
    const before = globalSettings();
    const overrides: ConnectionOverrides = { font_size: 12 };
    const changed: ResolvedTerminalSettings = {
      ...before,
      appearance: { ...before.appearance, font_family: "New Global Mono" },
    };
    const resolved = resolveTerminalSettings(changed, overrides);
    expect(resolved.appearance.font_family).toBe("New Global Mono");
    expect(resolved.appearance.font_size).toBe(12);
  });

  it("replaces keyword rules wholesale rather than merging by id", () => {
    const global = globalSettings();
    const resolved = resolveTerminalSettings(global, {
      keyword_highlights: [
        {
          id: "local-rule",
          name: "Local rule",
          patterns: ["WARN"],
          color_dark: "#00ff00",
          color_light: "#00aa00",
          enabled: true,
        },
      ],
    });
    expect(resolved.terminal.keyword_highlights).toHaveLength(1);
    expect(resolved.terminal.keyword_highlights[0].id).toBe("local-rule");
    // Deep-copied so editing the resolved list cannot mutate stored overrides.
    expect(resolved.terminal.keyword_highlights).not.toBe(
      global.terminal.keyword_highlights,
    );
  });

  it("does not leak mutations of the resolved object back into globals", () => {
    const global = globalSettings();
    const overrides: ConnectionOverrides = {
      keyword_highlights: [
        {
          id: "r",
          name: "R",
          patterns: ["X"],
          color_dark: "#000",
          color_light: "#fff",
          enabled: true,
        },
      ],
    };
    const resolved = resolveTerminalSettings(global, overrides);
    resolved.terminal.keyword_highlights[0].patterns.push("mutated");
    expect(overrides.keyword_highlights?.[0].patterns).toEqual(["X"]);
    expect(global.terminal.keyword_highlights[0].patterns).toEqual(["ERROR"]);
  });

  it("lists overridden fields in declaration order", () => {
    const overrides: ConnectionOverrides = {
      render_max_fps: 20,
      font_size: 14,
      font_family: "JetBrains Mono",
    };
    expect(overriddenFields(overrides)).toEqual([
      "font_family",
      "font_size",
      "render_max_fps",
    ]);
    expect(overriddenFieldCount(overrides)).toBe(3);
    expect(hasOverride(overrides, "font_size")).toBe(true);
    expect(hasOverride(overrides, "scrollback_lines")).toBe(false);
  });

  it("reports which connections override a field", () => {
    const connections = [
      { name: "prod", overrides: { font_size: 12 } },
      { name: "stage", overrides: {} },
      { name: "router", overrides: { font_size: 10, scrollback_lines: 100 } },
      { name: "plain" },
    ];
    expect(connectionsOverridingField(connections, "font_size")).toEqual([
      "prod",
      "router",
    ]);
    expect(connectionsOverridingField(connections, "scrollback_lines")).toEqual([
      "router",
    ]);
    expect(connectionsOverridingField(connections, "keep_alive_interval")).toEqual([]);
  });

  it("treats an explicit false as an override", () => {
    // Falsy is not "unset": turning keyword highlighting off for one host must
    // survive, even though the global value is also false.
    const overrides: ConnectionOverrides = { keyword_highlights_enabled: false };
    expect(hasOverride(overrides, "keyword_highlights_enabled")).toBe(true);
    expect(overriddenFieldCount(overrides)).toBe(1);
  });
});
