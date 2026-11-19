//! Commands for the startup database recovery screen.

use std::path::PathBuf;

use crate::core::storage_recovery::{self, StorageStartupFailure};
use crate::error::{AppError, AppResult};
use nyaterm_core::storage::DatabaseRebuildTicket;

/// The pending startup failure, or `null` when the store opened normally.
#[tauri::command]
pub fn get_storage_startup_failure() -> Option<StorageStartupFailure> {
    storage_recovery::startup_failure()
}

/// Describe the rebuild for the confirmation prompt.
///
/// Only a missing or corrupt database yields a ticket; every other state is
/// rejected so the UI cannot offer to destroy data it does not understand.
#[tauri::command]
pub fn prepare_database_rebuild() -> AppResult<DatabaseRebuildTicket> {
    storage_recovery::prepare_startup_rebuild()
}

/// Rebuild after the user confirmed, then reopen the store.
///
/// Returns the archive path when the damaged file was preserved.
#[tauri::command]
pub fn rebuild_database(ticket: DatabaseRebuildTicket) -> AppResult<Option<String>> {
    let archive = storage_recovery::commit_startup_rebuild(&ticket)?;
    Ok(archive.map(|path| path.to_string_lossy().into_owned()))
}

/// Reveal the data directory in the OS file manager so the user can back the
/// damaged database up manually before deciding.
#[tauri::command]
pub fn reveal_storage_directory(app: tauri::AppHandle) -> AppResult<()> {
    let failure = storage_recovery::startup_failure()
        .ok_or_else(|| AppError::Config("no database recovery is pending".to_string()))?;
    let directory = PathBuf::from(&failure.data_dir);
    if !directory.is_dir() {
        return Err(AppError::Config(format!(
            "data directory is missing: {}",
            directory.display()
        )));
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(directory.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| AppError::Config(format!("failed to open data directory: {error}")))
}
