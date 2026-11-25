use crate::error::AppResult;
use crate::storage::{self, SettingsDocKey};
use serde::{Deserialize, Serialize};

fn default_execute() -> String {
    "execute".to_string()
}

/// How a quick command is split when sent in segments.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QuickCommandSegmentedSendMode {
    #[default]
    Line,
    Character,
}

impl QuickCommandSegmentedSendMode {
    pub const fn default_interval_ms(self) -> u64 {
        match self {
            Self::Line => 1_000,
            Self::Character => 20,
        }
    }
}

/// Optional segmented-delivery settings for a quick command.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct QuickCommandSegmentedSend {
    #[serde(default)]
    pub mode: QuickCommandSegmentedSendMode,
    #[serde(default = "default_segmented_interval_ms")]
    pub interval_ms: u64,
}

impl Default for QuickCommandSegmentedSend {
    fn default() -> Self {
        Self {
            mode: QuickCommandSegmentedSendMode::Line,
            interval_ms: QuickCommandSegmentedSendMode::Line.default_interval_ms(),
        }
    }
}

fn default_segmented_interval_ms() -> u64 {
    QuickCommandSegmentedSendMode::Line.default_interval_ms()
}

/// Single quick command (label + shell command).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickCommand {
    pub id: String,
    pub label: String,
    pub command: String,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color_tag: Option<String>,
    #[serde(default)]
    pub icon_tag: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default = "default_execute")]
    pub execution_mode: String,
    #[serde(default)]
    pub segmented_send: Option<QuickCommandSegmentedSend>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub risk_level: Option<String>,
    #[serde(default)]
    pub updated_at: Option<u64>,
    #[serde(default)]
    pub created_at: Option<u64>,
    #[serde(default)]
    pub use_count: Option<u32>,
    #[serde(default)]
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickCommandCategory {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub sort_order: i32,
}

/// List of quick commands persisted in local app storage.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QuickCommandsConfig {
    pub commands: Vec<QuickCommand>,
    #[serde(default)]
    pub categories: Vec<QuickCommandCategory>,
}

/// Loads quick commands from local app storage.
pub fn load_quick_commands(app: &impl Sized) -> AppResult<QuickCommandsConfig> {
    let _ = app;
    storage::load_settings_doc(SettingsDocKey::QuickCommands)
}

/// Saves quick commands to local app storage.
pub fn save_quick_commands(app: &impl Sized, config: &QuickCommandsConfig) -> AppResult<()> {
    let _ = app;
    storage::save_settings_doc(SettingsDocKey::QuickCommands, config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_quick_command_has_no_segmented_send() {
        let command: QuickCommand = serde_json::from_value(serde_json::json!({
            "id": "qc-1",
            "label": "legacy",
            "command": "echo hi",
        }))
        .expect("legacy quick command deserializes");

        assert_eq!(command.execution_mode, "execute");
        assert_eq!(command.segmented_send, None);
    }

    #[test]
    fn segmented_send_defaults_to_line_mode() {
        let send: QuickCommandSegmentedSend = serde_json::from_value(serde_json::json!({}))
            .expect("segmented send defaults deserialize");
        assert_eq!(send.mode, QuickCommandSegmentedSendMode::Line);
        assert_eq!(send.interval_ms, 1_000);
    }
}

