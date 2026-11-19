//! Pure POSIX path-completion logic for terminal command suggestions.
//!
//! Given the line the user is typing, work out whether the last token is a
//! file-system path, which directory it lives in, and how listed entries become
//! suggestions. Listing itself is I/O and lives in the command layer so this
//! module stays UI- and transport-independent.
//!
//! Only the token under the cursor may use tilde expansion, and quoted tokens
//! are skipped: re-quoting text that already contains quotes cannot be done
//! without changing what the shell would receive.

use std::ops::Range;

use nucleo_matcher::pattern::{AtomKind, CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};

/// Commands whose positional arguments are file-system paths.
const PATH_COMMANDS: &[&str] = &[
    "cd",
    "pushd",
    "ls",
    "ll",
    "la",
    "cat",
    "bat",
    "less",
    "more",
    "head",
    "tail",
    "vi",
    "vim",
    "nvim",
    "nano",
    "emacs",
    "code",
    "cp",
    "mv",
    "rm",
    "mkdir",
    "rmdir",
    "touch",
    "ln",
    "chmod",
    "chown",
    "chgrp",
    "stat",
    "file",
    "du",
    "df",
    "tree",
    "find",
    "source",
    ".",
    "tar",
    "unzip",
    "zip",
    "gzip",
    "gunzip",
    "rsync",
    "scp",
    "diff",
    "wc",
    "sort",
    "grep",
    "sed",
    "awk",
    "xdg-open",
    "open",
    "realpath",
    "readlink",
    "basename",
    "dirname",
    "sha256sum",
    "md5sum",
    "tee",
];

/// Commands that can only take a directory, so files are not offered.
const DIRECTORY_COMMANDS: &[&str] = &["cd", "pushd", "rmdir", "tree"];

/// Bounds the work for pathological directories (e.g. maildirs).
pub const MAX_LISTED_ENTRIES: usize = 20_000;

/// Longest line we are willing to complete. The backend rejects larger input
/// rather than spending a listing on a pasted binary blob.
const MAX_INPUT_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathQuery {
    /// Raw token bytes the chosen candidate replaces.
    pub range: Range<usize>,
    /// Unescaped text up to and including the last `/`, as the user typed it.
    pub dir_text: String,
    /// Unescaped partial entry name after the last `/`.
    pub base: String,
    pub directories_only: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathEntry {
    pub name: String,
    pub is_dir: bool,
}

/// One suggestion, already expressed as the complete line to type.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PathCandidate {
    /// Full replacement for the tracked input line.
    pub command: String,
    /// Entry name shown in the popup (directories get a trailing `/`).
    pub display: String,
    /// Highlight indices into `display`.
    pub indices: Vec<u32>,
    /// Ranking score; path-scoped matches score above every other provider.
    pub score: u32,
    pub is_dir: bool,
}

#[derive(Debug)]
struct Word {
    text: String,
    start: usize,
    end: usize,
    segment: usize,
    /// The token contained a quote character, so its raw form cannot be rebuilt.
    has_quotes: bool,
    /// The token began with an unquoted, unescaped `~`.
    tilde: bool,
}

/// Splits `input` into words and returns them with the number of the segment
/// that follows the last separator. The segment number is needed even when that
/// segment has no word yet (`cd /a;` must not complete the previous command).
fn lex(input: &str) -> Option<(Vec<Word>, usize)> {
    if input.len() > MAX_INPUT_BYTES || input.chars().any(char::is_control) {
        return None;
    }
    let chars: Vec<(usize, char)> = input.char_indices().collect();
    let mut words = Vec::new();
    let mut text = String::new();
    let mut start: Option<usize> = None;
    let mut segment = 0usize;
    let mut has_quotes = false;
    let mut tilde = false;
    let mut quote: Option<char> = None;
    let mut escaped = false;

    // Word text, start offset, end offset, quote flag and tilde flag travel
    // together; a helper keeps the three call sites in sync.
    fn push_word(
        words: &mut Vec<Word>,
        text: &mut String,
        start: usize,
        end: usize,
        segment: usize,
        has_quotes: bool,
        tilde: bool,
    ) {
        words.push(Word {
            text: std::mem::take(text),
            start,
            end,
            segment,
            has_quotes,
            tilde,
        });
    }

    let mut index = 0;
    while index < chars.len() {
        let (offset, ch) = chars[index];
        index += 1;

        if escaped {
            text.push(ch);
            escaped = false;
            continue;
        }
        if let Some(open) = quote {
            if ch == open {
                quote = None;
            } else if open == '"' && (ch == '$' || ch == '`') {
                // Command and variable substitution would change the text the
                // shell sees, so the listing could not match the real path.
                return None;
            } else {
                text.push(ch);
            }
            continue;
        }

        match ch {
            '\\' => {
                start.get_or_insert(offset);
                escaped = true;
            }
            '\'' | '"' => {
                start.get_or_insert(offset);
                has_quotes = true;
                quote = Some(ch);
            }
            ' ' | '\t' => {
                if let Some(begin) = start.take() {
                    push_word(
                        &mut words, &mut text, begin, offset, segment, has_quotes, tilde,
                    );
                    has_quotes = false;
                    tilde = false;
                }
            }
            '|' | ';' | '&' | '\n' => {
                if let Some(begin) = start.take() {
                    push_word(
                        &mut words, &mut text, begin, offset, segment, has_quotes, tilde,
                    );
                    has_quotes = false;
                    tilde = false;
                }
                segment += 1;
            }
            // Expansions, globs and redirections all change what the shell
            // would resolve, and none of them can be listed as typed.
            '$' | '`' | '(' | ')' | '{' | '}' | '<' | '>' | '*' | '?' | '[' | ']' => return None,
            '~' if start.is_none() => {
                start = Some(offset);
                tilde = true;
                text.push(ch);
            }
            '#' if start.is_none() => return None,
            _ => {
                start.get_or_insert(offset);
                text.push(ch);
            }
        }
    }
    if escaped || quote.is_some() {
        return None;
    }
    if let Some(begin) = start {
        push_word(
            &mut words,
            &mut text,
            begin,
            input.len(),
            segment,
            has_quotes,
            tilde,
        );
    }
    Some((words, segment))
}

/// Parses `input` and returns the path query for its last token.
pub fn path_query(input: &str) -> Option<PathQuery> {
    let (words, segment) = lex(input)?;
    if words.iter().all(|word| word.segment != segment) {
        return None;
    }
    let mut active: Vec<&Word> = words
        .iter()
        .filter(|word| word.segment == segment)
        .collect();
    let (range, prefix, quoted, tilde) = match active.last() {
        Some(last) if last.end == input.len() => (
            last.start..last.end,
            last.text.clone(),
            last.has_quotes,
            last.tilde,
        ),
        _ => (input.len()..input.len(), String::new(), false, false),
    };
    // A quoted token cannot be re-quoted without altering the shell's view of
    // it, so completion stops rather than producing a wrong line.
    if quoted {
        return None;
    }
    // Only the token under the cursor may perform tilde expansion; a tilde in
    // any earlier argument is a literal to the shell but would be copied here.
    if words
        .iter()
        .any(|word| word.tilde && word.end != input.len())
    {
        return None;
    }
    if active.last().is_some_and(|last| last.end == input.len()) {
        active.pop();
    }
    let command = active.first()?.text.as_str();

    path_query_with_prefix(input, range, prefix, command, tilde)
}

fn path_query_with_prefix(
    input: &str,
    range: Range<usize>,
    prefix: String,
    command: &str,
    tilde: bool,
) -> Option<PathQuery> {
    // An escaped tilde is a literal directory name, not a home expansion.
    let prefix = if prefix.starts_with('~') && !tilde {
        format!("./{prefix}")
    } else {
        prefix
    };
    if prefix.starts_with('-') {
        return None;
    }
    let command_name = command.rsplit('/').next().unwrap_or(command);
    let explicit = prefix.starts_with(['/', '~'])
        || prefix.starts_with("./")
        || prefix == "."
        || prefix == "..";
    let known = PATH_COMMANDS.contains(&command_name);
    let directories_only = DIRECTORY_COMMANDS.contains(&command_name);
    // `cd ` + nothing lists the working directory; other commands wait for a
    // character so a plain `ls ` does not flood the popup.
    let wanted = if prefix.is_empty() {
        directories_only
    } else {
        explicit || known || prefix.contains('/')
    };
    if !wanted {
        return None;
    }
    // `~user/` needs passwd lookup, which a remote listing cannot provide.
    if prefix.starts_with('~') && !(prefix == "~" || prefix.starts_with("~/")) {
        return None;
    }
    let (dir_text, base) = match prefix.rfind('/') {
        Some(index) => (
            prefix[..=index].to_string(),
            prefix[index + 1..].to_string(),
        ),
        None if prefix == "~" || prefix == "." || prefix == ".." => {
            (format!("{prefix}/"), String::new())
        }
        None => (String::new(), prefix),
    };
    // The raw token must not contain expansions we could not list.
    if input.get(range.clone()).is_none_or(has_unescaped_expansion) {
        return None;
    }
    Some(PathQuery {
        range,
        dir_text,
        base,
        directories_only,
    })
}

fn has_unescaped_expansion(raw: &str) -> bool {
    let mut chars = raw.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if chars.next().is_none() {
                return true;
            }
        } else if matches!(
            ch,
            '*' | '?' | '[' | ']' | '$' | '`' | '(' | ')' | '{' | '}' | '<' | '>'
        ) {
            return true;
        }
    }
    false
}

/// Absolute directory to list, or None when the typed prefix cannot be resolved
/// (relative path without a known working directory, or an unknown home).
pub fn resolve_directory(
    query: &PathQuery,
    cwd: Option<&str>,
    home: Option<&str>,
) -> Option<String> {
    let dir = query.dir_text.as_str();
    let joined = if dir.starts_with('/') {
        dir.to_string()
    } else if let Some(rest) = dir.strip_prefix("~/") {
        format!("{}/{rest}", home?.trim_end_matches('/'))
    } else {
        let cwd = cwd.filter(|cwd| cwd.starts_with('/'))?;
        format!("{}/{dir}", cwd.trim_end_matches('/'))
    };
    Some(joined)
}

fn needs_escape(ch: char) -> bool {
    !(ch.is_alphanumeric() || "_./~@%+=:,-".contains(ch))
}

/// Backslash-escapes shell metacharacters; a leading `~` stays live so tilde
/// expansion still happens.
pub fn escape_shell_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len() + 4);
    for (index, ch) in path.chars().enumerate() {
        if needs_escape(ch) || (index == 0 && ch == '#') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// Unicode format and line/paragraph separators (categories Cf, Zl, Zp) are
/// invisible or reorder the text around them, so a remote file name could make
/// the popup show something other than what would be inserted. C0/C1 controls
/// are rejected separately.
fn is_invisible_format(ch: char) -> bool {
    matches!(
        ch,
        '\u{00AD}'
            | '\u{061C}'
            | '\u{180E}'
            | '\u{200B}'..='\u{200F}'
            | '\u{2028}'..='\u{202E}'
            | '\u{2060}'..='\u{2064}'
            | '\u{2066}'..='\u{206F}'
            | '\u{FEFF}'
            | '\u{FFF9}'..='\u{FFFB}'
    )
}

fn entry_is_safe(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name
            .chars()
            .any(|ch| ch.is_control() || is_invisible_format(ch))
}

/// Ranks listed entries and turns them into complete replacement lines.
pub fn path_candidates(
    query: &PathQuery,
    entries: &[PathEntry],
    input: &str,
    limit: usize,
) -> Vec<PathCandidate> {
    if limit == 0 {
        return Vec::new();
    }
    let show_hidden = query.base.starts_with('.');
    let pattern = (!query.base.is_empty()).then(|| {
        Pattern::new(
            &query.base,
            CaseMatching::Smart,
            Normalization::Smart,
            AtomKind::Fuzzy,
        )
    });
    let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
    let mut buf = Vec::new();
    let mut ranked: Vec<(bool, u32, bool, String, Vec<u32>)> = Vec::new();

    for entry in entries.iter().take(MAX_LISTED_ENTRIES) {
        if !entry_is_safe(&entry.name)
            || (query.directories_only && !entry.is_dir)
            || (!show_hidden && entry.name.starts_with('.'))
        {
            continue;
        }
        let (score, indices) = match pattern.as_ref() {
            None => (0, Vec::new()),
            Some(pattern) => {
                let haystack = Utf32Str::new(&entry.name, &mut buf);
                let Some(score) = pattern.score(haystack, &mut matcher) else {
                    continue;
                };
                let mut indices = Vec::new();
                pattern.indices(haystack, &mut matcher, &mut indices);
                indices.sort_unstable();
                indices.dedup();
                (score, indices)
            }
        };
        let prefix = !query.base.is_empty() && entry.name.starts_with(&query.base);
        ranked.push((prefix, score, entry.is_dir, entry.name.clone(), indices));
    }

    // Prefix matches lead, then the fuzzy score, then directories, then name so
    // the order is deterministic across listings.
    ranked.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then(right.1.cmp(&left.1))
            .then(right.2.cmp(&left.2))
            .then(left.3.cmp(&right.3))
    });

    // Path rows lead once the user typed a directory part (`cd /va`); a bare
    // name (`cd pr`) keeps history and catalog rows first.
    let base_score = if query.dir_text.is_empty() {
        0
    } else {
        1_000_000
    };
    let total = ranked.len().min(limit);
    ranked
        .into_iter()
        .take(total)
        .enumerate()
        .filter_map(|(index, (_, _, is_dir, name, indices))| {
            let display = if is_dir { format!("{name}/") } else { name };
            let anchor = if query.dir_text.is_empty() && display.starts_with(['~', '=', '-']) {
                "./"
            } else {
                ""
            };
            let insert_text = escape_shell_path(&format!("{anchor}{}{display}", query.dir_text));
            let command = format!(
                "{}{}{}",
                &input[..query.range.start],
                insert_text,
                &input[query.range.end..]
            );
            if command.len() > MAX_INPUT_BYTES {
                return None;
            }
            Some(PathCandidate {
                command,
                display,
                indices,
                score: base_score + (total - index) as u32,
                is_dir,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{PathEntry, escape_shell_path, path_candidates, path_query, resolve_directory};

    fn query(input: &str) -> Option<super::PathQuery> {
        path_query(input)
    }

    fn entry(name: &str, is_dir: bool) -> PathEntry {
        PathEntry {
            name: name.into(),
            is_dir,
        }
    }

    #[test]
    fn splits_the_typed_token_at_the_last_slash() {
        let q = query("cd /va").unwrap();
        assert_eq!((q.dir_text.as_str(), q.base.as_str()), ("/", "va"));
        assert_eq!(q.range, 3..6);
        assert!(q.directories_only);

        let q = query("ls ./src/ma").unwrap();
        assert_eq!((q.dir_text.as_str(), q.base.as_str()), ("./src/", "ma"));
        assert_eq!(q.range, 3..11);
    }

    #[test]
    fn ignores_flags_wildcards_and_unknown_commands() {
        assert!(query("ls -").is_none());
        assert!(query("ls *.rs").is_none());
        assert!(query("mytool abc").is_none());
        assert!(query("mytool /etc/ho").is_some());
        assert!(query("ls ").is_none());
        assert!(query("cd ").is_some());
        assert!(query("cd ~user/x").is_none());
    }

    #[test]
    fn skips_quoted_tokens_and_substitutions() {
        assert!(query("cd 'my dir/").is_none());
        assert!(query("cd \"my dir/x").is_none());
        assert!(query("echo $HOME/").is_none());
        assert!(query("cd my\\").is_none());
    }

    #[test]
    fn only_the_token_being_completed_may_start_with_a_tilde() {
        let q = query("cd ~/pr").unwrap();
        assert_eq!((q.dir_text.as_str(), q.base.as_str()), ("~/", "pr"));
        assert_eq!(q.range, 3..7);
        assert!(query("cp ~/a ~/b").is_none());
        assert!(query("cp ~/a /tmp/b").is_none());
        assert_eq!(query("cd H/pr").unwrap().dir_text, "H/");
        assert_eq!(query("cd ~").unwrap().dir_text, "~/");
    }

    #[test]
    fn resolves_absolute_relative_and_home_directories() {
        let q = query("cd /var/l").unwrap();
        assert_eq!(resolve_directory(&q, None, None).unwrap(), "/var/");

        let q = query("cd src/fe").unwrap();
        assert_eq!(
            resolve_directory(&q, Some("/srv/app/"), None).unwrap(),
            "/srv/app/src/"
        );
        assert!(resolve_directory(&q, None, None).is_none());

        let q = query("cd ~/pr").unwrap();
        assert_eq!(
            resolve_directory(&q, None, Some("/home/u/")).unwrap(),
            "/home/u/"
        );

        let q = query("cd ~").unwrap();
        assert_eq!(q.dir_text, "~/");
        assert_eq!(
            resolve_directory(&q, None, Some("/home/u/")).unwrap(),
            "/home/u/"
        );
    }

    #[test]
    fn escaped_directories_continue_completion_without_changing_ranges() {
        for (input, directory, base) in [
            (r"cd my\ dir/sub", "my dir/", "sub"),
            (r"cd my\ dir/", "my dir/", ""),
            (r"cd ~/my\ dir/sub", "~/my dir/", "sub"),
            (r"cd \~literal/sub", "./~literal/", "sub"),
            ("cd 中文/子", "中文/", "子"),
        ] {
            let q = query(input).unwrap();
            assert_eq!(q.dir_text, directory, "{input}");
            assert_eq!(q.base, base, "{input}");
            assert_eq!(q.range, 3..input.len(), "{input}");
        }
    }

    #[test]
    fn completes_the_last_segment_only() {
        let q = query("ls /etc; cd /va").unwrap();
        assert_eq!((q.dir_text.as_str(), q.base.as_str()), ("/", "va"));
        assert_eq!(q.range, 12..15);
        // Nothing has been typed in the new segment yet, so the previous
        // command must not be completed.
        assert!(query("cd /var;").is_none());
        assert!(query("cd /var |").is_none());
    }

    #[test]
    fn escapes_spaces_and_metacharacters_but_keeps_tilde_expansion() {
        assert_eq!(escape_shell_path("~/my dir/a&b"), "~/my\\ dir/a\\&b");
        assert_eq!(escape_shell_path("/plain-name_1.txt"), "/plain-name_1.txt");
        assert_eq!(escape_shell_path("#weird"), "\\#weird");
    }

    #[test]
    fn ranks_prefix_matches_first_and_hides_dotfiles_unless_asked() {
        let q = query("ls /etc/ho").unwrap();
        let entries = [
            entry("hosts", false),
            entry("host.conf", false),
            entry("shadow", false),
            entry(".hidden", false),
            entry("hdparm", true),
        ];
        let got = path_candidates(&q, &entries, "ls /etc/ho", 8);
        let shown: Vec<_> = got.iter().map(|item| item.display.as_str()).collect();
        let mut leading = shown[..2].to_vec();
        leading.sort_unstable();
        assert_eq!(leading, ["host.conf", "hosts"]);
        assert!(!shown.contains(&"hdparm/"));
        assert!(!shown.contains(&".hidden"));

        let q = query("ls /etc/.h").unwrap();
        let got = path_candidates(&q, &entries, "ls /etc/.h", 8);
        assert_eq!(got[0].display, ".hidden");
    }

    #[test]
    fn directory_only_commands_skip_files_and_directories_get_a_slash() {
        let q = query("cd /v").unwrap();
        let entries = [entry("var", true), entry("vmlinuz", false)];
        let got = path_candidates(&q, &entries, "cd /v", 8);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].command, "cd /var/");
        assert_eq!(got[0].display, "var/");
        assert!(got[0].is_dir);
    }

    #[test]
    fn an_empty_name_part_lists_every_visible_entry() {
        let q = query("cd /var/").unwrap();
        assert_eq!((q.dir_text.as_str(), q.base.as_str()), ("/var/", ""));
        let entries = [
            entry("log", true),
            entry("lib", true),
            entry(".cache", true),
        ];
        let got = path_candidates(&q, &entries, "cd /var/", 8);
        let shown: Vec<_> = got.iter().map(|item| item.command.as_str()).collect();
        assert_eq!(shown, ["cd /var/lib/", "cd /var/log/"]);
    }

    #[test]
    fn hides_names_with_invisible_or_reordering_characters() {
        let q = query("cat /tmp/a").unwrap();
        let entries = [
            entry("a\u{202E}gpj.sh", false),
            entry("a\u{200B}b", false),
            entry("a\u{2028}b", false),
            entry("ascii", false),
        ];
        let got = path_candidates(&q, &entries, "cat /tmp/a", 8);
        let shown: Vec<_> = got.iter().map(|item| item.display.as_str()).collect();
        assert_eq!(shown, ["ascii"]);
    }

    #[test]
    fn bare_names_that_look_like_options_or_expansions_are_anchored() {
        let q = query("cd ").unwrap();
        let entries = [
            entry("~tmp", true),
            entry("-odd", true),
            entry("=eq", true),
            entry("plain", true),
        ];
        let got = path_candidates(&q, &entries, "cd ", 8);
        let mut inserted: Vec<_> = got.iter().map(|item| item.command.clone()).collect();
        inserted.sort();
        assert_eq!(
            inserted,
            ["cd ./-odd/", "cd ./=eq/", "cd ./~tmp/", "cd plain/"]
        );
    }

    #[test]
    fn rejects_names_that_could_inject_input() {
        let q = query("cat /tmp/a").unwrap();
        let entries = [
            entry("a\nrm -rf", false),
            entry("a\u{1b}[31m", false),
            entry("ok", false),
        ];
        assert!(path_candidates(&q, &entries, "cat /tmp/a", 8).is_empty());
    }

    #[test]
    fn path_rows_rank_above_other_providers_only_when_scoped() {
        let entries = [entry("alpha", true)];
        let scoped = path_candidates(&query("cd /a").unwrap(), &entries, "cd /a", 8);
        assert!(scoped[0].score >= 1_000_000);
        let bare = path_candidates(&query("cd a").unwrap(), &entries, "cd a", 8);
        assert!(bare[0].score < 100);
    }
}
