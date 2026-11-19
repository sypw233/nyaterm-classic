//! Default session settings per connection kind.
//!
//! A new connection of a given kind starts from the parameters the user saved
//! for that kind, so repeated connection types do not have to be reconfigured
//! each time. The payload is a full `SavedConnection` so older builds that do
//! not know this store, and newer builds that add fields, both round-trip it
//! unchanged; only the non-identity fields are ever applied.
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::config::SavedConnection;
use crate::error::AppResult;
use crate::storage::{SettingsDocKey, load_settings_doc, save_settings_doc};

/// The stable identifier of a connection kind, matching the editor protocol id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionKind {
    Ssh,
    Telnet,
    Rdp,
    Vnc,
    Serial,
    Local,
}

impl SessionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ssh => "ssh",
            Self::Telnet => "telnet",
            Self::Rdp => "rdp",
            Self::Vnc => "vnc",
            Self::Serial => "serial",
            Self::Local => "local",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "ssh" => Some(Self::Ssh),
            "telnet" => Some(Self::Telnet),
            "rdp" => Some(Self::Rdp),
            "vnc" => Some(Self::Vnc),
            "serial" => Some(Self::Serial),
            "local" => Some(Self::Local),
            _ => None,
        }
    }

    pub fn from_connection(connection: &SavedConnection) -> Self {
        match &connection.config {
            crate::config::ConnectionType::Ssh { .. } => Self::Ssh,
            crate::config::ConnectionType::Telnet { .. } => Self::Telnet,
            crate::config::ConnectionType::Rdp { .. } => Self::Rdp,
            crate::config::ConnectionType::Vnc { .. } => Self::Vnc,
            crate::config::ConnectionType::Serial { .. } => Self::Serial,
            crate::config::ConnectionType::LocalTerminal { .. } => Self::Local,
        }
    }
}

/// Stored defaults keyed by kind id. Unknown keys are preserved so a newer
/// build's kinds survive a downgrade.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DefaultSessionSettings {
    #[serde(default)]
    pub kinds: BTreeMap<String, SavedConnection>,
}

impl DefaultSessionSettings {
    pub fn get(&self, kind: SessionKind) -> Option<&SavedConnection> {
        self.kinds.get(kind.as_str())
    }

    pub fn set(&mut self, kind: SessionKind, connection: SavedConnection) {
        self.kinds.insert(kind.as_str().to_string(), connection);
    }

    pub fn remove(&mut self, kind: SessionKind) -> bool {
        self.kinds.remove(kind.as_str()).is_some()
    }
}

pub fn load_default_session_settings() -> AppResult<DefaultSessionSettings> {
    load_settings_doc(SettingsDocKey::DefaultSessionSettings)
}

pub fn save_default_session_settings(settings: &DefaultSessionSettings) -> AppResult<()> {
    save_settings_doc(SettingsDocKey::DefaultSessionSettings, settings)
}

/// Copy the reusable parameters of `defaults` onto `connection`.
///
/// Identity fields — name, group, description, tags, icon, sort order — are
/// the user's per-connection choices and are never copied, so two connections
/// of the same kind stay distinguishable. Everything else (transport, auth,
/// terminal behavior, SFTP, algorithms, post-login, recording) lives inside
/// `config` or the shared option fields and is copied verbatim.
pub fn apply_session_defaults(connection: &mut SavedConnection, defaults: &SavedConnection) {
    connection.config = defaults.config.clone();
    connection.auth = defaults.auth.clone();
    connection.network = defaults.network.clone();
    connection.post_login = defaults.post_login.clone();
    connection.recording = defaults.recording.clone();
    connection.ssh_algorithms = defaults.ssh_algorithms.clone();
    connection.ssh_profile = defaults.ssh_profile.clone();
    connection.terminal_type = defaults.terminal_type.clone();
    connection.sftp = defaults.sftp.clone();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{ConnectionType, SavedConnection};

    fn connection(name: &str, host: &str) -> SavedConnection {
        serde_json::from_value(serde_json::json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "name": name,
            "type": "ssh",
            "host": host,
            "port": 2222,
            "username": "alice",
        }))
        .expect("valid connection fixture")
    }

    #[test]
    fn kinds_round_trip_through_their_string_ids() {
        for kind in [
            SessionKind::Ssh,
            SessionKind::Telnet,
            SessionKind::Rdp,
            SessionKind::Vnc,
            SessionKind::Serial,
            SessionKind::Local,
        ] {
            assert_eq!(SessionKind::from_str(kind.as_str()), Some(kind));
        }
        assert_eq!(SessionKind::from_str("unknown"), None);
    }

    #[test]
    fn settings_keep_unknown_kinds_for_forward_compatibility() {
        let mut settings = DefaultSessionSettings::default();
        settings.set(SessionKind::Ssh, connection("defaults", "example.com"));
        let encoded = serde_json::to_value(&settings).unwrap();
        assert_eq!(encoded["kinds"]["ssh"]["name"], "defaults");

        let mut decoded: DefaultSessionSettings = serde_json::from_value(encoded).unwrap();
        // A kind this build does not know must survive a read/write cycle.
        decoded
            .kinds
            .insert("future-kind".to_string(), connection("future", "h"));
        let round_tripped = serde_json::to_value(&decoded).unwrap();
        assert!(round_tripped["kinds"].get("future-kind").is_some());
    }

    #[test]
    fn applying_defaults_keeps_identity_fields() {
        let mut target = connection("my-connection", "old.example.com");
        target.group_id = Some("group-1".to_string());
        target.description = Some("mine".to_string());
        target.tags = vec!["prod".to_string()];
        target.sort_order = 7;

        let mut defaults = connection("stored-defaults", "new.example.com");
        defaults.sort_order = 0;
        defaults.tags = vec![];

        apply_session_defaults(&mut target, &defaults);

        assert_eq!(target.name, "my-connection");
        assert_eq!(target.group_id.as_deref(), Some("group-1"));
        assert_eq!(target.description.as_deref(), Some("mine"));
        assert_eq!(target.tags, vec!["prod".to_string()]);
        assert_eq!(target.sort_order, 7);
        // Transport parameters do come from the defaults.
        match &target.config {
            ConnectionType::Ssh {
                host,
                port,
                username,
                ..
            } => {
                assert_eq!(host, "new.example.com");
                assert_eq!(*port, 2222);
                assert_eq!(username, "alice");
            }
            other => panic!("unexpected config: {other:?}"),
        }
    }
}
