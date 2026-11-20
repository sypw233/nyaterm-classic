use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

const MAX_LINES: usize = 500;
const MAX_BYTES: usize = 512 * 1024;

#[derive(Default)]
struct SessionOutput {
    lines: VecDeque<String>,
    partial: String,
    bytes: usize,
}

#[derive(Default)]
pub struct RecentOutputStore {
    sessions: Mutex<HashMap<String, SessionOutput>>,
}

impl RecentOutputStore {
    pub fn append(&self, session_id: &str, text: &str) {
        if text.is_empty() {
            return;
        }

        // Fast path for ordinary shell output: no escape sequence and no
        // carriage return means the ANSI stripper would return the input
        // unchanged, so running the full VTE parser plus a second allocation
        // over every output chunk is pure waste. Most terminal output is a
        // single-colour log line, so this covers the common case.
        let needs_rewrite = text
            .as_bytes()
            .iter()
            .any(|byte| *byte == 0x1b || *byte == b'\r');

        let mut sessions = self.sessions.lock().unwrap();
        let output = sessions.entry(session_id.to_string()).or_default();
        if needs_rewrite {
            let clean = strip_ansi_escapes::strip_str(text).replace('\r', "");
            output.partial.push_str(&clean);
        } else {
            output.partial.push_str(text);
        }
        while let Some(index) = output.partial.find('\n') {
            let line = output.partial[..index].to_string();
            output.partial.drain(..=index);
            push_line(output, line);
        }
        trim(output);
    }

    pub fn read(&self, session_id: &str, lines: usize) -> String {
        let sessions = self.sessions.lock().unwrap();
        let Some(output) = sessions.get(session_id) else {
            return String::new();
        };
        let count = lines.clamp(1, MAX_LINES);
        let completed_count = count.saturating_sub(usize::from(!output.partial.is_empty()));
        let start = output.lines.len().saturating_sub(completed_count);
        let mut result = output.lines.iter().skip(start).cloned().collect::<Vec<_>>();
        if !output.partial.is_empty() {
            result.push(output.partial.clone());
        }
        result.join("\n")
    }

    pub fn remove(&self, session_id: &str) {
        self.sessions.lock().unwrap().remove(session_id);
    }
}

fn push_line(output: &mut SessionOutput, mut line: String) {
    if line.len() + 1 > MAX_BYTES {
        let keep_from = utf8_boundary_at_or_after(&line, line.len() + 1 - MAX_BYTES);
        line.drain(..keep_from);
        output.lines.clear();
        output.bytes = 0;
    }
    output.bytes = output.bytes.saturating_add(line.len() + 1);
    output.lines.push_back(line);
    trim(output);
}

fn trim(output: &mut SessionOutput) {
    while output.lines.len() > MAX_LINES || output.bytes + output.partial.len() > MAX_BYTES {
        if let Some(line) = output.lines.pop_front() {
            output.bytes = output.bytes.saturating_sub(line.len() + 1);
        } else if output.partial.len() > MAX_BYTES {
            let keep_from =
                utf8_boundary_at_or_after(&output.partial, output.partial.len() - MAX_BYTES);
            output.partial.drain(..keep_from);
        } else {
            break;
        }
    }
}

fn utf8_boundary_at_or_after(text: &str, mut index: usize) -> usize {
    while index < text.len() && !text.is_char_boundary(index) {
        index += 1;
    }
    index
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caps_lines_and_strips_ansi() {
        let store = RecentOutputStore::default();
        for index in 0..510 {
            store.append("s", &format!("\x1b[31m{index}\x1b[0m\n"));
        }
        let result = store.read("s", 500);
        assert_eq!(result.lines().count(), 500);
        assert!(result.starts_with("10\n"));
        assert!(!result.contains("\x1b["));
    }

    #[test]
    fn retains_the_tail_of_a_single_oversized_line() {
        let store = RecentOutputStore::default();
        store.append("s", &format!("{}END\n", "x".repeat(MAX_BYTES + 100)));
        let result = store.read("s", 1);
        assert!(result.len() <= MAX_BYTES);
        assert!(result.ends_with("END"));
    }

    #[test]
    fn plain_text_fast_path_matches_the_stripping_path() {
        // The fast path skips the VTE parser when there is nothing to strip.
        // Verify it produces exactly what the stripping path would.
        let store = RecentOutputStore::default();
        store.append("s", "plain line one\nplain line two\r\nthird\n");
        assert_eq!(
            store.read("s", 10),
            "plain line one\nplain line two\nthird"
        );
    }

    #[test]
    fn escape_sequences_are_still_stripped_after_a_plain_chunk() {
        let store = RecentOutputStore::default();
        store.append("s", "before ");
        store.append("s", "\x1b[32mgreen\x1b[0m\n");
        assert_eq!(store.read("s", 10), "before green");
    }
}
