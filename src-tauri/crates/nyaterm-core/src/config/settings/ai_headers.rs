//! Validation and normalization for per-credential custom HTTP headers.

use serde::Serialize;
use uuid::Uuid;

use super::ai::AiHttpHeader;

pub const MAX_AI_CUSTOM_HEADERS: usize = 32;
pub const MAX_AI_CUSTOM_HEADER_NAME_LEN: usize = 256;
pub const MAX_AI_CUSTOM_HEADER_VALUE_LEN: usize = 8192;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(rename_all = "snake_case")]
pub enum CustomHeaderError {
    #[error("Custom header name must be an HTTP token of at most 256 bytes")]
    InvalidName,
    #[error("This header is controlled by the HTTP client and cannot be customized")]
    ManagedName,
    #[error("Custom header value is required")]
    EmptyValue,
    #[error("Custom header value exceeds the size limit")]
    ValueTooLong,
    #[error("Custom header value must contain only printable ASCII characters or tabs")]
    InvalidValue,
    #[error("Custom header names must be unique (case insensitive)")]
    DuplicateName,
    #[error("Too many custom headers")]
    TooMany,
}

/// HTTP token characters (RFC 9110 tchar).
pub fn is_valid_custom_header_name(name: &str) -> bool {
    let name = name.trim_matches([' ', '\t']);
    !name.is_empty()
        && name.len() <= MAX_AI_CUSTOM_HEADER_NAME_LEN
        && name.bytes().all(|byte| {
            matches!(
                byte,
                b'!' | b'#'
                    | b'$'
                    | b'%'
                    | b'&'
                    | b'\''
                    | b'*'
                    | b'+'
                    | b'-'
                    | b'.'
                    | b'^'
                    | b'_'
                    | b'`'
                    | b'|'
                    | b'~'
                    | b'0'..=b'9'
                    | b'a'..=b'z'
                    | b'A'..=b'Z'
            )
        })
}

pub fn is_valid_custom_header_value(value: &str) -> bool {
    let value = value.trim_matches([' ', '\t']);
    !value.is_empty()
        && value.len() <= MAX_AI_CUSTOM_HEADER_VALUE_LEN
        && value
            .bytes()
            .all(|byte| byte == b'\t' || (0x20..=0x7e).contains(&byte))
}

fn is_managed_header(name: &str) -> bool {
    matches!(
        name.trim_matches([' ', '\t']).to_ascii_lowercase().as_str(),
        "host"
            | "content-length"
            | "transfer-encoding"
            | "connection"
            | "proxy-authorization"
            | "proxy-authenticate"
            | "proxy-connection"
            | "keep-alive"
            | "te"
            | "trailer"
            | "upgrade"
    )
}

/// Validate a single header. Errors never include the header value.
pub fn validate_custom_header(name: &str, value: &str) -> Result<(), CustomHeaderError> {
    if !is_valid_custom_header_name(name) {
        return Err(CustomHeaderError::InvalidName);
    }
    if is_managed_header(name) {
        return Err(CustomHeaderError::ManagedName);
    }
    let value = value.trim_matches([' ', '\t']);
    if value.is_empty() {
        return Err(CustomHeaderError::EmptyValue);
    }
    if value.len() > MAX_AI_CUSTOM_HEADER_VALUE_LEN {
        return Err(CustomHeaderError::ValueTooLong);
    }
    if !is_valid_custom_header_value(value) {
        return Err(CustomHeaderError::InvalidValue);
    }
    Ok(())
}

/// Resolve headers into `(name, value)` pairs ready to insert into a request.
/// Rows with both name and value empty are inert and skipped.
pub fn custom_header_pairs(
    headers: &[AiHttpHeader],
) -> Result<Vec<(String, String)>, CustomHeaderError> {
    if headers.len() > MAX_AI_CUSTOM_HEADERS {
        return Err(CustomHeaderError::TooMany);
    }
    let mut pairs = Vec::with_capacity(headers.len());
    let mut names = std::collections::HashSet::new();
    for header in headers {
        let name = header.name.trim_matches([' ', '\t']);
        let value = header.value.trim_matches([' ', '\t']);
        if name.is_empty() && value.is_empty() {
            continue;
        }
        validate_custom_header(name, value)?;
        if !names.insert(name.to_ascii_lowercase()) {
            return Err(CustomHeaderError::DuplicateName);
        }
        pairs.push((name.to_string(), value.to_string()));
    }
    Ok(pairs)
}

/// Repair editor rows without discarding user input: trim fields, assign unique
/// ids, and cap the row count. Validation still runs at save/request boundaries.
pub fn normalize_custom_headers(headers: &mut Vec<AiHttpHeader>) {
    headers.truncate(MAX_AI_CUSTOM_HEADERS);
    let mut seen = std::collections::HashSet::new();
    for header in headers.iter_mut() {
        header.name = header.name.trim_matches([' ', '\t']).to_string();
        if header.id.is_empty() || !seen.insert(header.id.clone()) {
            header.id = format!("hdr-{}", Uuid::new_v4());
            seen.insert(header.id.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(id: &str, name: &str, value: &str) -> AiHttpHeader {
        AiHttpHeader {
            id: id.to_string(),
            name: name.to_string(),
            value: value.to_string(),
        }
    }

    #[test]
    fn valid_headers_produce_pairs() {
        let pairs = custom_header_pairs(&[header("1", "X-Title", "NyaTerm")]).unwrap();
        assert_eq!(pairs, vec![("X-Title".to_string(), "NyaTerm".to_string())]);
    }

    #[test]
    fn empty_rows_are_skipped() {
        let pairs = custom_header_pairs(&[header("1", "  ", "  ")]).unwrap();
        assert!(pairs.is_empty());
    }

    #[test]
    fn managed_headers_are_rejected() {
        assert_eq!(
            custom_header_pairs(&[header("1", "Host", "example.com")]).unwrap_err(),
            CustomHeaderError::ManagedName
        );
        assert_eq!(
            validate_custom_header("content-length", "12").unwrap_err(),
            CustomHeaderError::ManagedName
        );
    }

    #[test]
    fn invalid_name_and_value_are_rejected() {
        assert_eq!(
            validate_custom_header("bad header", "x").unwrap_err(),
            CustomHeaderError::InvalidName
        );
        assert_eq!(
            validate_custom_header("X-Test", "   ").unwrap_err(),
            CustomHeaderError::EmptyValue
        );
        assert_eq!(
            validate_custom_header("X-Test", "bad\nvalue").unwrap_err(),
            CustomHeaderError::InvalidValue
        );
    }

    #[test]
    fn duplicate_names_are_rejected_case_insensitively() {
        let error = custom_header_pairs(&[
            header("1", "X-Token", "a"),
            header("2", "x-token", "b"),
        ])
        .unwrap_err();
        assert_eq!(error, CustomHeaderError::DuplicateName);
    }

    #[test]
    fn too_many_headers_are_rejected() {
        let headers: Vec<_> = (0..=MAX_AI_CUSTOM_HEADERS)
            .map(|index| header(&format!("{index}"), &format!("X-{index}"), "v"))
            .collect();
        assert_eq!(
            custom_header_pairs(&headers).unwrap_err(),
            CustomHeaderError::TooMany
        );
    }

    #[test]
    fn normalize_caps_rows_and_assigns_unique_ids() {
        let mut headers: Vec<_> = (0..(MAX_AI_CUSTOM_HEADERS + 3))
            .map(|_| AiHttpHeader::default())
            .collect();
        normalize_custom_headers(&mut headers);
        assert_eq!(headers.len(), MAX_AI_CUSTOM_HEADERS);
        let ids: std::collections::HashSet<_> = headers.iter().map(|h| h.id.clone()).collect();
        assert_eq!(ids.len(), headers.len());
    }
}
