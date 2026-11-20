fn strip_leading_env_prefixes(mut input: &str) -> &str {
    loop {
        let Some(rest) = input.strip_prefix('(') else {
            return input;
        };
        let Some(close_idx) = rest.find(')') else {
            return input;
        };
        let after_close = &rest[close_idx + 1..];
        input = after_close.trim_start_matches([' ', '\t']);
    }
}

fn strip_known_prompt_prefix(input: &str) -> Option<&str> {
    strip_bracket_prompt(input)
        .or_else(|| strip_posix_prompt(input))
        .or_else(|| strip_powershell_prompt(input))
        .or_else(|| strip_windows_prompt(input))
        .or_else(|| strip_cli_prompt(input))
}

/// Strip device-style CLI prompts such as `console:/ #`, `switch#` or
/// `router(config)#`. The prompt is one whitespace-free token ending in `#` or
/// `$`, optionally separated from the marker by spaces. Requiring whitespace
/// or end-of-input after the marker keeps shell text like `echo $DISPLAY` and
/// `echo foo # bar` from being mistaken for a prompt, while still letting a
/// real command after the prompt (`console:/ # ls`) be recorded.
fn strip_cli_prompt(input: &str) -> Option<&str> {
    for (idx, marker) in input.char_indices() {
        if marker != '#' && marker != '$' {
            continue;
        }
        let after = idx + marker.len_utf8();
        if after < input.len() && !input[after..].starts_with([' ', '\t']) {
            continue;
        }
        let token = input[..idx].trim_end_matches([' ', '\t']);
        if token.is_empty() || token.chars().any(char::is_whitespace) {
            continue;
        }
        return Some(input[after..].trim_start_matches([' ', '\t']));
    }
    None
}

fn strip_bracket_prompt(input: &str) -> Option<&str> {
    let rest = input.strip_prefix('[')?;
    let close_idx = rest.find(']')?;
    let after_bracket = rest[close_idx + 1..].trim_start_matches([' ', '\t']);
    let after_marker = after_bracket
        .strip_prefix('#')
        .or_else(|| after_bracket.strip_prefix('$'))?;
    Some(after_marker.trim_start_matches([' ', '\t']))
}

fn strip_posix_prompt(input: &str) -> Option<&str> {
    let prompt_end = input.find(['#', '$'])?;
    let prompt = &input[..prompt_end];
    let after_marker = &input[prompt_end + 1..];

    let at_idx = prompt.find('@')?;
    let colon_rel = prompt[at_idx + 1..].find(':')?;
    let colon_idx = at_idx + 1 + colon_rel;

    let user = &prompt[..at_idx];
    let host = &prompt[at_idx + 1..colon_idx];
    if user.is_empty()
        || host.is_empty()
        || user.chars().any(char::is_whitespace)
        || host.chars().any(char::is_whitespace)
    {
        return None;
    }

    Some(after_marker.trim_start_matches([' ', '\t']))
}

fn strip_powershell_prompt(input: &str) -> Option<&str> {
    let rest = input
        .strip_prefix("PS ")
        .or_else(|| input.strip_prefix("PS\t"))?;
    let marker_idx = rest.find('>')?;
    let prompt = &rest[..marker_idx];
    if prompt.trim().is_empty() {
        return None;
    }

    Some(rest[marker_idx + 1..].trim_start_matches([' ', '\t']))
}

fn strip_windows_prompt(input: &str) -> Option<&str> {
    let bytes = input.as_bytes();
    if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' {
        return None;
    }

    let marker_idx = input.find('>')?;
    if input[..marker_idx].contains(['\r', '\n']) {
        return None;
    }

    Some(input[marker_idx + 1..].trim_start_matches([' ', '\t']))
}
