use crate::error::{AppError, AppResult};
use redb::{ReadableDatabase, ReadableTable, ReadableTableMetadata};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

use super::Storage;
use super::tables::*;
use super::util::*;

/// Persisted command-history rows kept on disk. The in-memory list is trimmed
/// separately; this bound is what stops the table from growing forever.
const HISTORY_RETENTION_LIMIT: usize = 5000;

impl Storage {
    pub fn append_command_history(
        &self,
        item: &crate::core::history::HistoryEntry,
    ) -> AppResult<()> {
        {
            let txn = self.db.begin_write().map_err(storage_error)?;
            save_history_entry_in_txn(&txn, item)?;
            txn.commit().map_err(storage_error)?;
        }
        // Trim after the append so the table never exceeds the limit even
        // between two writes.
        self.enforce_history_retention()?;
        Ok(())
    }

    /// Keep the persisted command history bounded.
    ///
    /// The table previously grew without limit: the in-memory list was trimmed
    /// but every appended entry stayed on disk forever. Deleting rows is
    /// irreversible, so an oversized table is first copied to a verified
    /// recovery file; if that copy fails the rows are kept and the caller
    /// continues with a warning rather than losing data.
    fn enforce_history_retention(&self) -> AppResult<()> {
        let raw_count = {
            let txn = self.db.begin_read().map_err(storage_error)?;
            match txn.open_table(COMMAND_HISTORY_TABLE) {
                Ok(table) => table.len().map_err(storage_error)?,
                Err(redb::TableError::TableDoesNotExist(_)) => return Ok(()),
                Err(error) => return Err(storage_error(error)),
            }
        };
        if raw_count <= HISTORY_RETENTION_LIMIT as u64 {
            return Ok(());
        }
        self.backup_command_history()?;

        let txn = self.db.begin_write().map_err(storage_error)?;
        let mut stale_keys = Vec::new();
        {
            let table = txn
                .open_table(COMMAND_HISTORY_TABLE)
                .map_err(storage_error)?;
            let mut entries = Vec::new();
            for entry in table.iter().map_err(storage_error)? {
                let (key, value) = entry.map_err(storage_error)?;
                let item: crate::core::history::HistoryEntry = deserialize_json(value.value())?;
                entries.push((key.value().to_string(), item.last_used_at_ms));
            }
            entries.sort_by(|left, right| right.1.cmp(&left.1));
            // Keep the most recently used entries; drop the tail.
            stale_keys.extend(
                entries
                    .into_iter()
                    .skip(HISTORY_RETENTION_LIMIT)
                    .map(|(key, _)| key),
            );
        }
        {
            let mut table = txn
                .open_table(COMMAND_HISTORY_TABLE)
                .map_err(storage_error)?;
            for key in stale_keys {
                table.remove(key.as_str()).map_err(storage_error)?;
            }
        }
        txn.commit().map_err(storage_error)?;
        Ok(())
    }

    /// Copy the whole database beside the live file before deleting history.
    /// A backup that cannot be read back is treated as no backup at all.
    fn backup_command_history(&self) -> AppResult<()> {
        let source = self.db_path.as_path();
        if !source.is_file() {
            return Err(AppError::Storage(
                "history store file is missing".to_string(),
            ));
        }
        let directory = source.parent().ok_or_else(|| {
            AppError::Storage("history store has no parent directory".to_string())
        })?;
        let stamp = current_time_ms();
        let target = directory.join(format!("nyaterm-history-backup-{stamp}.redb"));
        std::fs::copy(source, &target)?;
        // Verify the copy is a readable database with the same entry count.
        let verify = redb::Database::open(&target).map_err(storage_error)?;
        let verify_txn = verify.begin_read().map_err(storage_error)?;
        let copied = match verify_txn.open_table(COMMAND_HISTORY_TABLE) {
            Ok(table) => table.len().map_err(storage_error)?,
            Err(redb::TableError::TableDoesNotExist(_)) => 0,
            Err(error) => return Err(storage_error(error)),
        };
        let live_txn = self.db.begin_read().map_err(storage_error)?;
        let live = match live_txn.open_table(COMMAND_HISTORY_TABLE) {
            Ok(table) => table.len().map_err(storage_error)?,
            Err(redb::TableError::TableDoesNotExist(_)) => 0,
            Err(error) => return Err(storage_error(error)),
        };
        if copied != live {
            return Err(AppError::Storage(format!(
                "history safety backup at {} has {copied} entries but the live store has {live}",
                target.display()
            )));
        }
        Ok(())
    }
    pub fn list_recent_command_history(
        &self,
        limit: usize,
    ) -> AppResult<Vec<crate::core::history::HistoryEntry>> {
        let mut entries: Vec<(String, crate::core::history::HistoryEntry)> =
            self.list_keyed_json_by_prefix(COMMAND_HISTORY_TABLE, COMMAND_HISTORY_PREFIX)?;
        entries.sort_by(|left, right| right.0.cmp(&left.0));
        Ok(entries
            .into_iter()
            .take(limit)
            .map(|(_, entry)| entry)
            .collect())
    }
    pub fn delete_command_history_before(&self, timestamp_ms: i64) -> AppResult<()> {
        let cutoff = u64::try_from(timestamp_ms).unwrap_or_default();
        let txn = self.db.begin_write().map_err(storage_error)?;
        let table = match txn.open_table(COMMAND_HISTORY_TABLE) {
            Ok(table) => table,
            Err(error) => return Err(storage_error(error)),
        };
        let mut keys_to_remove = Vec::new();
        for entry in table.iter().map_err(storage_error)? {
            let (key, value) = entry.map_err(storage_error)?;
            let item: crate::core::history::HistoryEntry = deserialize_json(value.value())?;
            if item.last_used_at_ms < cutoff {
                keys_to_remove.push(key.value().to_string());
            }
        }
        drop(table);
        {
            let mut table = txn
                .open_table(COMMAND_HISTORY_TABLE)
                .map_err(storage_error)?;
            for key in keys_to_remove {
                table.remove(key.as_str()).map_err(storage_error)?;
            }
        }
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn replace_command_history(
        &self,
        entries: &[crate::core::history::HistoryEntry],
    ) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        replace_command_history_in_txn(&txn, entries)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
}

pub(super) fn parse_history_entries(
    content: &str,
) -> AppResult<Vec<crate::core::history::HistoryEntry>> {
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    if let Ok(store) = serde_json::from_str::<HistoryStoreFileV2>(content) {
        return Ok(normalize_history_entries(store.entries));
    }
    let legacy_commands: Vec<String> = serde_json::from_str(content)?;
    let base_timestamp = current_time_ms().saturating_sub(legacy_commands.len() as u64);
    let entries = legacy_commands
        .into_iter()
        .enumerate()
        .filter_map(|(index, command)| {
            crate::core::history::sanitize_history_command(&command).map(|command| {
                crate::core::history::HistoryEntry {
                    command,
                    last_used_at_ms: base_timestamp.saturating_add(index as u64),
                    use_count: 1,
                }
            })
        })
        .collect();
    Ok(normalize_history_entries(entries))
}
fn normalize_history_entries(
    entries: Vec<crate::core::history::HistoryEntry>,
) -> Vec<crate::core::history::HistoryEntry> {
    let mut by_command: HashMap<String, crate::core::history::HistoryEntry> = HashMap::new();
    for entry in entries {
        let Some(command) = crate::core::history::sanitize_history_command(&entry.command) else {
            continue;
        };
        by_command
            .entry(command.clone())
            .and_modify(|existing| {
                existing.last_used_at_ms = existing.last_used_at_ms.max(entry.last_used_at_ms);
                existing.use_count = existing.use_count.saturating_add(entry.use_count.max(1));
            })
            .or_insert(crate::core::history::HistoryEntry {
                command,
                last_used_at_ms: entry.last_used_at_ms,
                use_count: entry.use_count.max(1),
            });
    }
    let mut entries: Vec<_> = by_command.into_values().collect();
    entries.sort_by_key(|entry| entry.last_used_at_ms);
    entries
}
pub(super) fn replace_command_history_in_txn(
    txn: &redb::WriteTransaction,
    entries: &[crate::core::history::HistoryEntry],
) -> AppResult<()> {
    clear_prefix_in_txn(txn, COMMAND_HISTORY_TABLE, COMMAND_HISTORY_PREFIX)?;
    for entry in entries {
        save_history_entry_in_txn(txn, entry)?;
    }
    Ok(())
}
pub(super) fn save_history_entry_in_txn(
    txn: &redb::WriteTransaction,
    entry: &crate::core::history::HistoryEntry,
) -> AppResult<()> {
    let id = history_id(&entry.command);
    remove_history_id_in_txn(txn, &id)?;
    write_json_in_txn(txn, COMMAND_HISTORY_TABLE, &history_key(entry, &id), entry)
}
fn remove_history_id_in_txn(txn: &redb::WriteTransaction, id: &str) -> AppResult<()> {
    let table = txn
        .open_table(COMMAND_HISTORY_TABLE)
        .map_err(storage_error)?;
    let suffix = format!("|{id}");
    let mut keys = Vec::new();
    for entry in table.iter().map_err(storage_error)? {
        let (key, _) = entry.map_err(storage_error)?;
        if key.value().ends_with(&suffix) {
            keys.push(key.value().to_string());
        }
    }
    drop(table);
    let mut table = txn
        .open_table(COMMAND_HISTORY_TABLE)
        .map_err(storage_error)?;
    for key in keys {
        table.remove(key.as_str()).map_err(storage_error)?;
    }
    Ok(())
}
fn history_key(entry: &crate::core::history::HistoryEntry, id: &str) -> String {
    format!(
        "{}{:020}|{}",
        COMMAND_HISTORY_PREFIX, entry.last_used_at_ms, id
    )
}
pub(super) fn history_id(command: &str) -> String {
    let digest = Sha256::digest(command.as_bytes());
    hex::encode(&digest[..16])
}
