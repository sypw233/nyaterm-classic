import { describe, expect, it } from "vitest";
import {
  BlockRowCache,
  inferBlockStartLine,
  isBlockStartRevoked,
  type BlockStartRow,
} from "./commandBlockInference";

function row(line: number, text: string, isWrapped = false): BlockStartRow {
  return { line, text, isWrapped };
}

describe("inferBlockStartLine", () => {
  it("walks back across wrapped continuations to the logical line start", () => {
    const rows = [
      row(10, "$ tar -czf backup.tgz very", false),
      row(11, "long/path", true),
      row(12, "and more", true),
    ];
    expect(inferBlockStartLine(rows, 12)).toEqual({
      startLine: 10,
      signature: ["$ tar -czf backup.tgz very", "long/path", "and more"],
    });
  });

  it("returns the cursor row when it is a single unwrapped row", () => {
    expect(inferBlockStartLine([row(5, "$ ls")], 5)).toEqual({
      startLine: 5,
      signature: ["$ ls"],
    });
  });

  it("stops at the lookback bound instead of walking forever", () => {
    const rows: BlockStartRow[] = [];
    for (let line = 0; line <= 30; line += 1) rows.push(row(line, `${line}`, line > 0));
    const inference = inferBlockStartLine(rows, 30, 5);
    // The walk stops after five steps even though every row claims to wrap.
    expect(inference).toBeNull();
  });

  it("returns null when the cursor row is unknown", () => {
    expect(inferBlockStartLine([row(1, "x")], 9)).toBeNull();
  });
});

describe("isBlockStartRevoked", () => {
  const rows = [row(10, "$ echo hi"), row(11, "hi", true)];

  it("stays valid while the rows are unchanged", () => {
    const inference = inferBlockStartLine(rows, 11);
    expect(inference).not.toBeNull();
    expect(isBlockStartRevoked(inference!, rows)).toBe(false);
  });

  it("revokes when a row is rewritten", () => {
    const inference = inferBlockStartLine(rows, 11)!;
    expect(
      isBlockStartRevoked(inference, [row(10, "$ echo bye"), row(11, "hi", true)]),
    ).toBe(true);
  });

  it("revokes when a covered row disappears", () => {
    const inference = inferBlockStartLine(rows, 11)!;
    expect(isBlockStartRevoked(inference, [row(10, "$ echo hi")])).toBe(true);
  });
});

describe("BlockRowCache", () => {
  it("evicts the oldest entry beyond capacity", () => {
    const cache = new BlockRowCache(2);
    cache.set(1, "a");
    cache.set(2, "b");
    cache.set(3, "c");
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBe("b");
    expect(cache.get(3)).toBe("c");
    expect(cache.size).toBe(2);
  });

  it("refreshes recency when an existing line is set again", () => {
    const cache = new BlockRowCache(2);
    cache.set(1, "a");
    cache.set(2, "b");
    cache.set(1, "a2");
    cache.set(3, "c");
    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(1)).toBe("a2");
  });
});
