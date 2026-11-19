use aes::Aes256;
use cbc::cipher::{BlockDecryptMut, KeyIvInit, block_padding::Pkcs7};
use pbkdf2::pbkdf2_hmac;
use sha3::Sha3_512;

type Aes256CbcDecryptor = cbc::Decryptor<Aes256>;

const WINDTERM_PBKDF2_ITERATIONS: u32 = 100_000;
const WINDTERM_DERIVED_LENGTH: usize = 48;
const WINDTERM_AES_KEY_LENGTH: usize = 32;
const WINDTERM_AES_IV_LENGTH: usize = 16;

struct WindtermCrypto {
    key: [u8; WINDTERM_AES_KEY_LENGTH],
    iv: [u8; WINDTERM_AES_IV_LENGTH],
}

fn parse_windterm(
    path: &str,
    windterm_master_password: Option<&str>,
) -> AppResult<PreparedJsonImport> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| AppError::Config(format!("Cannot read file: {e}")))?;
    let crypto = load_windterm_crypto(Path::new(path), windterm_master_password)?;
    parse_windterm_content_with_crypto(&content, crypto.as_ref(), Some(Path::new(path)))
}

#[cfg(test)]
fn parse_windterm_content(content: &str) -> AppResult<PreparedJsonImport> {
    parse_windterm_content_with_crypto(content, None, None)
}

fn parse_windterm_content_with_crypto(
    content: &str,
    crypto: Option<&WindtermCrypto>,
    source_path: Option<&Path>,
) -> AppResult<PreparedJsonImport> {
    parse_windterm_content_impl(content, crypto, source_path, true)
}

/// WindTerm stores reusable one-key logins in a sibling `onekeys.config`.
/// Each entry's `auth` is the same AES-CBC payload as `session.autoLogin`.
fn load_windterm_one_keys(
    source_path: Option<&Path>,
    crypto: Option<&WindtermCrypto>,
) -> Vec<WindtermOneKeyAccount> {
    let Some(directory) = source_path.and_then(Path::parent) else {
        return Vec::new();
    };
    let Some(path) = find_windterm_sibling(directory, "onekeys.config") else {
        return Vec::new();
    };
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    let Ok(entries) = serde_json::from_str::<Vec<serde_json::Value>>(&content) else {
        return Vec::new();
    };
    let mut accounts = Vec::new();
    for entry in entries {
        let uuid = entry
            .get("uuid")
            .and_then(|value| value.as_str())
            .and_then(normalize_windterm_string_ref);
        let Some(uuid) = uuid else { continue };
        let kind = entry
            .get("type")
            .and_then(|value| value.as_str())
            .and_then(normalize_windterm_string_ref);
        // `SshOneKey` and `AccountOneKey` both describe reusable logins. Other
        // kinds belong to protocols this importer does not create.
        if kind.is_some_and(|kind| {
            !kind.eq_ignore_ascii_case("SshOneKey") && !kind.eq_ignore_ascii_case("AccountOneKey")
        }) {
            continue;
        }
        let Some(payload) = entry
            .get("auth")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .and_then(|raw| decode_windterm_auth_payload(raw, crypto))
        else {
            continue;
        };
        let Some(username) = ["session.user", "user", "username", "login", "account"]
            .iter()
            .find_map(|key| payload.get(*key))
            .and_then(|value| value.as_str())
            .and_then(normalize_windterm_string_ref)
        else {
            continue;
        };
        let password = ["Password", "password", "pass", "secret"]
            .iter()
            .find_map(|key| payload.get(*key))
            .and_then(|value| value.as_str())
            .and_then(normalize_windterm_string_ref);
        let name = entry
            .get("name")
            .and_then(|value| value.as_str())
            .and_then(normalize_windterm_string_ref)
            .unwrap_or(username)
            .to_string();
        accounts.push(WindtermOneKeyAccount {
            uuid: uuid.to_string(),
            name,
            username: username.to_string(),
            password: password.map(str::to_string),
        });
    }
    accounts
}

/// Decode a WindTerm credential payload: either plain JSON or an encrypted
/// base64 blob sealed with the profile fingerprint.
fn decode_windterm_auth_payload(
    raw: &str,
    crypto: Option<&WindtermCrypto>,
) -> Option<serde_json::Map<String, serde_json::Value>> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
        return value.as_object().cloned();
    }
    let crypto = crypto?;
    let ciphertext =
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, raw).ok()?;
    let plaintext = decrypt_windterm_auto_login(&ciphertext, crypto).ok()?;
    let text = String::from_utf8(plaintext).ok()?;
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()?
        .as_object()
        .cloned()
}

/// WindTerm writes these files with inconsistent case on Windows.
fn find_windterm_sibling(directory: &Path, expected: &str) -> Option<std::path::PathBuf> {
    let exact = directory.join(expected);
    if exact.is_file() {
        return Some(exact);
    }
    std::fs::read_dir(directory)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.eq_ignore_ascii_case(expected))
        })
}

#[derive(Debug, Clone)]
struct WindtermOneKeyAccount {
    uuid: String,
    name: String,
    username: String,
    password: Option<String>,
}

fn parse_windterm_content_impl(
    content: &str,
    crypto: Option<&WindtermCrypto>,
    source_path: Option<&Path>,
    allow_local_files: bool,
) -> AppResult<PreparedJsonImport> {
    let entries: Vec<serde_json::Value> = serde_json::from_str(&content)
        .map_err(|e| AppError::Config(format!("Invalid WindTerm JSON: {e}")))?;

    let mut groups = Vec::new();
    let mut ssh_keys = Vec::new();
    let mut key_ids: HashMap<(String, Option<String>), String> = HashMap::new();
    let mut connections = Vec::new();
    let one_keys = load_windterm_one_keys(source_path, crypto);
    let mut passwords: Vec<config::SavedPassword> = Vec::new();
    // One saved account per one-key entry, reused by every session that
    // references it so the user sees one credential instead of duplicates.
    let mut account_ids: HashMap<String, String> = HashMap::new();

    for entry in &entries {
        let protocol = entry
            .get("session.protocol")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        // WindTerm models a local terminal as a `Shell` session whose target is
        // the executable and whose `process.*` fields carry the command line
        // and working directory.
        if protocol.eq_ignore_ascii_case("Shell") {
            if let Some(connection) = prepare_windterm_local_shell(entry) {
                if let Some(path) = &connection.group_path {
                    if !groups.contains(path) {
                        groups.push(path.clone());
                    }
                }
                connections.push(connection);
            }
            continue;
        }
        if !protocol.eq_ignore_ascii_case("SSH") {
            continue;
        }

        let target = entry
            .get("session.target")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let (host, target_username) = parse_windterm_target(target);
        if host.is_empty() {
            continue;
        }

        let name = entry
            .get("session.label")
            .and_then(|v| v.as_str())
            .and_then(normalize_windterm_string_ref)
            .unwrap_or(&host)
            .to_string();

        let auto_login = match parse_windterm_auto_login(entry, crypto) {
            Ok(auto_login) => auto_login,
            Err(error) => {
                tracing::warn!(
                    session_name = %name,
                    session_target = %target,
                    %error,
                    "Skipping unreadable WindTerm auto-login credentials during session import"
                );
                None
            }
        };

        let port = match entry.get("session.port").and_then(|v| v.as_u64()) {
            Some(port) if (1..=u64::from(u16::MAX)).contains(&port) => port as u16,
            Some(_) => continue,
            None => 22,
        };

        let group_path = parse_windterm_group_path(entry);
        if let Some(path) = &group_path {
            if !groups.contains(path) {
                groups.push(path.clone());
            }
        }

        let username = auto_login
            .as_ref()
            .and_then(|payload| payload.get("session.user"))
            .and_then(|value| value.as_str())
            .and_then(normalize_windterm_string_ref)
            .map(str::to_string)
            .unwrap_or(target_username);

        let description = entry
            .get("session.description")
            .and_then(|v| v.as_str())
            .and_then(normalize_windterm_string_ref)
            .map(str::to_string);
        let icon = entry
            .get("session.icon")
            .and_then(|v| v.as_str())
            .and_then(normalize_windterm_string_ref)
            .map(str::to_string);
        let x11_forwarding = entry
            .get("ssh.x11")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        // A session that points at a one-key login uses that saved account
        // instead of embedding its own password.
        let linked_one_key = entry
            .get("session.oneKey")
            .and_then(|value| value.as_str())
            .and_then(normalize_windterm_string_ref)
            .and_then(|uuid| one_keys.iter().find(|account| account.uuid == uuid));
        let auth = match linked_one_key {
            Some(account) => {
                let account_id = account_ids
                    .entry(account.uuid.clone())
                    .or_insert_with(|| {
                        let id = uuid::Uuid::new_v4().to_string();
                        passwords.push(config::SavedPassword {
                            id: id.clone(),
                            sort_order: 0,
                            name: account.name.clone(),
                            username: account.username.clone(),
                            password: account
                                .password
                                .as_deref()
                                .and_then(|password| encrypt_import_secret(password).ok()),
                            has_password: account.password.is_some(),
                        });
                        id
                    })
                    .clone();
                ConnectionAuth {
                    mode: "password".to_string(),
                    account_id: Some(account_id),
                    password_source: Some("account".to_string()),
                    password_id: None,
                    password: None,
                    key_id: None,
                    otp_id: None,
                    auto_fill_otp: false,
                    has_password: false,
                }
            }
            None => prepare_windterm_auth(
                allow_local_files,
                entry,
                auto_login.as_ref(),
                source_path,
                &name,
                &mut ssh_keys,
                &mut key_ids,
            )?,
        };

        connections.push(PreparedJsonConnection {
            name,
            config: ConnectionType::Ssh {
                host,
                port,
                username,
                backspace_mode: "del".to_string(),
                x11_forwarding,
                auth_agent_endpoint: None,
                legacy_agent_forwarding: None,
                agent_forwarding_config: None,
                encoding: String::new(),
                dynamic_tab_title: false,
            },
            group_path,
            description,
            tags: Vec::new(),
            sort_order: 0,
            icon,
            auth: Some(auth),
        });
    }

    Ok(PreparedJsonImport {
        groups,
        passwords,
        ssh_keys,
        connections,
    })
}

/// WindTerm's `Shell` sessions are local terminals: `target` is the executable,
/// `process.arguments` the extra command line and `process.workingDirectory`
/// the start directory. Only `$(HomeDir)`/`${HomeDir}` are expanded; other
/// WindTerm variables point at its own installation and are kept verbatim.
fn prepare_windterm_local_shell(entry: &serde_json::Value) -> Option<PreparedJsonConnection> {
    let text = |key: &str| {
        entry
            .get(key)
            .and_then(|value| value.as_str())
            .and_then(normalize_windterm_string_ref)
            .map(str::to_string)
    };
    let target = text("session.target")?;
    let name = text("session.label").unwrap_or_else(|| target.clone());
    if name.is_empty() {
        return None;
    }
    Some(PreparedJsonConnection {
        name,
        config: ConnectionType::LocalTerminal {
            shell_path: expand_windterm_home(&target),
            shell_args: text("process.arguments")
                .map(|args| expand_windterm_home(&args))
                .unwrap_or_default(),
            working_dir: text("process.workingDirectory").map(|dir| expand_windterm_home(&dir)),
            ai_execution_profile: AiExecutionProfile::Auto,
            encoding: String::new(),
            dynamic_tab_title: false,
        },
        group_path: parse_windterm_group_path(entry),
        description: text("session.description"),
        tags: Vec::new(),
        sort_order: 0,
        icon: text("session.icon"),
        auth: None,
    })
}

fn expand_windterm_home(value: &str) -> String {
    let Some(home) = dirs::home_dir() else {
        return value.to_string();
    };
    let home = home.to_string_lossy();
    value
        .replace("$(HomeDir)", &home)
        .replace("${HomeDir}", &home)
}

fn parse_windterm_target(target: &str) -> (String, String) {
    let target = target.trim();
    if let Some((username, host)) = target.rsplit_once('@') {
        if !username.is_empty() && !host.is_empty() {
            return (host.to_string(), username.to_string());
        }
    }
    (target.to_string(), "root".to_string())
}

fn load_windterm_crypto(
    sessions_path: &Path,
    windterm_master_password: Option<&str>,
) -> AppResult<Option<WindtermCrypto>> {
    let Some(profile_dir) = sessions_path.parent().and_then(Path::parent) else {
        return Ok(None);
    };
    let config_path = profile_dir.join("user.config");
    if !config_path.is_file() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| AppError::Config(format!("Cannot read WindTerm user.config: {e}")))?;
    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| AppError::Config(format!("Invalid WindTerm user.config: {e}")))?;
    let fingerprint = config
        .get("application.fingerprint")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::Config("WindTerm user.config is missing application.fingerprint".to_string())
        })?;
    let master_password_enabled = config
        .get("application.masterPassword")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if master_password_enabled && windterm_master_password.unwrap_or_default().is_empty() {
        return Err(AppError::Config(
            "WindTerm master password is required".to_string(),
        ));
    }

    Ok(Some(derive_windterm_crypto(
        fingerprint,
        windterm_master_password.unwrap_or_default(),
    )))
}

fn derive_windterm_crypto(fingerprint: &str, master_password: &str) -> WindtermCrypto {
    let mut material = [0_u8; WINDTERM_DERIVED_LENGTH];
    pbkdf2_hmac::<Sha3_512>(
        master_password.as_bytes(),
        fingerprint.as_bytes(),
        WINDTERM_PBKDF2_ITERATIONS,
        &mut material,
    );

    let mut key = [0_u8; WINDTERM_AES_KEY_LENGTH];
    key.copy_from_slice(&material[..WINDTERM_AES_KEY_LENGTH]);
    let mut iv = [0_u8; WINDTERM_AES_IV_LENGTH];
    iv.copy_from_slice(&material[WINDTERM_AES_KEY_LENGTH..]);
    WindtermCrypto { key, iv }
}

fn parse_windterm_auto_login(
    entry: &serde_json::Value,
    crypto: Option<&WindtermCrypto>,
) -> AppResult<Option<serde_json::Map<String, serde_json::Value>>> {
    let Some(raw) = entry
        .get("session.autoLogin")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
        return value.as_object().cloned().map(Some).ok_or_else(|| {
            AppError::Config("WindTerm session.autoLogin must decode to a JSON object".to_string())
        });
    }

    let crypto = crypto.ok_or_else(|| {
        AppError::Config(
            "WindTerm session.autoLogin is encrypted but user.config was not found".to_string(),
        )
    })?;
    let ciphertext = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, raw)
        .map_err(|_| AppError::Config("Failed to decode WindTerm autoLogin data".to_string()))?;
    let plaintext = decrypt_windterm_auto_login(&ciphertext, crypto)?;
    let plaintext = String::from_utf8(plaintext).map_err(|_| {
        AppError::Config("Failed to decode decrypted WindTerm autoLogin text".to_string())
    })?;
    let value: serde_json::Value = serde_json::from_str(&plaintext).map_err(|_| {
        AppError::Config("Failed to parse decrypted WindTerm autoLogin JSON".to_string())
    })?;
    value.as_object().cloned().map(Some).ok_or_else(|| {
        AppError::Config("WindTerm session.autoLogin must decode to a JSON object".to_string())
    })
}

fn decrypt_windterm_auto_login(ciphertext: &[u8], crypto: &WindtermCrypto) -> AppResult<Vec<u8>> {
    if ciphertext.is_empty() || ciphertext.len() % WINDTERM_AES_IV_LENGTH != 0 {
        return Err(AppError::Config(
            "Invalid WindTerm autoLogin ciphertext length".to_string(),
        ));
    }

    let mut buffer = ciphertext.to_vec();
    Aes256CbcDecryptor::new(&crypto.key.into(), &crypto.iv.into())
        .decrypt_padded_mut::<Pkcs7>(&mut buffer)
        .map(|plaintext| plaintext.to_vec())
        .map_err(|_| AppError::Config("Failed to decrypt WindTerm autoLogin data".to_string()))
}

fn parse_windterm_group_path(entry: &serde_json::Value) -> Option<Vec<String>> {
    entry
        .get("session.group")
        .and_then(|v| v.as_str())
        .and_then(|s| {
            let segments: Vec<String> = s
                .split('>')
                .filter_map(|seg| normalize_windterm_string_ref(seg).map(str::to_string))
                .collect();
            if segments.is_empty() {
                None
            } else {
                Some(segments)
            }
        })
}

fn prepare_windterm_auth(
    allow_local_files: bool,
    entry: &serde_json::Value,
    auto_login: Option<&serde_json::Map<String, serde_json::Value>>,
    source_path: Option<&Path>,
    session_name: &str,
    ssh_keys: &mut Vec<config::SshKey>,
    key_ids: &mut HashMap<(String, Option<String>), String>,
) -> AppResult<ConnectionAuth> {
    if let Some(password) = auto_login
        .and_then(|payload| {
            let enabled = payload
                .get("PasswordEnabled")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            if enabled {
                payload.get("Password").and_then(|value| value.as_str())
            } else {
                None
            }
        })
        .and_then(normalize_windterm_string_ref)
    {
        return Ok(ConnectionAuth {
            mode: "password".to_string(),
            account_id: None,
            password_source: None,
            password_id: None,
            password: Some(encrypt_import_secret(password)?),
            key_id: None,
            otp_id: None,
            auto_fill_otp: false,
            has_password: false,
        });
    }

    if allow_local_files
        && let Some(key_id) = import_windterm_key(
            entry,
            auto_login,
            source_path,
            session_name,
            ssh_keys,
            key_ids,
        )?
    {
        return Ok(ConnectionAuth {
            mode: "key".to_string(),
            account_id: None,
            password_source: None,
            password_id: None,
            password: None,
            key_id: Some(key_id),
            otp_id: None,
            auto_fill_otp: false,
            has_password: false,
        });
    }

    Ok(ConnectionAuth {
        mode: "none".to_string(),
        account_id: None,
        password_source: None,
        password_id: None,
        password: None,
        key_id: None,
        otp_id: None,
        auto_fill_otp: false,
        has_password: false,
    })
}

fn import_windterm_key(
    entry: &serde_json::Value,
    auto_login: Option<&serde_json::Map<String, serde_json::Value>>,
    source_path: Option<&Path>,
    session_name: &str,
    ssh_keys: &mut Vec<config::SshKey>,
    key_ids: &mut HashMap<(String, Option<String>), String>,
) -> AppResult<Option<String>> {
    let mut key_paths = Vec::new();
    if let Some(path) = auto_login
        .and_then(|payload| payload.get("Public Key"))
        .and_then(|value| value.as_object())
        .and_then(|object| object.get("windows.path"))
        .and_then(|value| value.as_str())
        .and_then(normalize_windterm_string_ref)
    {
        key_paths.push(path);
    }
    if let Some(path) = entry
        .get("ssh.identityFilePath.windows")
        .and_then(|value| value.as_str())
        .and_then(normalize_windterm_string_ref)
    {
        if !key_paths.contains(&path) {
            key_paths.push(path);
        }
    }
    if key_paths.is_empty() {
        return Ok(None);
    }

    let Some((key_path, resolved_path, key_content)) = key_paths.into_iter().find_map(|path| {
        let resolved = resolve_windterm_key_path(path, source_path)?;
        let content = std::fs::read_to_string(&resolved).ok()?;
        if content.trim().is_empty() {
            None
        } else {
            Some((path, resolved, content))
        }
    }) else {
        return Ok(None);
    };

    let passphrase = auto_login
        .and_then(|payload| payload.get("Public Key"))
        .and_then(|value| value.as_object())
        .and_then(|object| object.get("windows.pass"))
        .and_then(|value| value.as_str())
        .and_then(normalize_windterm_string_ref)
        .map(str::to_string);
    let normalized_path = resolved_path.to_string_lossy().replace('/', "\\");
    let dedupe_key = (normalized_path.clone(), passphrase.clone());
    if let Some(id) = key_ids.get(&dedupe_key) {
        return Ok(Some(id.clone()));
    }
    if passphrase.is_none()
        && let Some((_, id)) = key_ids
            .iter()
            .find(|((path, _), _)| path == &normalized_path)
    {
        return Ok(Some(id.clone()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let display_name = Path::new(key_path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map_or_else(
            || format!("{session_name} SSH key"),
            |file_name| format!("{session_name} ({file_name})"),
        );
    ssh_keys.push(config::SshKey {
        sort_order: 0,
        id: id.clone(),
        name: display_name,
        key: Some(encrypt_import_secret(&key_content)?),
        cert: None,
        passphrase: passphrase
            .as_deref()
            .map(encrypt_import_secret)
            .transpose()?,
        key_data: None,
        cert_data: None,
        key_file_path: None,
        cert_file_path: None,
        has_key_data: false,
        has_cert_data: false,
    });
    key_ids.insert(dedupe_key, id.clone());
    Ok(Some(id))
}

fn resolve_windterm_key_path(path: &str, source_path: Option<&Path>) -> Option<std::path::PathBuf> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }

    let home = dirs::home_dir();
    let mut expanded = trimmed.to_string();
    if let Some(home) = &home {
        let home_str = home.to_string_lossy();
        expanded = expanded
            .replace("$(HomeDir)", &home_str)
            .replace("${HomeDir}", &home_str);
        if expanded == "~" {
            expanded = home_str.to_string();
        } else if let Some(rest) = expanded
            .strip_prefix("~/")
            .or_else(|| expanded.strip_prefix("~\\"))
        {
            expanded = home.join(rest).to_string_lossy().to_string();
        }
    }

    let candidate = Path::new(&expanded);
    if candidate.is_absolute() {
        return Some(candidate.to_path_buf());
    }

    source_path
        .and_then(Path::parent)
        .map(|parent| parent.join(candidate))
        .or_else(|| Some(candidate.to_path_buf()))
}

fn normalize_windterm_string_ref(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

// ── NyaTerm JSON (.json) ───────────────────────────────────────────────────
