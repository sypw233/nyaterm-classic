import type {
  ActionLinksMatcherSettings,
  AppSettings,
  ConnectionOverrides,
  KeywordHighlightRule,
} from "@/types/global";

/**
 * The slice of `AppSettings` a terminal actually reads.
 *
 * Mirrors `TerminalAppSettings` from `AppContext`, kept here as a structural
 * type so the resolver does not depend on React.
 */
export interface ResolvedTerminalSettings {
  appearance: AppSettings["appearance"];
  interaction: AppSettings["interaction"];
  terminal: AppSettings["terminal"];
  translation: AppSettings["translation"];
  search: AppSettings["search"];
  ai: AppSettings["ai"];
  keybindings: Record<string, string>;
  transfer: AppSettings["transfer"];
}

/** Stable field keys, in the order the UI lists them. */
export const CONNECTION_OVERRIDE_FIELDS = [
  "font_family",
  "font_size",
  "font_weight",
  "font_weight_bold",
  "cursor_style",
  "cursor_blink",
  "minimum_contrast_ratio",
  "scrollback_lines",
  "keyword_highlights_enabled",
  "keyword_highlights_across_wrapped_lines",
  "keyword_highlight_builtin_rules",
  "keyword_highlights",
  "action_links_enabled",
  "action_links_matchers",
  "show_line_numbers",
  "show_timestamps",
  "timestamp_format",
  "show_workspace_padding",
  "hardware_acceleration",
  "frame_batched_output",
  "tui_frame_limit_enabled",
  "tui_max_fps",
  "background_render_policy",
  "background_max_fps",
  "render_frame_limit_enabled",
  "render_max_fps",
  "keep_alive_mode",
  "keep_alive_interval",
] as const;

export type ConnectionOverrideField = (typeof CONNECTION_OVERRIDE_FIELDS)[number];

/** True for a key that holds an override value, as opposed to `undefined`. */
export function hasOverride(
  overrides: ConnectionOverrides | null | undefined,
  field: ConnectionOverrideField,
): boolean {
  return overrides?.[field] !== undefined;
}

/** Field keys this connection actually overrides, in declaration order. */
export function overriddenFields(
  overrides: ConnectionOverrides | null | undefined,
): ConnectionOverrideField[] {
  if (!overrides) return [];
  return CONNECTION_OVERRIDE_FIELDS.filter((field) => overrides[field] !== undefined);
}

export function overriddenFieldCount(
  overrides: ConnectionOverrides | null | undefined,
): number {
  return overriddenFields(overrides).length;
}

export function hasAnyOverride(
  overrides: ConnectionOverrides | null | undefined,
): boolean {
  return overriddenFieldCount(overrides) > 0;
}

/**
 * Apply a connection's overrides over the global settings.
 *
 * This is the single merge point on the frontend and mirrors
 * `ConnectionOverrides::apply` in `nyaterm-core`. Only fields listed in
 * `ConnectionOverrides` are touched; everything else passes through, so
 * settings outside the override scope can never be changed by accident.
 *
 * Returns the input object itself when there is nothing to override, so callers
 * can rely on reference identity to skip re-renders.
 */
export function resolveTerminalSettings(
  global: ResolvedTerminalSettings,
  overrides: ConnectionOverrides | null | undefined,
): ResolvedTerminalSettings {
  if (!hasAnyOverride(overrides)) return global;

  const appearance = { ...global.appearance };
  const terminal = { ...global.terminal };

  const o = overrides as ConnectionOverrides;
  if (o.font_family !== undefined) appearance.font_family = o.font_family;
  if (o.font_size !== undefined) appearance.font_size = o.font_size;
  if (o.font_weight !== undefined) appearance.font_weight = o.font_weight;
  if (o.font_weight_bold !== undefined) appearance.font_weight_bold = o.font_weight_bold;
  if (o.cursor_style !== undefined) appearance.cursor_style = o.cursor_style;
  if (o.cursor_blink !== undefined) appearance.cursor_blink = o.cursor_blink;
  if (o.minimum_contrast_ratio !== undefined) {
    appearance.minimum_contrast_ratio = o.minimum_contrast_ratio;
  }

  if (o.scrollback_lines !== undefined) terminal.scrollback_lines = o.scrollback_lines;
  if (o.keyword_highlights_enabled !== undefined) {
    terminal.keyword_highlights_enabled = o.keyword_highlights_enabled;
  }
  if (o.keyword_highlights_across_wrapped_lines !== undefined) {
    terminal.keyword_highlights_across_wrapped_lines =
      o.keyword_highlights_across_wrapped_lines;
  }
  if (o.keyword_highlight_builtin_rules !== undefined) {
    terminal.keyword_highlight_builtin_rules = { ...o.keyword_highlight_builtin_rules };
  }
  if (o.keyword_highlights !== undefined) {
    // Whole-set replacement: rules interact through match order, so a partial
    // merge would produce results the user cannot predict.
    terminal.keyword_highlights = o.keyword_highlights.map(
      (rule: KeywordHighlightRule) => ({ ...rule, patterns: [...rule.patterns] }),
    );
  }
  if (o.action_links_enabled !== undefined) {
    terminal.action_links_enabled = o.action_links_enabled;
  }
  if (o.action_links_matchers !== undefined) {
    terminal.action_links_matchers = {
      ...o.action_links_matchers,
    } as ActionLinksMatcherSettings;
  }
  if (o.show_line_numbers !== undefined) terminal.show_line_numbers = o.show_line_numbers;
  if (o.show_timestamps !== undefined) terminal.show_timestamps = o.show_timestamps;
  if (o.timestamp_format !== undefined) terminal.timestamp_format = o.timestamp_format;
  if (o.show_workspace_padding !== undefined) {
    terminal.show_workspace_padding = o.show_workspace_padding;
  }

  if (o.hardware_acceleration !== undefined) {
    terminal.hardware_acceleration = o.hardware_acceleration;
  }
  if (o.frame_batched_output !== undefined) {
    terminal.frame_batched_output = o.frame_batched_output;
  }
  if (o.tui_frame_limit_enabled !== undefined) {
    terminal.tui_frame_limit_enabled = o.tui_frame_limit_enabled;
  }
  if (o.tui_max_fps !== undefined) terminal.tui_max_fps = o.tui_max_fps;
  if (o.background_render_policy !== undefined) {
    terminal.background_render_policy = o.background_render_policy;
  }
  if (o.background_max_fps !== undefined) {
    terminal.background_max_fps = o.background_max_fps;
  }
  if (o.render_frame_limit_enabled !== undefined) {
    terminal.render_frame_limit_enabled = o.render_frame_limit_enabled;
  }
  if (o.render_max_fps !== undefined) terminal.render_max_fps = o.render_max_fps;

  if (o.keep_alive_mode !== undefined) terminal.keep_alive_mode = o.keep_alive_mode;
  if (o.keep_alive_interval !== undefined) {
    terminal.keep_alive_interval = o.keep_alive_interval;
  }

  return { ...global, appearance, terminal };
}

/**
 * How many connections override a given field, and which ones.
 *
 * Used by the global settings page to warn that a change will not reach every
 * session. Returns connections in the order they were given.
 */
export function connectionsOverridingField(
  connections: readonly { name: string; overrides?: ConnectionOverrides }[],
  field: ConnectionOverrideField,
): string[] {
  return connections
    .filter((connection) => hasOverride(connection.overrides, field))
    .map((connection) => connection.name);
}
