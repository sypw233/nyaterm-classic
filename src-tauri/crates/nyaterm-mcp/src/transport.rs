//! Optional HTTP transport for the MCP forwarder.
//!
//! By default the forwarder serves MCP over stdio, which is what the bundled
//! client configs use. When `NYATERM_MCP_HTTP=1` (or `--http` is passed) the
//! forwarder serves a Streamable HTTP endpoint on loopback TCP instead.
//!
//! Security notes:
//! - The listener is bound to `127.0.0.1` only; it is never exposed on a LAN.
//! - The discovery token is required as the first URL path segment
//!   (`/<token>/mcp`), so only a client that can read the private discovery
//!   document can reach the service. This mirrors the bridge's own token
//!   check without adding an auth framework dependency.
//! - rmcp's default `Host` validation stays enabled.

use axum::Router;
use axum::extract::{Path, Request};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};

use crate::NyaTermMcp;

/// Environment variable that enables the HTTP transport.
pub const HTTP_ENV: &str = "NYATERM_MCP_HTTP";
/// Environment variable that overrides the HTTP listen port (default `12701`).
pub const PORT_ENV: &str = "NYATERM_MCP_HTTP_PORT";
const DEFAULT_HTTP_PORT: u16 = 12701;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Stdio,
    Http { port: u16 },
}

/// Parse the transport mode from CLI args and environment.
///
/// `--http` wins over the environment; `NYATERM_MCP_HTTP=1` enables HTTP too.
/// An explicit `--port` or `NYATERM_MCP_HTTP_PORT` overrides the default port.
pub fn mode_from_args_and_env(args: &[String]) -> Result<Mode, String> {
    let mut http = std::env::var(HTTP_ENV).as_deref() == Ok("1");
    let mut port = parse_port_env()?.unwrap_or(DEFAULT_HTTP_PORT);

    let mut iter = args.iter().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--http" => http = true,
            "--stdio" => http = false,
            "--port" => {
                let value = iter
                    .next()
                    .ok_or_else(|| "--port requires a value".to_string())?;
                port = value
                    .parse::<u16>()
                    .map_err(|_| format!("invalid --port value: {value}"))?;
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    Ok(if http {
        Mode::Http { port }
    } else {
        Mode::Stdio
    })
}

fn parse_port_env() -> Result<Option<u16>, String> {
    match std::env::var(PORT_ENV) {
        Ok(value) => value
            .parse::<u16>()
            .map(Some)
            .map_err(|_| format!("invalid {PORT_ENV} value: {value}")),
        Err(_) => Ok(None),
    }
}

/// Serve MCP over Streamable HTTP on `127.0.0.1:<port>/<token>/mcp`.
///
/// `token` comes from the same discovery document the bridge uses, so rotating
/// the host token also rotates this URL. The function returns when the listener
/// fails or the process is terminated.
pub async fn serve_http(
    server: NyaTermMcp,
    token: String,
    port: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    let service: StreamableHttpService<NyaTermMcp, LocalSessionManager> =
        StreamableHttpService::new(
            move || Ok(server.clone()),
            Default::default(),
            StreamableHttpServerConfig::default(),
        );

    let app = Router::new().route(
        "/{token}/mcp",
        any(move |Path(path_token): Path<String>, request: Request| {
            let service = service.clone();
            let expected = token.clone();
            async move {
                if path_token != expected {
                    return StatusCode::FORBIDDEN.into_response();
                }
                let response: Response = service.handle(request).await.into_response();
                response
            }
        }),
    );

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_stdio() {
        let mode = mode_from_args_and_env(&["nyaterm-mcp".into()]).unwrap();
        assert_eq!(mode, Mode::Stdio);
    }

    #[test]
    fn http_flag_switches_to_http_with_default_port() {
        let mode = mode_from_args_and_env(&["nyaterm-mcp".into(), "--http".into()]).unwrap();
        assert_eq!(mode, Mode::Http { port: 12701 });
    }

    #[test]
    fn port_flag_overrides_port() {
        let mode = mode_from_args_and_env(&[
            "nyaterm-mcp".into(),
            "--http".into(),
            "--port".into(),
            "9000".into(),
        ])
        .unwrap();
        assert_eq!(mode, Mode::Http { port: 9000 });
    }

    #[test]
    fn stdio_flag_disables_http() {
        let mode = mode_from_args_and_env(&["nyaterm-mcp".into(), "--stdio".into()]).unwrap();
        assert_eq!(mode, Mode::Stdio);
    }

    #[test]
    fn unknown_argument_is_rejected() {
        assert!(mode_from_args_and_env(&["nyaterm-mcp".into(), "--bogus".into()]).is_err());
    }
}
