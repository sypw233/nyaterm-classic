//! Lightweight CLI prompt hints for raw network-device / serial sessions.
//!
//! These helpers are intentionally conservative: they only recognize common
//! network-equipment prompt shapes from the tail of a terminal line. They are
//! prompt hints, not a terminal emulator; shell prompts and ordinary output
//! must never be treated as a device CLI prompt.

/// Returns true when the last non-empty line of `output` looks like an
/// interactive network-device CLI prompt.
pub fn looks_like_network_cli_prompt(output: &str) -> bool {
    // Only the tail matters and the session buffer can be megabytes long.
    let tail = tail_chars(output, 4096);
    let mut line = PromptLine::default();
    line.feed(tail);
    looks_like_network_cli_prompt_line(line.text().trim())
}

/// The last `max` bytes of `s`, moved forward to a char boundary.
fn tail_chars(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut start = s.len() - max;
    while start < s.len() && !s.is_char_boundary(start) {
        start += 1;
    }
    &s[start..]
}

pub fn looks_like_network_cli_prompt_line(line: &str) -> bool {
    // Shell fingerprints: `user@host` prompts and `$`-terminated prompts.
    if line.contains('@') || line.ends_with('$') || looks_like_cli_input_wait(line) {
        return false;
    }
    // H3C / Huawei system view: `<HOSTNAME>`.
    if let Some(inner) = line
        .strip_prefix('<')
        .and_then(|rest| rest.strip_suffix('>'))
    {
        return is_hostname_token(inner);
    }
    // H3C / Huawei sub-views: `[HOSTNAME]`, `[HOSTNAME-interface]`.
    if let Some(inner) = line
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
    {
        return is_device_context_token(inner);
    }
    // Cisco / Ruijie / Aruba: `Hostname#`, `Hostname(config)#`, `(Name) #`,
    // `(Name) *`. Also covers device-style `console:/ #` seen on embedded
    // serial consoles.
    let body = line.trim_end_matches(['#', '*', '>']);
    if body == line {
        // No CLI terminator: only the bracket forms above count.
        return false;
    }
    let body = body.trim_end();
    let shell = body.to_ascii_lowercase();
    if ["root", "sh", "bash", "zsh", "fish", "dash", "ksh", "ash"]
        .iter()
        .any(|name| shell == *name || shell.starts_with(&format!("{name}-")))
    {
        return false;
    }
    // Whitespace is only part of the controller form `(Name) #`.
    is_hostname_token(body)
        || (body.starts_with('(')
            && body.ends_with(')')
            && is_hostname_token(&body[1..body.len() - 1]))
        || body
            .split_once('(')
            .is_some_and(|(host, context)| {
                is_hostname_token(host.trim_end())
                    && context.ends_with(')')
                    && is_device_context_token(&context[..context.len() - 1])
            })
        // A path-like prefix such as `console:/` is also a valid device token.
        || body
            .strip_suffix(":/")
            .is_some_and(is_hostname_token)
}

pub fn looks_like_cli_input_wait(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    [
        "--more--",
        "-- more --",
        "---- more ----",
        "[y/n]",
        "[yes/no]",
        "(y/n)",
        "[confirm]",
        "password:",
        "press any key",
        "continue?",
        "are you sure",
    ]
    .iter()
    .any(|hint| lower.contains(hint))
}

/// Bounded, incremental last-line observer, including split ANSI sequences and
/// CR overwrites. This is a prompt hint, not a second terminal emulator.
#[derive(Debug, Default)]
pub struct PromptLine {
    line: Vec<char>,
    previous: String,
    cursor: usize,
    escape: u8,
    csi: String,
    overflow: bool,
}

impl PromptLine {
    pub fn feed(&mut self, text: &str) {
        for ch in text.chars() {
            match self.escape {
                1 => {
                    self.escape = match ch {
                        '[' => 2,
                        ']' => 3,
                        _ => 0,
                    };
                    self.csi.clear();
                }
                2 => {
                    if ('\u{40}'..='\u{7e}').contains(&ch) {
                        if ch == 'K' {
                            if self.csi == "2" {
                                self.line.clear();
                                self.cursor = 0;
                            } else {
                                self.line.truncate(self.cursor);
                            }
                        } else if ch == 'G' && (self.csi.is_empty() || self.csi == "1") {
                            self.cursor = 0;
                        }
                        self.escape = 0;
                    } else if self.csi.len() < 32 {
                        self.csi.push(ch);
                    }
                }
                3 => match ch {
                    '\u{7}' => self.escape = 0,
                    '\u{1b}' => self.escape = 4,
                    _ => {}
                },
                4 => self.escape = if ch == '\\' { 0 } else { 3 },
                _ => match ch {
                    '\u{1b}' => self.escape = 1,
                    '\r' => self.cursor = 0,
                    '\n' => {
                        if self.overflow {
                            self.previous.clear();
                        } else if !self.line.is_empty() {
                            self.previous = self.line.iter().collect();
                        }
                        self.line.clear();
                        self.cursor = 0;
                        self.overflow = false;
                    }
                    '\u{8}' => self.cursor = self.cursor.saturating_sub(1),
                    c if !c.is_control() => {
                        if self.cursor < 512 {
                            if self.cursor < self.line.len() {
                                self.line[self.cursor] = c;
                            } else {
                                self.line.push(c);
                            }
                            self.cursor += 1;
                        } else {
                            self.overflow = true;
                        }
                    }
                    _ => {}
                },
            }
        }
    }

    pub fn text(&self) -> String {
        if self.overflow || self.escape != 0 || self.cursor < self.line.len() {
            return String::new();
        }
        if self.line.is_empty() {
            self.previous.clone()
        } else {
            self.line.iter().collect()
        }
    }
}

/// Hostnames: letters, digits, `.`, `_`, `-`.
fn is_hostname_token(token: &str) -> bool {
    !token.is_empty()
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Hostnames plus sub-view suffixes such as `Hostname(config)` or
/// `HOST-1/GigabitEthernet0/0/1`.
fn is_device_context_token(token: &str) -> bool {
    !token.is_empty()
        && token.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/' | '(' | ')' | ' ')
        })
}

#[cfg(test)]
mod tests {
    use super::looks_like_network_cli_prompt;

    #[test]
    fn recognizes_huawei_cisco_and_embedded_prompts() {
        for prompt in [
            "<Switch>",
            "[H3C-GigabitEthernet1/0/1]",
            "Switch#",
            "Switch(config)#",
            "(Controller) #",
            "console:/ #",
        ] {
            assert!(looks_like_network_cli_prompt(prompt), "{prompt}");
        }
    }

    #[test]
    fn rejects_shell_prompts_and_plain_output() {
        for line in [
            "root#",
            "user@host:~$",
            "[root@host ~]#",
            "PS C:\\Users\\admin>",
            "Welcome to Ubuntu",
            "total 24",
        ] {
            assert!(!looks_like_network_cli_prompt(line), "{line}");
        }
    }
}
