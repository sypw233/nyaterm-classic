//! Per-connection overrides of the global settings.
//!
//! A connection may want its own font, its own keyword highlighting, or its own
//! frame cap — a low-powered router should not force the same scrollback as a
//! build server. Every field here is `Option`; `None` means "inherit the global
//! setting", so an absent field never snaps the connection to a default value,
//! and settings added to `AppSettings` later keep flowing to every connection
//! that never opted out.
//!
//! [`ConnectionOverrides::apply`] is the single merge point. The frontend has a
//! mirror of it in `src/lib/connectionOverrides.ts`; both must stay in sync.

use super::{AppSettings, ActionLinksMatcherSettings, KeywordHighlightRule};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Fields one connection may override.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ConnectionOverrides {
    // ── Appearance ──────────────────────────────────────────────────────────
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_weight_bold: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor_blink: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimum_contrast_ratio: Option<f64>,

    // ── Terminal behaviour ─────────────────────────────────────────────────
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scrollback_lines: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyword_highlights_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyword_highlights_across_wrapped_lines: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyword_highlight_builtin_rules: Option<BTreeMap<String, bool>>,
    /// Replaces the global rule set wholesale when present.
    ///
    /// Merging per rule id was rejected: rules interact through match order and
    /// overlap, so a half-merged result is not predictable. A snapshot is
    /// something the user can reason about.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyword_highlights: Option<Vec<KeywordHighlightRule>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_links_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_links_matchers: Option<ActionLinksMatcherSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_line_numbers: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_timestamps: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp_format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_workspace_padding: Option<bool>,

    // ── Rendering / performance ────────────────────────────────────────────
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hardware_acceleration: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_batched_output: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tui_frame_limit_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tui_max_fps: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_render_policy: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_max_fps: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub render_frame_limit_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub render_max_fps: Option<u32>,

    // ── Connection parameters ──────────────────────────────────────────────
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_alive_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_alive_interval: Option<u32>,
}

impl ConnectionOverrides {
    /// Apply these overrides over the global settings.
    ///
    /// Only the fields this type knows about are touched, so unrelated settings
    /// (AI, keybindings, interaction) pass through untouched.
    pub fn apply(&self, global: &AppSettings) -> AppSettings {
        let mut settings = global.clone();

        if let Some(value) = &self.font_family {
            settings.appearance.font_family = value.clone();
        }
        if let Some(value) = self.font_size {
            settings.appearance.font_size = value;
        }
        if let Some(value) = self.font_weight {
            settings.appearance.font_weight = value;
        }
        if let Some(value) = self.font_weight_bold {
            settings.appearance.font_weight_bold = value;
        }
        if let Some(value) = &self.cursor_style {
            settings.appearance.cursor_style = value.clone();
        }
        if let Some(value) = self.cursor_blink {
            settings.appearance.cursor_blink = value;
        }
        if let Some(value) = self.minimum_contrast_ratio {
            settings.appearance.minimum_contrast_ratio = value;
        }

        if let Some(value) = self.scrollback_lines {
            settings.terminal.scrollback_lines = value;
        }
        if let Some(value) = self.keyword_highlights_enabled {
            settings.terminal.keyword_highlights_enabled = value;
        }
        if let Some(value) = self.keyword_highlights_across_wrapped_lines {
            settings.terminal.keyword_highlights_across_wrapped_lines = value;
        }
        if let Some(value) = &self.keyword_highlight_builtin_rules {
            settings.terminal.keyword_highlight_builtin_rules = value.clone();
        }
        if let Some(value) = &self.keyword_highlights {
            settings.terminal.keyword_highlights = value.clone();
        }
        if let Some(value) = self.action_links_enabled {
            settings.terminal.action_links_enabled = value;
        }
        if let Some(value) = &self.action_links_matchers {
            settings.terminal.action_links_matchers = value.clone();
        }
        if let Some(value) = self.show_line_numbers {
            settings.terminal.show_line_numbers = value;
        }
        if let Some(value) = self.show_timestamps {
            settings.terminal.show_timestamps = value;
        }
        if let Some(value) = &self.timestamp_format {
            settings.terminal.timestamp_format = value.clone();
        }
        if let Some(value) = self.show_workspace_padding {
            settings.terminal.show_workspace_padding = value;
        }

        if let Some(value) = self.hardware_acceleration {
            settings.terminal.hardware_acceleration = value;
        }
        if let Some(value) = self.frame_batched_output {
            settings.terminal.frame_batched_output = value;
        }
        if let Some(value) = self.tui_frame_limit_enabled {
            settings.terminal.tui_frame_limit_enabled = value;
        }
        if let Some(value) = self.tui_max_fps {
            settings.terminal.tui_max_fps = value;
        }
        if let Some(value) = &self.background_render_policy {
            settings.terminal.background_render_policy = value.clone();
        }
        if let Some(value) = self.background_max_fps {
            settings.terminal.background_max_fps = value;
        }
        if let Some(value) = self.render_frame_limit_enabled {
            settings.terminal.render_frame_limit_enabled = value;
        }
        if let Some(value) = self.render_max_fps {
            settings.terminal.render_max_fps = value;
        }

        if let Some(value) = &self.keep_alive_mode {
            settings.terminal.keep_alive_mode = value.clone();
        }
        if let Some(value) = self.keep_alive_interval {
            settings.terminal.keep_alive_interval = value;
        }

        settings
    }

    /// Number of fields this connection overrides. Zero means "follows global".
    pub fn overridden_field_count(&self) -> usize {
        self.overridden_fields().len()
    }

    /// Stable field keys for the overridden settings, in declaration order.
    ///
    /// The strings are stable identifiers, not labels: the UI maps them to
    /// translated names so this list never needs localizing.
    pub fn overridden_fields(&self) -> Vec<&'static str> {
        let mut fields = Vec::new();
        macro_rules! check {
            ($field:ident, $key:literal) => {
                if self.$field.is_some() {
                    fields.push($key);
                }
            };
        }
        check!(font_family, "font_family");
        check!(font_size, "font_size");
        check!(font_weight, "font_weight");
        check!(font_weight_bold, "font_weight_bold");
        check!(cursor_style, "cursor_style");
        check!(cursor_blink, "cursor_blink");
        check!(minimum_contrast_ratio, "minimum_contrast_ratio");
        check!(scrollback_lines, "scrollback_lines");
        check!(keyword_highlights_enabled, "keyword_highlights_enabled");
        check!(
            keyword_highlights_across_wrapped_lines,
            "keyword_highlights_across_wrapped_lines"
        );
        check!(
            keyword_highlight_builtin_rules,
            "keyword_highlight_builtin_rules"
        );
        check!(keyword_highlights, "keyword_highlights");
        check!(action_links_enabled, "action_links_enabled");
        check!(action_links_matchers, "action_links_matchers");
        check!(show_line_numbers, "show_line_numbers");
        check!(show_timestamps, "show_timestamps");
        check!(timestamp_format, "timestamp_format");
        check!(show_workspace_padding, "show_workspace_padding");
        check!(hardware_acceleration, "hardware_acceleration");
        check!(frame_batched_output, "frame_batched_output");
        check!(tui_frame_limit_enabled, "tui_frame_limit_enabled");
        check!(tui_max_fps, "tui_max_fps");
        check!(background_render_policy, "background_render_policy");
        check!(background_max_fps, "background_max_fps");
        check!(render_frame_limit_enabled, "render_frame_limit_enabled");
        check!(render_max_fps, "render_max_fps");
        check!(keep_alive_mode, "keep_alive_mode");
        check!(keep_alive_interval, "keep_alive_interval");
        fields
    }

    /// True when nothing is overridden; callers can drop the field entirely.
    pub fn is_empty(&self) -> bool {
        self.overridden_field_count() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn global() -> AppSettings {
        let mut settings = AppSettings::default();
        settings.appearance.font_family = "Global Mono".to_string();
        settings.appearance.font_size = 16.0;
        settings.terminal.scrollback_lines = 10_000;
        settings.terminal.keyword_highlights_enabled = true;
        settings.terminal.keyword_highlights = vec![KeywordHighlightRule {
            id: "global-rule".to_string(),
            name: "Global rule".to_string(),
            patterns: vec!["ERROR".to_string()],
            color_dark: "#ff0000".to_string(),
            color_light: "#aa0000".to_string(),
            enabled: true,
        }];
        settings.terminal.keep_alive_mode = "compatible".to_string();
        settings.terminal.keep_alive_interval = 60;
        settings
    }

    #[test]
    fn absent_fields_inherit_the_global_value() {
        let global = global();
        let overrides = ConnectionOverrides::default();
        let resolved = overrides.apply(&global);
        assert_eq!(resolved.appearance.font_family, "Global Mono");
        assert_eq!(resolved.appearance.font_size, 16.0);
        assert_eq!(resolved.terminal.keep_alive_interval, 60);
        assert!(overrides.is_empty());
    }

    #[test]
    fn only_the_overridden_field_changes() {
        let global = global();
        let overrides = ConnectionOverrides {
            font_size: Some(12.0),
            ..Default::default()
        };
        let resolved = overrides.apply(&global);
        assert_eq!(resolved.appearance.font_size, 12.0);
        // Everything else still follows global.
        assert_eq!(resolved.appearance.font_family, "Global Mono");
        assert_eq!(resolved.terminal.scrollback_lines, 10_000);
        // The input is not mutated.
        assert_eq!(global.appearance.font_size, 16.0);
    }

    #[test]
    fn keyword_rules_are_replaced_not_merged() {
        let global = global();
        let overrides = ConnectionOverrides {
            keyword_highlights: Some(vec![KeywordHighlightRule {
                id: "local-rule".to_string(),
                name: "Local rule".to_string(),
                patterns: vec!["WARN".to_string()],
                color_dark: "#00ff00".to_string(),
                color_light: "#00aa00".to_string(),
                enabled: true,
            }]),
            ..Default::default()
        };
        let resolved = overrides.apply(&global);
        assert_eq!(resolved.terminal.keyword_highlights.len(), 1);
        assert_eq!(resolved.terminal.keyword_highlights[0].id, "local-rule");
        // The global rule set is untouched.
        assert_eq!(global.terminal.keyword_highlights[0].id, "global-rule");
    }

    #[test]
    fn reports_overridden_field_keys() {
        let overrides = ConnectionOverrides {
            font_family: Some("JetBrains Mono".to_string()),
            font_size: Some(14.0),
            render_max_fps: Some(20),
            ..Default::default()
        };
        assert_eq!(
            overrides.overridden_fields(),
            vec!["font_family", "font_size", "render_max_fps"]
        );
        assert_eq!(overrides.overridden_field_count(), 3);
        assert!(!overrides.is_empty());
    }

    #[test]
    fn unknown_settings_keep_their_global_values() {
        let global = global();
        let mut global = global;
        global.interaction.command_suggestions_enabled = false;
        global.ai.enabled = false;
        let resolved = ConnectionOverrides::default().apply(&global);
        // Overrides never touch settings outside their scope, even when the
        // connection object happens to be reused for a new field later.
        assert!(!resolved.interaction.command_suggestions_enabled);
        assert!(!resolved.ai.enabled);
    }

    #[test]
    fn omitted_fields_round_trip_without_adding_json_keys() {
        let encoded = serde_json::to_value(ConnectionOverrides::default()).unwrap();
        assert_eq!(encoded, serde_json::json!({}));

        let decoded: ConnectionOverrides =
            serde_json::from_value(serde_json::json!({"font_size": 13.0})).unwrap();
        assert_eq!(decoded.font_size, Some(13.0));
        assert!(decoded.font_family.is_none());
    }

    #[test]
    fn legacy_connection_payloads_still_deserialize() {
        // A connection written before overrides existed has no such key.
        let connection: crate::config::SavedConnection = serde_json::from_value(
            serde_json::json!({"id":"c1","name":"old","type":"ssh","host":"h","port":22,"username":"root"}),
        )
        .expect("legacy connection");
        assert!(connection.overrides.is_none());
    }
}
