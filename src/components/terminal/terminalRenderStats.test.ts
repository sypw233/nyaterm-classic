import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import {
  observeTerminalRenderStats,
  resolveTerminalRendererKind,
  type TerminalRenderStatsSnapshot,
} from "./terminalRenderStats";

interface RenderHarness {
  terminal: Terminal;
  emitRender: (start: number, end: number) => void;
}

function createHarness(rows = 24, cols = 80): RenderHarness {
  const listeners = new Set<(event: { start: number; end: number }) => void>();
  const terminal = {
    rows,
    cols,
    onRender: (listener: (event: { start: number; end: number }) => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  } as unknown as Terminal;

  return {
    terminal,
    emitRender: (start, end) => {
      for (const listener of listeners) listener({ start, end });
    },
  };
}

describe("resolveTerminalRendererKind", () => {
  it("detects the WebGL renderer from its live GL context", () => {
    const terminal = {
      _core: { _renderService: { _renderer: { value: { _gl: {} } } } },
    } as unknown as Terminal;
    expect(resolveTerminalRendererKind(terminal)).toBe("webgl");
  });

  it("detects the WebGL renderer from a canvas with a webgl2 context", () => {
    const terminal = {
      _core: {
        _renderService: {
          _renderer: { value: { _canvas: { getContext: () => ({}) } } },
        },
      },
    } as unknown as Terminal;
    expect(resolveTerminalRendererKind(terminal)).toBe("webgl");
  });

  it("detects the DOM renderer from its row container", () => {
    const terminal = {
      _core: { _renderService: { _renderer: { value: { _rowContainer: {} } } } },
    } as unknown as Terminal;
    expect(resolveTerminalRendererKind(terminal)).toBe("dom");
  });

  it("falls back to the DOM structure when the private renderer is unavailable", () => {
    // This is the important regression case: minified builds report mangled
    // constructor names, so identification must not depend on them.
    const terminal = {
      element: { querySelector: (selector: string) => (selector === ".xterm-rows" ? {} : null) },
    } as unknown as Terminal;
    expect(resolveTerminalRendererKind(terminal)).toBe("dom");
  });

  it("does not trust a mangled constructor name", () => {
    const terminal = {
      _core: {
        _renderService: { _renderer: { value: { constructor: { name: "vs" } } } },
      },
    } as unknown as Terminal;
    // No GL context, no row container, no DOM structure: genuinely unknown
    // rather than guessing from the minified name.
    expect(resolveTerminalRendererKind(terminal)).toBe("unknown");
  });

  it("reports unknown instead of throwing on an unexpected shape", () => {
    expect(resolveTerminalRendererKind({} as Terminal)).toBe("unknown");
    expect(
      resolveTerminalRendererKind({
        _core: { _renderService: { _renderer: { value: undefined } } },
      } as unknown as Terminal),
    ).toBe("unknown");
  });
});

describe("observeTerminalRenderStats", () => {
  it("aggregates frames and rows over one window", () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness(24, 80);
      const snapshots: TerminalRenderStatsSnapshot[] = [];
      const dispose = observeTerminalRenderStats({
        sessionId: "s1",
        terminal: harness.terminal,
        windowMs: 1000,
        onSnapshot: (snapshot) => snapshots.push(snapshot),
      });

      // Two small repaints and one full-screen frame.
      harness.emitRender(3, 4);
      harness.emitRender(10, 10);
      harness.emitRender(0, 23);

      vi.advanceTimersByTime(1000);

      expect(snapshots).toHaveLength(1);
      const stats = snapshots[0];
      expect(stats.frames).toBe(3);
      expect(stats.rowsRepainted).toBe(2 + 1 + 24);
      expect(stats.maxRowsPerFrame).toBe(24);
      expect(stats.fullScreenFrames).toBe(1);
      expect(stats.rows).toBe(24);
      expect(stats.cols).toBe(80);
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports nothing for an idle window", () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const snapshots: TerminalRenderStatsSnapshot[] = [];
      const dispose = observeTerminalRenderStats({
        sessionId: "s1",
        terminal: harness.terminal,
        windowMs: 1000,
        onSnapshot: (snapshot) => snapshots.push(snapshot),
      });

      vi.advanceTimersByTime(2000);

      expect(snapshots).toHaveLength(0);
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops observing after dispose", () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const snapshots: TerminalRenderStatsSnapshot[] = [];
      const dispose = observeTerminalRenderStats({
        sessionId: "s1",
        terminal: harness.terminal,
        windowMs: 1000,
        onSnapshot: (snapshot) => snapshots.push(snapshot),
      });

      harness.emitRender(0, 10);
      dispose();
      harness.emitRender(0, 10);
      vi.advanceTimersByTime(2000);

      expect(snapshots).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
