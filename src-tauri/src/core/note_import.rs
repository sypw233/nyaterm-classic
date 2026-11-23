//! Markdown import: turn .md files and directories into notes/folders.
//!
//! Import is additive: it creates new folders and notes through the regular
//! storage primitives, so existing user data is never replaced. A single
//! imported file goes into the chosen parent folder; a directory is recreated
//! as a folder tree with the same shape.

use crate::config::NoteDocument;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteImportResult {
    pub folder_count: usize,
    pub note_count: usize,
    /// Ids of the top-level nodes created, useful for selecting them in the UI.
    pub root_ids: Vec<String>,
}

#[derive(Debug, Clone)]
struct PlannedFolder {
    source: PathBuf,
    name: String,
    parent_source: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct PlannedNote {
    title: String,
    parent_source: Option<PathBuf>,
    markdown: String,
}

/// Pure plan of an import from one or more paths. Paths keep their identity so
/// a directory tree can be rebuilt with correct parent links.
fn plan_paths(paths: &[PathBuf]) -> AppResult<(Vec<PlannedFolder>, Vec<PlannedNote>)> {
    let mut folders = Vec::new();
    let mut notes = Vec::new();

    for path in paths {
        let name = path
            .file_stem()
            .or_else(|| path.file_name())
            .and_then(|value| value.to_str())
            .unwrap_or("Untitled")
            .trim()
            .to_string();
        if path.is_file() {
            if !is_markdown(path) {
                continue;
            }
            notes.push(PlannedNote {
                title: if name.is_empty() { "Untitled" } else { &name }.to_string(),
                parent_source: None,
                markdown: read_markdown(path)?,
            });
        } else if path.is_dir() {
            let root_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("Imported")
                .trim()
                .to_string();
            let root_name = if root_name.is_empty() { "Imported" } else { &root_name }.to_string();
            folders.push(PlannedFolder {
                source: path.clone(),
                name: root_name,
                parent_source: None,
            });
            plan_directory(path, &mut folders, &mut notes)?;
        }
    }
    Ok((folders, notes))
}

fn plan_directory(
    dir: &Path,
    folders: &mut Vec<PlannedFolder>,
    notes: &mut Vec<PlannedNote>,
) -> AppResult<()> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(AppError::Io)?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .collect();
    entries.sort();
    for entry in entries {
        if entry.is_dir() {
            let name = entry
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("Folder")
                .trim()
                .to_string();
            folders.push(PlannedFolder {
                source: entry.clone(),
                name: if name.is_empty() { "Folder" } else { &name }.to_string(),
                parent_source: Some(dir.to_path_buf()),
            });
            plan_directory(&entry, folders, notes)?;
        } else if entry.is_file() && is_markdown(&entry) {
            let title = entry
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("Untitled")
                .trim()
                .to_string();
            notes.push(PlannedNote {
                title: if title.is_empty() { "Untitled" } else { &title }.to_string(),
                parent_source: Some(dir.to_path_buf()),
                markdown: read_markdown(&entry)?,
            });
        }
    }
    Ok(())
}

fn is_markdown(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).as_deref(),
        Some("md") | Some("markdown")
    )
}

fn read_markdown(path: &Path) -> AppResult<String> {
    fs::read_to_string(path).map_err(|error| {
        AppError::Config(format!("Failed to read '{}': {error}", path.display()))
    })
}

/// Import the given paths (files and/or directories) into the notes library.
///
/// Existing notes and folders are kept. New nodes are created under
/// `target_parent_id`; directory structure is recreated with folders.
pub fn import_notes(
    paths: &[String],
    target_parent_id: Option<String>,
) -> AppResult<NoteImportResult> {
    let sources: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    let (folders, notes) = plan_paths(&sources)?;
    if folders.is_empty() && notes.is_empty() {
        return Err(AppError::Config(
            "No Markdown files or folders found to import".to_string(),
        ));
    }

    // Map an imported source path to the real folder id created in storage.
    let mut folder_ids: HashMap<PathBuf, String> = HashMap::new();
    let mut root_ids = Vec::new();

    // Folders are planned parent-first, so this pass resolves parent links.
    for folder in &folders {
        let parent_id = match &folder.parent_source {
            Some(path) => folder_ids.get(path).cloned(),
            None => target_parent_id.clone(),
        };
        let created = crate::storage::create_note_folder(parent_id, Some(folder.name.clone()))?;
        folder_ids.insert(folder.source.clone(), created.id.clone());
        if folder.parent_source.is_none() {
            root_ids.push(created.id);
        }
    }

    for note in &notes {
        let parent_id = match &note.parent_source {
            Some(path) => folder_ids.get(path).cloned(),
            None => target_parent_id.clone(),
        };
        let created = crate::storage::create_note(
            parent_id,
            Some(note.title.clone()),
            Some(note.markdown.clone()),
        )?;
        if note.parent_source.is_none() {
            root_ids.push(created.id);
        }
    }

    Ok(NoteImportResult {
        folder_count: folders.len(),
        note_count: notes.len(),
        root_ids,
    })
}

/// Read an external markdown file for display in the read-only editor.
pub fn read_external_note(path: &str) -> AppResult<NoteDocument> {
    let file = Path::new(path);
    if !is_markdown(file) {
        return Err(AppError::Config("Only Markdown files can be opened".to_string()));
    }
    let title = file
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled")
        .to_string();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    Ok(NoteDocument {
        id: path.to_string(),
        parent_id: None,
        title,
        markdown: read_markdown(file)?,
        sort_order: 0,
        revision: 0,
        created_at_ms: now,
        updated_at_ms: now,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_markdown_extensions_case_insensitively() {
        assert!(is_markdown(Path::new("note.md")));
        assert!(is_markdown(Path::new("note.MARKDOWN")));
        assert!(!is_markdown(Path::new("note.txt")));
        assert!(!is_markdown(Path::new("note.md.bak")));
    }

    #[test]
    fn plans_a_single_file_without_a_folder() {
        let dir = std::env::temp_dir().join(format!(
            "nyaterm-note-import-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("hello.md");
        fs::write(&file, "# Hello").unwrap();

        let (folders, notes) = plan_paths(&[file]).unwrap();
        assert!(folders.is_empty());
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "hello");
        assert_eq!(notes[0].markdown, "# Hello");
        assert!(notes[0].parent_source.is_none());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn plans_a_directory_tree_with_parent_links() {
        let dir = std::env::temp_dir().join(format!(
            "nyaterm-note-import-test-{}",
            uuid::Uuid::new_v4()
        ));
        let sub = dir.join("sub");
        fs::create_dir_all(&sub).unwrap();
        fs::write(dir.join("root.md"), "root").unwrap();
        fs::write(sub.join("child.md"), "child").unwrap();
        fs::write(dir.join("ignore.txt"), "no").unwrap();

        let (folders, notes) = plan_paths(&[dir.clone()]).unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].name, dir.file_name().unwrap().to_str().unwrap());
        assert!(folders[0].parent_source.is_none());
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].parent_source.as_deref(), Some(dir.as_path()));
        assert_eq!(notes[1].parent_source.as_deref(), Some(sub.as_path()));

        fs::remove_dir_all(&dir).unwrap();
    }
}
