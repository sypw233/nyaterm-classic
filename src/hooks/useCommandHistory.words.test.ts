import { describe, expect, it } from "vitest";
import { buildWordSuggestions } from "./useCommandHistory";
import { tokenizeCommandLine, tokenAtCursor } from "@/lib/wordCompletion";

/**
 * The word provider is pure logic, so it is tested directly instead of through
 * `renderHook`, which needs a DOM. The hook wrapper only decides whether to call
 * it, based on the settings switch.
 */
const vocabulary = async () => ["conda", "deactivate", "activate", "git"];

describe("buildWordSuggestions", () => {
  it("offers words that start with the typed prefix", async () => {
    const line = "conda de";
    const rows = await buildWordSuggestions(tokenAtCursor(line, 8), 2, vocabulary);

    expect(rows.map((row) => row.command)).toEqual(["deactivate"]);
  });

  it("offers the command word itself when the user has only typed its start", async () => {
    const rows = await buildWordSuggestions(tokenAtCursor("co", 2), 2, vocabulary);
    expect(rows.map((row) => row.command)).toEqual(["conda"]);
  });

  it("records the token span so selection edits only that word", async () => {
    const line = "conda de";
    const rows = await buildWordSuggestions(tokenAtCursor(line, 8), 2, vocabulary);

    expect(rows[0].wordRange).toEqual({ start: 6, end: 8 });
    expect(rows[0].source).toBe("word");
  });

  it("prefers the shortest completion first", async () => {
    const rows = await buildWordSuggestions(tokenAtCursor("a", 1), 1, async () => [
      "activate",
      "attach",
      "add",
    ]);
    expect(rows.map((row) => row.command)).toEqual(["add", "attach", "activate"]);
  });

  it("returns nothing below the minimum prefix length", async () => {
    expect(await buildWordSuggestions(tokenAtCursor("d", 1), 2, vocabulary)).toEqual([]);
  });

  it("returns nothing when the caret is in whitespace", async () => {
    expect(await buildWordSuggestions(tokenAtCursor("conda ", 6), 2, vocabulary)).toEqual([]);
  });

  it("never offers the word already typed in full", async () => {
    const line = "deactivate";
    const rows = await buildWordSuggestions(
      tokenAtCursor(line, line.length),
      2,
      vocabulary,
    );
    expect(rows.map((row) => row.command)).not.toContain("deactivate");
  });

  it("caps the number of rows", async () => {
    const many = Array.from({ length: 50 }, (_, index) => `word${index}`);
    const rows = await buildWordSuggestions(tokenAtCursor("word", 4), 2, async () => many);
    expect(rows.length).toBeLessThanOrEqual(8);
  });

  it("handles a caret inside a longer line", async () => {
    // Completing `de` while the rest of the pipeline is already typed.
    const line = "conda de | grep x";
    const hit = tokenAtCursor(line, 8);
    const rows = await buildWordSuggestions(hit, 2, vocabulary);

    expect(rows.map((row) => row.command)).toEqual(["deactivate"]);
    expect(rows[0].wordRange).toEqual({ start: 6, end: 8 });
  });
});

describe("word completion tokenization contract", () => {
  it("agrees with the tokenizer the provider receives", () => {
    // Guards the assumption that `tokenAtCursor` positions match what
    // `buildWordCompletionKeystrokes` replaces.
    const line = "conda de | grep x";
    const tokens = tokenizeCommandLine(line);
    const hit = tokenAtCursor(line, 8);
    expect(tokens[hit!.index]).toEqual(hit!.token);
  });
});
