use super::uuid_v4;
use crate::error::{AppError, AppResult};
use crate::storage;
use crate::utils::crypto;
use serde::{Deserialize, Serialize};

fn default_digits() -> u8 {
    6
}

fn default_period() -> u64 {
    30
}

/// Stored OTP entry. The secret is AES-256-GCM encrypted on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OtpEntry {
    #[serde(default = "uuid_v4")]
    pub id: String,
    /// `"totp"` or `"hotp"`.
    pub otp_type: String,
    pub issuer: String,
    pub username: String,
    /// Encrypted secret on disk; plaintext only after explicit decryption.
    #[serde(default)]
    pub secret: Option<String>,
    #[serde(default = "default_algorithm")]
    pub algorithm: String,
    #[serde(default = "default_digits")]
    pub digits: u8,
    /// Time step in seconds (TOTP only).
    #[serde(default = "default_period")]
    pub period: u64,
    /// Counter value (HOTP only).
    #[serde(default)]
    pub counter: u64,
    /// Optional regex matched against a terminal prompt. When it matches, the
    /// current code may be offered for autofill. Stored with the entry so it
    /// stays device-local alongside the secret.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_regex: Option<String>,
    /// Transient: true when encrypted secret data exists on disk.
    #[serde(default, skip_serializing)]
    pub has_secret: bool,
}

fn default_algorithm() -> String {
    "SHA1".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OtpConfig {
    #[serde(default)]
    pub entries: Vec<OtpEntry>,
}

pub fn load_otp_entries(app: &impl Sized) -> AppResult<OtpConfig> {
    let _ = app;
    let mut config = OtpConfig {
        entries: storage::list_otp_accounts()?,
    };
    for entry in &mut config.entries {
        entry.has_secret = entry.secret.is_some();
    }
    Ok(config)
}

pub fn save_otp_entries(app: &impl Sized, config: &OtpConfig) -> AppResult<()> {
    let _ = app;
    storage::replace_otp_accounts(config)
}

pub fn load_otp_entry_by_id(app: &impl Sized, id: &str) -> AppResult<OtpEntry> {
    let cfg = load_otp_entries(app)?;
    let mut entry = cfg
        .entries
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| AppError::Config(format!("OTP entry '{}' not found", id)))?;
    if let Some(ct) = entry.secret.clone() {
        entry.secret = crypto::decrypt(&ct).ok();
    }
    Ok(entry)
}

#[cfg(test)]
mod tests {
    use super::OtpEntry;

    #[test]
    fn legacy_otp_entry_without_prompt_regex_deserializes() {
        let entry: OtpEntry = serde_json::from_value(serde_json::json!({
            "id": "otp-1",
            "otp_type": "totp",
            "issuer": "Example",
            "username": "alice",
            "algorithm": "SHA1",
            "digits": 6,
            "period": 30,
            "counter": 0
        }))
        .expect("legacy OTP entry deserializes");

        assert_eq!(entry.prompt_regex, None);
    }

    #[test]
    fn prompt_regex_round_trips() {
        let json = serde_json::json!({
            "id": "otp-1",
            "otp_type": "totp",
            "issuer": "Example",
            "username": "alice",
            "algorithm": "SHA1",
            "digits": 6,
            "period": 30,
            "counter": 0,
            "prompt_regex": "Verification code:"
        });
        let entry: OtpEntry = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(entry.prompt_regex.as_deref(), Some("Verification code:"));
        assert_eq!(serde_json::to_value(&entry).unwrap()["prompt_regex"], "Verification code:");
    }
}

