/**
 * Inference of command block starts from reproduced terminal output.
 *
 * Shell integration (OSC 133) reports exact block boundaries. Without it, the
 * terminal has to infer where a submitted command began from the buffer: the
 * command may wrap across several rows, and a later observation (a new prompt,
 * reflow, or a different line) can contradict an earlier guess.
 *
 * The helpers here are presentation-only: they never grant editing or
 * execution permission. They are pure so the revocation rules can be unit
 * tested without an xterm.js instance.
 */

export interface BlockStartRow {
  /** Absolute buffer line index (baseY + cursorY). */
  line: number;
  /** The row continues the previous logical line. */
  isWrapped: boolean;
  /** Stable content of the row; used to detect reflow/rewrite. */
  text: string;
}

export interface BlockStartInference {
  startLine: number;
  /** Content signature of every row the block spans, for later revocation. */
  signature: string[];
}

export const MAX_WRAPPED_LINE_LOOKBACK_ROWS = 200;

/**
 * Find the first row of the logical line ending at `cursorLine`.
 *
 * Wrapped continuations share the logical line, so walk backwards while the
 * current row reports `isWrapped`. The lookback is bounded: a pathological
 * stream of wrapped rows cannot stall input handling, and an unbounded walk
 * would also be wrong because older rows belong to previous commands.
 */
export function inferBlockStartLine(
  rows: ReadonlyArray<BlockStartRow>,
  cursorLine: number,
  maxLookback = MAX_WRAPPED_LINE_LOOKBACK_ROWS,
): BlockStartInference | null {
  const byLine = new Map<number, BlockStartRow>();
  for (const row of rows) byLine.set(row.line, row);

  const cursorRow = byLine.get(cursorLine);
  if (!cursorRow) return null;

  let startLine = cursorLine;
  let steps = 0;
  while (steps < maxLookback) {
    const row = byLine.get(startLine);
    if (!row || !row.isWrapped) break;
    startLine -= 1;
    steps += 1;
  }

  // If the row that should start the block is missing (scrolled away), the
  // inference is unreliable; callers should fall back to the cursor row.
  const startRow = byLine.get(startLine);
  if (!startRow || startRow.isWrapped) return null;

  const signature: string[] = [];
  for (let line = startLine; line <= cursorLine; line += 1) {
    const row = byLine.get(line);
    if (!row) return null;
    signature.push(row.text);
  }
  return { startLine, signature };
}

/** True when a previously inferred block is contradicted by the current rows. */
export function isBlockStartRevoked(
  inference: BlockStartInference,
  rows: ReadonlyArray<BlockStartRow>,
): boolean {
  const byLine = new Map<number, BlockStartRow>();
  for (const row of rows) byLine.set(row.line, row);

  for (let index = 0; index < inference.signature.length; index += 1) {
    const row = byLine.get(inference.startLine + index);
    // Content changed (reflow, clear, or another program painting the row) or
    // the row disappeared: the boundary no longer describes what was submitted.
    if (!row || row.text !== inference.signature[index]) return true;
  }
  return false;
}

/**
 * Small bounded cache of row observations. Terminal repaints observe the same
 * rows repeatedly; caching their signature avoids re-reading every row on each
 * submission while keeping memory fixed on long-lived sessions.
 */
export class BlockRowCache {
  private readonly entries = new Map<number, string>();

  constructor(private readonly capacity: number = 4_096) {}

  get(line: number): string | undefined {
    return this.entries.get(line);
  }

  set(line: number, text: string): void {
    if (this.entries.has(line)) this.entries.delete(line);
    this.entries.set(line, text);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
