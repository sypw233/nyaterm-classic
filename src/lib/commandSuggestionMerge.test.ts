import { describe, expect, it } from "vitest";
import { mergeCommandSuggestions } from "./commandSuggestionMerge";
import type { FuzzyResult } from "@/types/global";

function result(command: string, score: number, source: string): FuzzyResult {
  return { command, display: command, indices: [], score, source };
}

describe("mergeCommandSuggestions", () => {
  it("keeps the highest-scoring provider for a duplicate command", () => {
    const merged = mergeCommandSuggestions([
      [result("git status", 10, "history")],
      [result("git status", 500, "path")],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("path");
  });

  it("orders by score so path rows lead when scoped", () => {
    const merged = mergeCommandSuggestions([
      [result("git log", 42, "history")],
      [result("cd /var/lib/", 1_000_000, "path")],
    ]);
    expect(merged.map((item) => item.command)).toEqual([
      "cd /var/lib/",
      "git log",
    ]);
  });

  it("caps the merged list", () => {
    const provider = Array.from({ length: 30 }, (_, index) =>
      result(`command-${index}`, 100 - index, "history"),
    );
    expect(mergeCommandSuggestions([provider], 5)).toHaveLength(5);
  });

  it("is stable for equal scores", () => {
    const merged = mergeCommandSuggestions([
      [result("first", 100, "history"), result("second", 100, "history")],
    ]);
    expect(merged.map((item) => item.command)).toEqual(["first", "second"]);
  });
});
