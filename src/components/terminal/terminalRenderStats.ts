import type { Terminal } from "@xterm/xterm";
import { logger } from "@/lib/logger";

/**
 * Per-frame render diagnostics for the terminal.
 *
 * The practical question in a slow environment is "how much work is each
 * rendered frame doing, and how often does a frame happen". xterm exposes
 * `onRender` with the row range it repainted, which is exactly that
 * measurement. Aggregating over a window keeps the cost of measuring far below
 * the cost of the rendering being measured.
 *
 * Enabled only when the user turns on `terminal.render_stats_enabled`: the
 * aggregation itself allocates and the log sink does I/O.
 */

export interface TerminalRenderStatsSnapshot {
  rendererKind: string;
  /** Render frames observed in the window. */
  frames: number;
  /** Total rows repainted across those frames. */
  rowsRepainted: number;
  /** Largest single-frame row count, i.e. worst-case full-screen rebuilds. */
  maxRowsPerFrame: number;
  /** Frames that repainted every row (DOM renderer rebuilds all spans). */
  fullScreenFrames: number;
  /** Wall-clock milliseconds the window covered. */
  windowMs: number;
  /** Frames per second across the window. */
  framesPerSecond: number;
  /** Rows repainted per second; the main predictor of renderer CPU cost. */
  rowsPerSecond: number;
  rows: number;
  cols: number;
}

interface TerminalRenderStatsOptions {
  sessionId: string;
  terminal: Terminal;
  windowMs?: number;
  now?: () => number;
  onSnapshot?: (snapshot: TerminalRenderStatsSnapshot) => void;
}

const DEFAULT_WINDOW_MS = 5_000;

/**
 * Resolve which renderer xterm is actually using.
 *
 * `constructor.name` cannot be used: production builds are minified, so both
 * renderers come back with short mangled names (observed as "vs" in the field).
 * Instead this probe relies on structural facts that survive minification:
 *
 * - The DOM renderer creates a `.xterm-rows` container holding elements.
 * - The WebGL renderer keeps a `<canvas>` with a WebGL2 context.
 *
 * There is no public accessor for the renderer, so this reads the same private
 * field the other terminal integrations already depend on
 * (`_core._renderService._renderer`). Returns "unknown" rather than throwing
 * when the shape changes.
 */
export function resolveTerminalRendererKind(terminal: Terminal): string {
  const core = (terminal as Terminal & {
    _core?: {
      _renderService?: {
        _renderer?: { value?: unknown };
      };
    };
  })._core;

  const renderer = core?._renderService?._renderer?.value as
    | {
        _gl?: unknown;
        _canvas?: { getContext?: (id: string) => unknown };
        _rowContainer?: unknown;
      }
    | undefined;

  if (!renderer || typeof renderer !== "object") {
    // Fall back to the DOM structure when the private field is unavailable.
    return terminal.element?.querySelector(".xterm-rows") ? "dom" : "unknown";
  }

  // WebGL renderer: holds a live WebGL2 context.
  if (renderer._gl) return "webgl";
  // Some renderer versions only expose the canvas; a webgl2 context proves it.
  if (renderer._canvas?.getContext) {
    try {
      if (renderer._canvas.getContext("webgl2")) return "webgl";
    } catch {
      // getContext on an unbound canvas can throw; fall through.
    }
  }

  // DOM renderer: owns the `.xterm-rows` span container.
  if (renderer._rowContainer) return "dom";
  if (terminal.element?.querySelector(".xterm-rows")) return "dom";

  return "unknown";
}

/**
 * Observe render frames and periodically log an aggregate snapshot.
 *
 * Returns a disposer. Safe to call with diagnostics disabled: callers should
 * check the setting first rather than relying on this to be free.
 */
export function observeTerminalRenderStats({
  sessionId,
  terminal,
  windowMs = DEFAULT_WINDOW_MS,
  now = () => performance.now(),
  onSnapshot,
}: TerminalRenderStatsOptions): () => void {
  let disposed = false;
  let frames = 0;
  let rowsRepainted = 0;
  let maxRowsPerFrame = 0;
  let fullScreenFrames = 0;
  let windowStartedAt = now();

  const rendererKind = resolveTerminalRendererKind(terminal);

  const disposeRender = terminal.onRender(({ start, end }) => {
    if (disposed) return;
    const rows = Math.max(0, end - start + 1);
    frames += 1;
    rowsRepainted += rows;
    if (rows > maxRowsPerFrame) maxRowsPerFrame = rows;
    // A frame that repaints the whole viewport is the expensive case for the
    // DOM renderer, which rebuilds every span in those rows.
    if (rows >= terminal.rows) fullScreenFrames += 1;
  });

  const timer = setInterval(() => {
    if (disposed) return;
    const windowEndedAt = now();
    const elapsedMs = Math.max(1, windowEndedAt - windowStartedAt);

    // Only report windows that actually saw rendering; idle terminals would
    // otherwise flood the log with zeroes.
    if (frames > 0) {
      const snapshot: TerminalRenderStatsSnapshot = {
        rendererKind,
        frames,
        rowsRepainted,
        maxRowsPerFrame,
        fullScreenFrames,
        windowMs: Math.round(elapsedMs),
        framesPerSecond: round(frames / (elapsedMs / 1000)),
        rowsPerSecond: round(rowsRepainted / (elapsedMs / 1000)),
        rows: terminal.rows,
        cols: terminal.cols,
      };
      onSnapshot?.(snapshot);
      logger.debug({
        domain: "terminal.render",
        event: "terminal.render.stats",
        message: "Terminal render statistics",
        ids: { session_id: sessionId },
        data: snapshot,
      });
    }

    frames = 0;
    rowsRepainted = 0;
    maxRowsPerFrame = 0;
    fullScreenFrames = 0;
    windowStartedAt = windowEndedAt;
  }, windowMs);

  return () => {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    disposeRender.dispose();
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
