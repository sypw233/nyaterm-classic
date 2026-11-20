//! Shared raw echo-capture state for a single serial session I/O loop.
//!
//! The reader thread observes every decoded output chunk; a short-lived poll
//! task decides when the device prompt has returned. This is the v1 equivalent
//! of the 2.x RawCliCapture integration, adapted to the Tauri session thread.

use std::time::{Duration, Instant};

use tokio::sync::oneshot;

use nyaterm_core::core::raw_cli_capture::{RawCliCapture, RawCliEnd};

/// Result of one raw CLI command execution.
#[derive(Debug)]
pub struct RawCaptureResult {
    pub output: String,
    pub end: RawCliEnd,
    pub duration_ms: u64,
    pub source_truncated: bool,
}

struct ActiveRawCapture {
    capture: RawCliCapture,
    result_tx: Option<oneshot::Sender<RawCaptureResult>>,
    execution: Option<crate::core::session::TerminalExecutionGuard>,
    started: Instant,
}

/// Bounded rolling output tail kept so a new capture can learn the current
/// device prompt before the command is sent.
const TAIL_LIMIT: usize = 16 * 1024;
const TAIL_KEEP: usize = 4096;

#[derive(Default)]
pub struct RawCaptureRuntime {
    tail: String,
    active: Option<ActiveRawCapture>,
}

impl RawCaptureRuntime {
    /// Called from the reader thread for every decoded output chunk.
    pub fn observe_output(&mut self, text: &str) {
        self.tail.push_str(text);
        if self.tail.len() > TAIL_LIMIT {
            let mut start = self.tail.len() - TAIL_KEEP;
            while start < self.tail.len() && !self.tail.is_char_boundary(start) {
                start += 1;
            }
            self.tail.drain(..start);
        }
        if let Some(active) = &mut self.active {
            active.capture.feed(text, Instant::now());
        }
    }

    /// Begin a capture, seeded with a bounded tail of pre-command output.
    pub fn begin(
        &mut self,
        result_tx: oneshot::Sender<RawCaptureResult>,
        execution: crate::core::session::TerminalExecutionGuard,
    ) {
        let capture = RawCliCapture::new(&self.tail, Instant::now());
        self.active = Some(ActiveRawCapture {
            capture,
            result_tx: Some(result_tx),
            execution: Some(execution),
            started: Instant::now(),
        });
    }

    pub fn has_active(&self) -> bool {
        self.active.is_some()
    }

    /// Poll the active capture once. Returns true when the runtime is idle and
    /// the poll task should stop.
    pub fn poll_once(&mut self, deadline: Instant) -> bool {
        let Some(active) = &self.active else {
            return true;
        };
        let end = active.capture.poll(Instant::now(), deadline);
        let Some(end) = end else {
            return false;
        };

        let mut active = self.active.take().expect("checked above");
        let source_truncated = active.capture.is_truncated();
        let result = RawCaptureResult {
            output: active.capture.into_output(),
            end,
            duration_ms: active.started.elapsed().as_millis() as u64,
            source_truncated,
        };
        // Release the execution guard so the session leaves the busy state.
        drop(active.execution.take());
        if let Some(tx) = active.result_tx.take() {
            let _ = tx.send(result);
        }
        true
    }

    /// Abandon the active capture without producing a result.
    pub fn cancel(&mut self) {
        self.active.take();
    }

    pub fn poll_interval() -> Duration {
        Duration::from_millis(100)
    }
}
