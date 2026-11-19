//! File-system path completion for the terminal suggestion popup.
//!
//! The pure token parsing and ranking live in `nyaterm_core::core::path_completion`;
//! this module resolves the directory to list, talks to the right backend
//! (SFTP for SSH sessions, the local file system for Local sessions) and keeps a
//! very short listing cache so typing does not re-list on every keystroke.

use crate::core::{SessionManager, SessionType};
use crate::error::AppResult;
use nyaterm_core::core::path_completion::{
    MAX_LISTED_ENTRIES, PathCandidate, PathEntry, path_candidates, path_query, resolve_directory,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Manager;

/// A listing this old is refetched; directory contents change rarely enough
/// that a couple of seconds of staleness is invisible while typing.
const LISTING_TTL: Duration = Duration::from_secs(2);
/// Failures are cached briefly so a broken path does not re-hit the network on
/// every keystroke.
const FAILURE_TTL: Duration = Duration::from_millis(500);
/// Hard ceiling for one listing. Suggestions are best-effort: on timeout the
/// popup simply shows the non-path providers.
const LISTING_BUDGET: Duration = Duration::from_millis(2_500);
const MAX_CACHED_LISTINGS: usize = 48;
/// Resolving `~` opens a channel on a remote session, so the answer is kept
/// longer than a directory listing. Home directories do not move.
const HOME_TTL: Duration = Duration::from_secs(300);
/// Suggestions shown at once from the path provider.
const PATH_CANDIDATE_LIMIT: usize = 12;

type Listing = Arc<Vec<PathEntry>>;

#[derive(Default)]
pub struct PathCompletionCache {
    listings: Mutex<HashMap<String, (Instant, Option<Listing>)>>,
    homes: Mutex<HashMap<String, (Instant, Option<String>)>>,
}

impl PathCompletionCache {
    pub fn clear_session(&self, session_id: &str) {
        let prefix = format!("{session_id}\u{0}");
        self.lock().retain(|key, _| !key.starts_with(&prefix));
        self.homes
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(session_id);
    }

    fn home(&self, session_id: &str) -> Option<Option<String>> {
        let homes = self.homes.lock().unwrap_or_else(|error| error.into_inner());
        let (at, value) = homes.get(session_id)?;
        (at.elapsed() < HOME_TTL).then(|| value.clone())
    }

    fn insert_home(&self, session_id: String, value: Option<String>) {
        let mut homes = self.homes.lock().unwrap_or_else(|error| error.into_inner());
        homes.retain(|_, (at, _)| at.elapsed() < HOME_TTL);
        homes.insert(session_id, (Instant::now(), value));
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, (Instant, Option<Listing>)>> {
        self.listings
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }

    fn get(&self, key: &str) -> Option<Option<Listing>> {
        let now = Instant::now();
        let listings = self.lock();
        let (at, value) = listings.get(key)?;
        let ttl = if value.is_some() {
            LISTING_TTL
        } else {
            FAILURE_TTL
        };
        (now.duration_since(*at) < ttl).then(|| value.clone())
    }

    fn insert(&self, key: String, value: Option<Listing>) {
        let now = Instant::now();
        let mut listings = self.lock();
        listings.retain(|_, (at, cached)| {
            let ttl = if cached.is_some() {
                LISTING_TTL
            } else {
                FAILURE_TTL
            };
            now.duration_since(*at) < ttl
        });
        while listings.len() >= MAX_CACHED_LISTINGS {
            let Some(oldest) = listings
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            listings.remove(&oldest);
        }
        listings.insert(key, (now, value));
    }
}

/// Why path completion is unavailable for this session, if it is.
fn unsupported_reason(session_type: &SessionType) -> Option<&'static str> {
    match session_type {
        // A remote shell speaking PowerShell or cmd.exe splits paths on `\`,
        // which the POSIX token parser cannot describe.
        SessionType::SSH => None,
        SessionType::Local if cfg!(windows) => Some("local Windows shells use Windows path syntax"),
        SessionType::Local => None,
        SessionType::Telnet | SessionType::Serial => Some("session type has no file system"),
    }
}

fn cache_key(session_id: &str, directory: &str) -> String {
    format!("{session_id}\u{0}{directory}")
}

fn local_home() -> Option<String> {
    dirs::home_dir().and_then(|path| path.to_str().map(str::to_string))
}

async fn session_home(
    cache: &PathCompletionCache,
    manager: Arc<SessionManager>,
    session_id: &str,
    session_type: &SessionType,
) -> Option<String> {
    if let Some(cached) = cache.home(session_id) {
        return cached;
    }
    let home = match session_type {
        SessionType::Local => local_home(),
        SessionType::SSH => tokio::time::timeout(
            LISTING_BUDGET,
            crate::core::sftp::get_home_dir(manager, session_id),
        )
        .await
        .ok()
        .and_then(Result::ok),
        _ => None,
    };
    cache.insert_home(session_id.to_string(), home.clone());
    home
}

async fn list_local(directory: &str) -> Option<Vec<PathEntry>> {
    let mut read_dir = tokio::fs::read_dir(directory).await.ok()?;
    let mut entries = Vec::new();
    while let Ok(Some(entry)) = read_dir.next_entry().await {
        if entries.len() >= MAX_LISTED_ENTRIES {
            break;
        }
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        // Follow symlinks so a link to a directory is offered by `cd`.
        let is_dir = match tokio::fs::metadata(entry.path()).await {
            Ok(metadata) => metadata.is_dir(),
            Err(_) => false,
        };
        entries.push(PathEntry { name, is_dir });
    }
    Some(entries)
}

async fn list_remote(
    manager: Arc<SessionManager>,
    session_id: &str,
    directory: &str,
) -> Option<Vec<PathEntry>> {
    let listing = crate::core::sftp::list_remote_dir(manager, session_id, directory, None)
        .await
        .ok()?;
    Some(
        listing
            .into_iter()
            .take(MAX_LISTED_ENTRIES)
            .map(|entry| PathEntry {
                name: entry.name,
                is_dir: entry.is_dir,
            })
            .collect(),
    )
}

/// List `directory` for the session, honouring the cache.
async fn list_directory(
    cache: &PathCompletionCache,
    manager: Arc<SessionManager>,
    session_id: &str,
    session_type: &SessionType,
    directory: &str,
) -> Option<Listing> {
    let key = cache_key(session_id, directory);
    if let Some(cached) = cache.get(&key) {
        return cached;
    }
    let entries = tokio::time::timeout(LISTING_BUDGET, async {
        match session_type {
            SessionType::Local => list_local(directory).await,
            SessionType::SSH => list_remote(manager, session_id, directory).await,
            _ => None,
        }
    })
    .await
    .ok()
    .flatten()
    .map(Arc::new);
    cache.insert(key, entries.clone());
    Some(entries?)
}

#[tauri::command]
pub async fn path_completion_candidates(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    input: String,
    limit: Option<usize>,
) -> AppResult<Vec<PathCandidate>> {
    // Parse first: most keystrokes are not path contexts, and this avoids
    // taking the session lock for every suggestion search.
    let Some(query) = path_query(&input) else {
        return Ok(Vec::new());
    };
    let info = state.inner().session_info(&session_id).await?;
    if unsupported_reason(&info.session_type).is_some() {
        return Ok(Vec::new());
    }

    let cwd = state.inner().session_cwd(&session_id).await.ok().flatten();
    let cache = app.state::<Arc<PathCompletionCache>>();
    let home = session_home(
        &cache,
        state.inner().clone(),
        &session_id,
        &info.session_type,
    )
    .await;
    let Some(directory) = resolve_directory(&query, cwd.as_deref(), home.as_deref()) else {
        return Ok(Vec::new());
    };
    // Only POSIX listings can be completed by this parser; a Windows cwd means
    // the shell is not the one these candidates were built for.
    if !directory.starts_with('/') {
        return Ok(Vec::new());
    }

    let Some(entries) = list_directory(
        &cache,
        state.inner().clone(),
        &session_id,
        &info.session_type,
        &directory,
    )
    .await
    else {
        return Ok(Vec::new());
    };

    Ok(path_candidates(
        &query,
        &entries,
        &input,
        limit
            .unwrap_or(PATH_CANDIDATE_LIMIT)
            .min(PATH_CANDIDATE_LIMIT),
    ))
}

#[cfg(test)]
mod tests {
    use super::PathCompletionCache;
    use nyaterm_core::core::path_completion::PathEntry;
    use std::sync::Arc;

    #[test]
    fn cache_returns_a_listing_inside_its_ttl_and_drops_it_after_clear() {
        let cache = PathCompletionCache::default();
        let key = super::cache_key("session-1", "/tmp");
        cache.insert(
            key.clone(),
            Some(Arc::new(vec![PathEntry {
                name: "a".into(),
                is_dir: true,
            }])),
        );
        assert!(cache.get(&key).is_some());
        cache.clear_session("session-1");
        assert!(cache.get(&key).is_none());
    }

    #[test]
    fn failure_entries_are_remembered_as_none() {
        let cache = PathCompletionCache::default();
        let key = super::cache_key("session-1", "/missing");
        cache.insert(key.clone(), None);
        assert_eq!(cache.get(&key), Some(None));
    }

    #[test]
    fn home_lookups_are_cached_per_session() {
        let cache = PathCompletionCache::default();
        assert!(cache.home("session-1").is_none());
        cache.insert_home("session-1".into(), Some("/home/u".into()));
        assert_eq!(cache.home("session-1"), Some(Some("/home/u".into())));
        cache.clear_session("session-1");
        assert!(cache.home("session-1").is_none());
    }

    #[test]
    fn cache_is_bounded() {
        let cache = PathCompletionCache::default();
        for index in 0..(super::MAX_CACHED_LISTINGS + 10) {
            cache.insert(super::cache_key("s", &format!("/d{index}")), None);
        }
        assert!(cache.lock().len() <= super::MAX_CACHED_LISTINGS);
    }

    #[test]
    fn telnet_and_serial_sessions_have_no_path_completion() {
        use crate::core::SessionType;
        assert!(super::unsupported_reason(&SessionType::Telnet).is_some());
        assert!(super::unsupported_reason(&SessionType::Serial).is_some());
        assert!(super::unsupported_reason(&SessionType::Local).is_none());
        assert!(super::unsupported_reason(&SessionType::SSH).is_none());
    }

    #[test]
    fn local_listing_returns_files_and_directories() {
        let directory =
            std::env::temp_dir().join(format!("nyaterm-path-completion-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(directory.join("sub")).unwrap();
        std::fs::write(directory.join("file.txt"), b"x").unwrap();

        let entries =
            tauri::async_runtime::block_on(super::list_local(directory.to_str().unwrap()))
                .expect("listing");
        assert!(
            entries
                .iter()
                .find(|entry| entry.name == "sub")
                .is_some_and(|entry| entry.is_dir)
        );
        assert!(
            entries
                .iter()
                .find(|entry| entry.name == "file.txt")
                .is_some_and(|entry| !entry.is_dir)
        );

        std::fs::remove_dir_all(directory).unwrap();
    }
}
