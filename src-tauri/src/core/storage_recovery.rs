//! Startup database recovery.
//!
//! When the database is missing or corrupt the app still has to start: the
//! only way to ask the user "rebuild it?" is to show a window. So startup
//! records the failure, the frontend renders a recovery screen, and the
//! rebuild only runs after an explicit confirmation bound to the exact file
//! the user was shown.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::storage::{
    DatabaseHealth, DatabaseRebuildTicket, inspect_database, prepare_rebuild, rebuild_database,
};

/// Why the app could not open its store, if it could not.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStartupFailure {
    pub data_dir: String,
    pub health: DatabaseHealth,
    /// The database file the user would be rebuilding.
    pub database_path: String,
}

static FAILURE: OnceLock<Mutex<Option<StorageStartupFailure>>> = OnceLock::new();

fn failure_slot() -> &'static Mutex<Option<StorageStartupFailure>> {
    FAILURE.get_or_init(|| Mutex::new(None))
}

fn set_failure(failure: Option<StorageStartupFailure>) {
    *failure_slot()
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = failure;
}

/// Record that the store could not be opened. Called once during startup.
pub fn record_startup_failure(data_dir: &PathBuf, health: DatabaseHealth) {
    set_failure(Some(StorageStartupFailure {
        data_dir: data_dir.to_string_lossy().into_owned(),
        health,
        database_path: data_dir
            .join(crate::storage::DATABASE_FILE_NAME)
            .to_string_lossy()
            .into_owned(),
    }));
}

/// The recorded failure, if startup could not open the store.
pub fn startup_failure() -> Option<StorageStartupFailure> {
    failure_slot()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
}

/// Clear the failure after a successful open or rebuild.
pub fn clear_startup_failure() {
    set_failure(None);
}

/// Classify the store in `data_dir` and try to open it.
///
/// Returns `Ok(())` when the app can proceed. A missing or corrupt database is
/// recorded and reported as an ordinary result so the window still opens; any
/// other failure is returned so startup can report it.
pub fn open_or_record(data_dir: &PathBuf) -> AppResult<()> {
    let health = inspect_database(data_dir)?;
    match health {
        DatabaseHealth::Healthy => {
            crate::storage::init(data_dir)?;
            clear_startup_failure();
            Ok(())
        }
        DatabaseHealth::Missing | DatabaseHealth::Corrupt => {
            // Leave the store uninitialized; recovery must be explicit.
            record_startup_failure(data_dir, health);
            Ok(())
        }
        DatabaseHealth::UpgradeRequired
        | DatabaseHealth::InUse
        | DatabaseHealth::DataInvalid
        | DatabaseHealth::Unavailable => {
            // Not rebuildable without discarding data the user may still want;
            // surface it rather than silently replacing the file.
            record_startup_failure(data_dir, health);
            Ok(())
        }
    }
}

/// A confirmation ticket for the current startup failure.
pub fn prepare_startup_rebuild() -> AppResult<DatabaseRebuildTicket> {
    let failure = startup_failure()
        .ok_or_else(|| AppError::Config("no database recovery is pending".to_string()))?;
    prepare_rebuild(&PathBuf::from(&failure.data_dir))
}

/// Run a confirmed rebuild and reopen the store.
pub fn commit_startup_rebuild(ticket: &DatabaseRebuildTicket) -> AppResult<Option<PathBuf>> {
    let failure = startup_failure()
        .ok_or_else(|| AppError::Config("no database recovery is pending".to_string()))?;
    if failure.data_dir != ticket.data_dir {
        return Err(AppError::Config(
            "the confirmation does not match the pending database".to_string(),
        ));
    }
    let archive = rebuild_database(ticket)?;
    let data_dir = PathBuf::from(&ticket.data_dir);
    crate::storage::init(&data_dir)?;
    clear_startup_failure();
    Ok(archive)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nyaterm-recovery-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_nanos())
                .unwrap_or_default()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_missing_database_is_recorded_instead_of_failing_startup() {
        let dir = temp_dir("missing");
        open_or_record(&dir).unwrap();
        let failure = startup_failure().expect("recorded");
        assert_eq!(failure.health, DatabaseHealth::Missing);
        assert!(prepare_startup_rebuild().is_ok());

        clear_startup_failure();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_confirmed_rebuild_makes_startup_succeed() {
        let dir = temp_dir("confirm");
        open_or_record(&dir).unwrap();
        let ticket = prepare_startup_rebuild().unwrap();
        let archive = commit_startup_rebuild(&ticket).unwrap();
        assert_eq!(archive, None);
        assert!(startup_failure().is_none());

        // A second startup now sees a healthy database.
        clear_startup_failure();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rebuild_requires_a_pending_failure() {
        clear_startup_failure();
        assert!(prepare_startup_rebuild().is_err());
    }
}
