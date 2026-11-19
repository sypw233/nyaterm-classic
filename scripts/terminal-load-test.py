#!/usr/bin/env python3
"""Terminal rendering load generator for NyaTerm performance testing.

Prints synthetic output that stresses the same paths a real TUI does, then
reports how much it actually emitted. Useful when comparing renderer settings
(e.g. "batch terminal output per frame", keyword highlighting, WebGL vs DOM) on
a machine where you cannot attach a profiler.

Why the modes differ: the DOM renderer rebuilds a `<span>` per colour run in
every repainted row, so cost scales with *distinct colour changes*, not with
byte count. A full-screen repaint with one colour per cell is far more
expensive than ten times as many bytes of single-colour scrolling text.

Usage:
    python3 scripts/terminal-load-test.py --mode dashboard --duration 30
    python3 scripts/terminal-load-test.py --mode fullscreen --fps 60 --duration 20
    python3 scripts/terminal-load-test.py --mode stream --sync --duration 15

Run inside the terminal being measured. Statistics go to stderr so they are
never mixed into the screen content; write stdout to /dev/null to check pure
generation cost:

    python3 scripts/terminal-load-test.py --mode tui --duration 5 > /dev/null

Ctrl-C stops early and still prints the summary.
"""

from __future__ import annotations

import argparse
import os
import random
import shutil
import sys
import time
from dataclasses import dataclass

CSI = "\x1b["
RESET = f"{CSI}0m"
HIDE_CURSOR = f"{CSI}?25l"
SHOW_CURSOR = f"{CSI}?25h"
ALT_SCREEN_ON = f"{CSI}?1049h"
ALT_SCREEN_OFF = f"{CSI}?1049l"
SYNC_BEGIN = f"{CSI}?2026h"
SYNC_END = f"{CSI}?2026l"
CLEAR = f"{CSI}2J"
HOME = f"{CSI}1;1H"

# Longest blocking sleep we will do in one go. Keeping this short means Ctrl-C
# is responsive even at very low --fps values.
MAX_SLEEP_SLICE_S = 0.05


def move(row: int, col: int) -> str:
    """1-based cursor positioning, matching ANSI conventions."""
    return f"{CSI}{row};{col}H"


def sgr_truecolor(r: int, g: int, b: int) -> str:
    return f"{CSI}38;2;{r};{g};{b}m"


def sgr_bg(r: int, g: int, b: int) -> str:
    return f"{CSI}48;2;{r};{g};{b}m"


@dataclass
class Stats:
    frames: int = 0
    chars: int = 0
    bytes: int = 0
    started_at: float = 0.0

    def add(self, payload: str) -> None:
        self.chars += len(payload)
        self.bytes += len(payload.encode("utf-8", "replace"))


class Output:
    """Buffered stdout writer that also records what it emitted."""

    def __init__(self, stream, stats: Stats) -> None:
        self._stream = stream
        self._stats = stats
        self._buffer: list[str] = []

    def write(self, text: str) -> None:
        self._buffer.append(text)

    def flush(self) -> None:
        if not self._buffer:
            return
        payload = "".join(self._buffer)
        self._buffer.clear()
        self._stats.add(payload)
        self._stream.write(payload)
        self._stream.flush()


# --------------------------------------------------------------------------
# Modes. Each builds one frame worth of escape sequences.
# --------------------------------------------------------------------------


def frame_stream(out: Output, cols: int, rows: int, tick: int, color_churn: float) -> None:
    """Scrolling log lines: the `tail -f` / build-output shape."""
    line_width = max(20, cols - 8)
    for line in range(3):
        n = tick * 3 + line
        if color_churn > 0 and random.random() < color_churn:
            out.write(sgr_truecolor(random.randrange(256), random.randrange(256), random.randrange(256)))
        out.write(f"[{n:07d}] ")
        filler = "".join(random.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(24))
        out.write(f"{filler:<{line_width}} level=INFO job=build-{n % 97:02d}\n")
        out.write(RESET)


def frame_spinner(out: Output, cols: int, rows: int, tick: int, color_churn: float) -> None:
    """One line repainted in place: the cheapest possible animation."""
    frames = "|/-\\"
    out.write(move(2, 1))
    out.write(sgr_truecolor(120, 200, 255))
    out.write(f" {frames[tick % len(frames)]} working... tick={tick}")
    out.write(RESET)
    out.write(f"{CSI}K")  # erase to end of line so longer previous text vanishes


def frame_progress(out: Output, cols: int, rows: int, tick: int, color_churn: float) -> None:
    """Several in-place progress bars, one per row: partial-repaint workload."""
    bar_rows = min(rows - 2, 8)
    width = max(10, cols - 30)
    for index in range(bar_rows):
        filled = (tick * (index + 1)) % (width + 1)
        pct = int(filled * 100 / width)
        out.write(move(index + 1, 1))
        if color_churn > 0:
            hue = (tick * 7 + index * 40) % 256
            out.write(sgr_truecolor(hue, 255 - hue, 128))
        out.write(f"{'#' * filled}{'-' * (width - filled)} {pct:3d}% row{index}")
        out.write(RESET)
        out.write(f"{CSI}K")


def frame_fullscreen(out: Output, cols: int, rows: int, tick: int, color_churn: float) -> None:
    """Every cell repainted with a churning colour: worst case for DOM rendering."""
    out.write(HOME)
    palette = ".#*+-=~"
    for row in range(rows):
        if color_churn >= 1.0:
            # Different colour per cell maximises the number of <span> elements.
            parts = []
            for col in range(cols):
                shade = (row * 7 + col * 3 + tick * 11) % 256
                parts.append(sgr_truecolor(shade, (shade * 2) % 256, 255 - shade))
                parts.append(palette[(row + col + tick) % len(palette)])
            out.write("".join(parts))
            out.write(RESET)
        else:
            out.write(sgr_truecolor((tick * 13) % 256, 90, 200))
            line = "".join(palette[(trace_row * 3 + tick) % len(palette)] for trace_row in range(cols))
            out.write(line)
            out.write(RESET)
        if row != rows - 1:
            out.write("\r\n")


def frame_dashboard(out: Output, cols: int, rows: int, tick: int, color_churn: float) -> None:
    """htop-like panel: box drawing borders plus animated values.

    This is the closest to what people actually run (btop, htop, nvtop): a
    mostly static frame whose interior numbers change every refresh.
    """
    inner_rows = max(3, rows - 2)
    inner_cols = max(20, cols - 2)
    out.write(HOME)

    top = "┌" + "─" * inner_cols + "┐"
    bottom = "└" + "─" * inner_cols + "┘"
    out.write(sgr_truecolor(120, 180, 255))
    out.write(top)
    out.write("\r\n")

    for row in range(inner_rows):
        out.write("│")
        body_len = inner_cols
        if 2 <= row <= inner_rows - 2:
            label = f" cpu{row:02d} "
            bars = max(5, body_len - len(label) - 12)
            level = (tick * (row + 3)) % (bars + 1)
            value = int(level * 100 / bars)
            colored = sgr_truecolor(255, 120, 60) + "#" * level + RESET
            rest = "-" * (bars - level)
            cell = f"{label}{colored}{rest} {value:3d}%"
            out.write(cell[:body_len].ljust(body_len))
        else:
            out.write(sgr_truecolor(200, 200, 200))
            out.write((" tick=" + str(tick)).ljust(body_len)[:body_len])
            out.write(RESET)
        out.write(sgr_truecolor(120, 180, 255))
        out.write("│")
        out.write("\r\n")

    out.write(bottom)
    out.write(RESET)


MODES = {
    "stream": frame_stream,
    "spinner": frame_spinner,
    "progress": frame_progress,
    "fullscreen": frame_fullscreen,
    "dashboard": frame_dashboard,
}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate synthetic terminal output to measure renderer load.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
modes:
  stream      scrolling log lines (tail -f / build output)
  spinner     single line repainted in place
  progress    several in-place progress bars
  fullscreen  every cell repainted, colour churning (worst case)
  dashboard   htop-like framed panel with animated values

examples:
  %(prog)s --mode dashboard --duration 30
  %(prog)s --mode fullscreen --fps 60 --duration 20
  %(prog)s --mode stream --sync --color-churn 0.9
""",
    )
    parser.add_argument("--mode", choices=sorted(MODES), default="dashboard")
    parser.add_argument("--fps", type=float, default=30.0, help="frames per second (default: 30)")
    parser.add_argument(
        "--duration",
        type=float,
        default=20.0,
        help="seconds to run; 0 runs until Ctrl-C (default: 20)",
    )
    parser.add_argument("--cols", type=int, default=0, help="columns (default: terminal width)")
    parser.add_argument("--rows", type=int, default=0, help="rows (default: terminal height)")
    parser.add_argument(
        "--color-churn",
        type=float,
        default=0.35,
        help="0..1, how often colours change (1 = every cell in fullscreen). "
        "Higher values create more distinct spans and cost more to render.",
    )
    parser.add_argument(
        "--sync",
        action="store_true",
        help="wrap each frame in DEC 2026 synchronized output; without it the "
        "terminal may repaint a half-written frame",
    )
    parser.add_argument(
        "--no-alt-screen",
        action="store_true",
        help="do not switch to the alternate screen (dashboard/fullscreen use it by default)",
    )
    return parser.parse_args(argv)


def terminal_size() -> tuple[int, int]:
    size = shutil.get_terminal_size(fallback=(80, 24))
    return size.columns, size.lines


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    detected_cols, detected_rows = terminal_size()
    cols = args.cols if args.cols > 0 else detected_cols
    rows = args.rows if args.rows > 0 else detected_rows
    fps = max(0.1, args.fps)
    frame_interval = 1.0 / fps
    color_churn = min(1.0, max(0.0, args.color_churn))

    stats = Stats(started_at=time.perf_counter())
    stream = sys.stdout
    try:
        # Avoid Windows translating \n to \r\n: the terminal handles line
        # endings itself, and doubled CR would break in-place repaints.
        stream.reconfigure(encoding="utf-8", newline="")
    except (AttributeError, ValueError):
        pass
    out = Output(stream, stats)

    uses_alt_screen = args.mode in ("dashboard", "fullscreen") and not args.no_alt_screen

    frame_fn = MODES[args.mode]
    tick = 0
    try:
        if uses_alt_screen:
            out.write(ALT_SCREEN_ON)
        out.write(HIDE_CURSOR)
        if uses_alt_screen:
            out.write(CLEAR + HOME)
        out.flush()

        deadline = stats.started_at + args.duration if args.duration > 0 else float("inf")
        next_frame_at = stats.started_at

        while time.perf_counter() < deadline:
            now = time.perf_counter()
            if now < next_frame_at:
                # Sleep in slices so Ctrl-C is handled promptly.
                time.sleep(min(next_frame_at - now, MAX_SLEEP_SLICE_S))
                continue

            if args.sync:
                out.write(SYNC_BEGIN)
            frame_fn(out, cols, rows, tick, color_churn)
            if args.sync:
                out.write(SYNC_END)
            out.flush()

            tick += 1
            stats.frames += 1

            next_frame_at += frame_interval
            # If we fell behind by more than a frame (slow renderer), resync
            # instead of trying to catch up with a burst.
            if next_frame_at < time.perf_counter() - frame_interval:
                next_frame_at = time.perf_counter()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            if uses_alt_screen:
                out.write(ALT_SCREEN_OFF)
            out.write(SHOW_CURSOR)
            out.flush()
        except Exception:  # noqa: BLE001 - best effort cleanup
            pass
        report(stats, args.mode, fps, cols, rows)

    return 0


def report(stats: Stats, mode: str, fps: float, cols: int, rows: int) -> None:
    elapsed = max(1e-6, time.perf_counter() - stats.started_at)
    lines = [
        "",
        "── terminal load test ─────────────────────────",
        f"  mode            {mode}",
        f"  geometry        {cols}x{rows}",
        f"  target fps      {fps:g}",
        f"  elapsed         {elapsed:.2f} s",
        f"  frames          {stats.frames}",
        f"  actual fps      {stats.frames / elapsed:.1f}",
        f"  characters      {stats.chars:,}",
        f"  utf-8 bytes     {stats.bytes:,}",
        f"  throughput      {stats.bytes / elapsed / 1024:.1f} KiB/s",
        "───────────────────────────────────────────────",
        "",
    ]
    # stderr keeps the summary out of the screen content being measured.
    sys.stderr.write("\n".join(lines))
    sys.stderr.flush()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
