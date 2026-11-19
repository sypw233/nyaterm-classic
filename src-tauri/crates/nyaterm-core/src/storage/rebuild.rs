//! Database health classification and explicit, confirmed rebuild.
//!
//! Opening the store must never destroy user data: a missing or corrupt
//! database is reported so the UI can ask, and only an explicit confirmation
//! rebuilds it. The damaged file is archived beside the new one rather than
//! overwritten, and the replacement is staged and validated before it replaces
//! anything. If publishing fails the original is restored.
//!
//! Credentials, known hosts and every other file in the data directory are
//! untouched: only `nyaterm.redb` is ever moved or replaced here.

use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use crate::error::{AppError, AppResult};
use crate::storage::tables::DATABASE_FILE;

/// redb's fixed file header. A file that does not start with it is not a
/// database this build can open, regardless of what redb's error message says.
const REDB_MAGIC: [u8; 9] = [b'r', b'e', b'd', b'b', 0x1A, 0x0A, 0xA9, 0x0D, 0x0A];

/// Why a database could not be opened, as far as the UI needs to know.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseHealth {
    /// The database opens and its schema matches this build.
    Healthy,
    /// The file is absent. A rebuild is safe and loses nothing on disk.
    Missing,
    /// The file exists but is empty, or its header is not a redb header.
    Corrupt,
    /// The file is a valid redb database but its schema is newer than this
    /// build understands. Rebuilding would silently discard newer data.
    UpgradeRequired,
    /// Another instance holds the database open.
    InUse,
    /// Records inside an otherwise valid database could not be decoded.
    /// Corruption in the sense above is not implied: this may be a migration
    /// bug, so a rebuild is not offered automatically.
    DataInvalid,
    /// Anything else (permissions, I/O, unknown layout).
    Unavailable,
}

impl DatabaseHealth {
    /// Only a missing or header-corrupt database may be rebuilt without further
    /// investigation: in both cases the file cannot hold readable user data.
    pub fn may_rebuild(self) -> bool {
        matches!(self, Self::Missing | Self::Corrupt)
    }

    /// True when the app can run normally against this database.
    pub fn is_healthy(self) -> bool {
        matches!(self, Self::Healthy)
    }

    pub fn code(self) -> &'static str {
        match self {
            Self::Healthy => "database_healthy",
            Self::Missing => "database_missing",
            Self::Corrupt => "database_corrupt",
            Self::UpgradeRequired => "database_upgrade_required",
            Self::InUse => "database_in_use",
            Self::DataInvalid => "database_data_invalid",
            Self::Unavailable => "database_unavailable",
        }
    }
}

/// Snapshot of the database file a rebuild confirmation is bound to.
///
/// The digest makes the confirmation stale if the file changes between the
/// question and the answer, so a rebuild can never act on a different file than
/// the one the user saw described.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatabaseRebuildTicket {
    pub data_dir: String,
    pub health: DatabaseHealth,
    /// Hex SHA-256 of the current file, or `None` when it is absent.
    pub digest: Option<String>,
}

/// Classify the database in `data_dir` without modifying anything.
pub fn inspect_database(data_dir: &Path) -> AppResult<DatabaseHealth> {
    let path = data_dir.join(DATABASE_FILE);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DatabaseHealth::Missing);
        }
        Err(error) => return Err(AppError::Io(error)),
    };
    if !metadata.is_file() || metadata.len() == 0 {
        return Ok(DatabaseHealth::Corrupt);
    }
    if !has_redb_header(&path)? {
        return Ok(DatabaseHealth::Corrupt);
    }
    match crate::storage::probe_open(&path) {
        Ok(()) => Ok(DatabaseHealth::Healthy),
        Err(AppError::Storage(message)) => {
            let lowered = message.to_ascii_lowercase();
            if lowered.contains("already open") {
                Ok(DatabaseHealth::InUse)
            } else if lowered.contains("upgrade") || lowered.contains("older file format") {
                Ok(DatabaseHealth::UpgradeRequired)
            } else if lowered.contains("json") || lowered.contains("decode") {
                Ok(DatabaseHealth::DataInvalid)
            } else {
                Ok(DatabaseHealth::Unavailable)
            }
        }
        Err(_) => Ok(DatabaseHealth::Unavailable),
    }
}

fn has_redb_header(path: &Path) -> AppResult<bool> {
    let mut file = fs::File::open(path)?;
    let mut header = [0u8; REDB_MAGIC.len()];
    match file.read_exact(&mut header) {
        Ok(()) => Ok(header == REDB_MAGIC),
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => Ok(false),
        Err(error) => Err(AppError::Io(error)),
    }
}

fn file_digest(path: &Path) -> AppResult<Option<String>> {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(AppError::Io(error)),
    };
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(Some(hex::encode(digest.finalize())))
}

/// Build a ticket describing the current state, for the confirmation prompt.
pub fn prepare_rebuild(data_dir: &Path) -> AppResult<DatabaseRebuildTicket> {
    let health = inspect_database(data_dir)?;
    if !health.may_rebuild() {
        return Err(AppError::Config(format!(
            "database cannot be rebuilt in state '{}'",
            health.code()
        )));
    }
    Ok(DatabaseRebuildTicket {
        data_dir: data_dir.to_string_lossy().into_owned(),
        health,
        digest: file_digest(&data_dir.join(DATABASE_FILE))?,
    })
}

/// Replace the damaged database with a fresh one, archiving the original.
///
/// Returns the archive path when an existing file was moved aside. The staged
/// replacement is created, opened, migrated and closed before the original is
/// touched, so a failure at any point leaves the user's data in place.
pub fn rebuild_database(ticket: &DatabaseRebuildTicket) -> AppResult<Option<PathBuf>> {
    let data_dir = PathBuf::from(&ticket.data_dir);
    fs::create_dir_all(&data_dir)?;
    let database = data_dir.join(DATABASE_FILE);

    // Re-validate: the file must still be in a rebuildable state and unchanged
    // since the user was asked.
    let health = inspect_database(&data_dir)?;
    if !health.may_rebuild() {
        return Err(AppError::Config(format!(
            "database is no longer rebuildable: '{}'",
            health.code()
        )));
    }
    if ticket.health != health || file_digest(&database)? != ticket.digest {
        return Err(AppError::Config(
            "database changed after the confirmation was requested".to_string(),
        ));
    }

    let staged = data_dir.join(format!(".{DATABASE_FILE}.rebuild-{}", uuid::Uuid::new_v4()));
    let mut archive = None;
    let mut published = false;
    let result = (|| -> AppResult<()> {
        // Stage and fully validate the replacement first.
        drop(crate::storage::Storage::open_in_dir_staged(
            &data_dir, &staged,
        )?);

        if ticket.digest.is_some() {
            let target = unique_archive_path(&data_dir);
            fs::rename(&database, &target)?;
            archive = Some(target);
        }
        fs::rename(&staged, &database)?;
        published = true;
        Ok(())
    })();

    if let Err(error) = result {
        if published {
            let _ = fs::remove_file(&database);
        }
        if let Some(archive) = &archive {
            let _ = fs::rename(archive, &database);
        }
        let _ = fs::remove_file(&staged);
        return Err(error);
    }
    Ok(archive)
}

/// A never-reused archive name beside the live database.
fn unique_archive_path(data_dir: &Path) -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    let mut candidate = data_dir.join(format!("{DATABASE_FILE}.corrupt-{stamp}"));
    let mut suffix = 1u32;
    while candidate.exists() {
        candidate = data_dir.join(format!("{DATABASE_FILE}.corrupt-{stamp}-{suffix}"));
        suffix += 1;
    }
    candidate
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nyaterm-rebuild-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_nanos())
                .unwrap_or_default()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_missing_database_is_rebuildable() {
        let dir = temp_dir("missing");
        assert_eq!(inspect_database(&dir).unwrap(), DatabaseHealth::Missing);
        let ticket = prepare_rebuild(&dir).unwrap();
        assert_eq!(ticket.digest, None);

        let archive = rebuild_database(&ticket).unwrap();
        assert_eq!(archive, None, "nothing existed to archive");
        assert!(dir.join(DATABASE_FILE).is_file());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_garbage_file_is_corrupt_and_archived_not_overwritten() {
        let dir = temp_dir("garbage");
        let database = dir.join(DATABASE_FILE);
        fs::write(&database, b"this is not a redb database").unwrap();
        assert_eq!(inspect_database(&dir).unwrap(), DatabaseHealth::Corrupt);

        let ticket = prepare_rebuild(&dir).unwrap();
        assert!(ticket.digest.is_some());
        let archive = rebuild_database(&ticket).unwrap().expect("archived");
        assert!(archive.is_file());
        assert_eq!(fs::read(&archive).unwrap(), b"this is not a redb database");
        // The live file is now a real database, not the garbage.
        assert!(has_redb_header(&database).unwrap());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_empty_file_is_corrupt() {
        let dir = temp_dir("empty");
        fs::write(dir.join(DATABASE_FILE), b"").unwrap();
        assert_eq!(inspect_database(&dir).unwrap(), DatabaseHealth::Corrupt);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_changed_database_invalidates_the_confirmation() {
        let dir = temp_dir("stale");
        let database = dir.join(DATABASE_FILE);
        fs::write(&database, b"garbage one").unwrap();
        let ticket = prepare_rebuild(&dir).unwrap();
        fs::write(&database, b"garbage two").unwrap();

        let error = rebuild_database(&ticket).unwrap_err();
        assert!(error.to_string().contains("changed"), "{error}");
        // The newer file survives untouched.
        assert_eq!(fs::read(&database).unwrap(), b"garbage two");

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_healthy_database_is_not_rebuildable() {
        let dir = temp_dir("healthy");
        drop(crate::storage::Storage::open(&dir).unwrap());
        assert_eq!(inspect_database(&dir).unwrap(), DatabaseHealth::Healthy);
        assert!(prepare_rebuild(&dir).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn archive_names_never_collide() {
        let dir = temp_dir("archive-names");
        let first = unique_archive_path(&dir);
        fs::write(&first, b"x").unwrap();
        let second = unique_archive_path(&dir);
        assert_ne!(first, second);
        fs::remove_dir_all(dir).unwrap();
    }
}
