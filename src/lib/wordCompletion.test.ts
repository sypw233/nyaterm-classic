import { describe, expect, it } from "vitest";
import {
  applyWordCompletion,
  buildWordCompletionKeystrokes,
  collectKnownWords,
  isWordCompletionCandidate,
  tokenAtCursor,
  tokenizeCommandLine,
  tokenQuote,
} from "./wordCompletion";

describe("tokenizeCommandLine", () => {
  it("splits on whitespace", () => {
    const tokens = tokenizeCommandLine("conda deactivate");
    expect(tokens.map((t) => t.text)).toEqual(["conda", "deactivate"]);
    expect(tokens[0]).toMatchObject({ start: 0, end: 5 });
    expect(tokens[1]).toMatchObject({ start: 6, end: 16 });
  });

  it("splits on shell operators, not only spaces", () => {
    const tokens = tokenizeCommandLine("a && b|c;d");
    expect(tokens.map((t) => t.text)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps a quoted span as one token", () => {
    const tokens = tokenizeCommandLine('echo "a b"');
    expect(tokens.map((t) => t.text)).toEqual(["echo", "a b"]);
    // The recorded range still covers the quotes so replacing keeps the line valid.
    expect(tokens[1].start).toBe(5);
    expect(tokens[1].end).toBe(10);
  });

  it("treats a dangling quote as a usable token", () => {
    expect(tokenizeCommandLine('echo "abc').map((t) => t.text)).toEqual(["echo", "abc"]);
  });

  it("returns nothing for blank input", () => {
    expect(tokenizeCommandLine("   ")).toEqual([]);
  });
});

describe("tokenAtCursor", () => {
  it("returns the command word while typing it", () => {
    const hit = tokenAtCursor("co", 2);
    expect(hit?.prefix).toBe("co");
    expect(hit?.token.text).toBe("co");
  });

  it("returns the later argument the user is typing", () => {
    const hit = tokenAtCursor("conda de", 8);
    expect(hit?.prefix).toBe("de");
    expect(hit?.index).toBe(1);
  });

  it("tracks the caret inside a word rather than its end", () => {
    // Caret sits after "de" but "deactivate" continues, so prefix is "de".
    const hit = tokenAtCursor("conda deactivate", 8);
    expect(hit?.prefix).toBe("de");
  });

  it("returns null when the caret is right after whitespace", () => {
    expect(tokenAtCursor("conda ", 6)).toBeNull();
  });

  it("clamps a cursor past the end of the line", () => {
    const hit = tokenAtCursor("conda", 999);
    expect(hit?.prefix).toBe("conda");
  });
});

describe("isWordCompletionCandidate", () => {
  it("matches by prefix case-insensitively", () => {
    expect(isWordCompletionCandidate("deactivate", "de", 2)).toBe(true);
    expect(isWordCompletionCandidate("Deactivate", "de", 2)).toBe(true);
  });

  it("rejects the word the user already typed", () => {
    expect(isWordCompletionCandidate("deactivate", "deactivate", 2)).toBe(false);
  });

  it("rejects candidates below the minimum prefix length", () => {
    expect(isWordCompletionCandidate("deactivate", "d", 2)).toBe(false);
  });

  it("rejects non-prefix matches", () => {
    expect(isWordCompletionCandidate("activate", "de", 2)).toBe(false);
  });
});

describe("collectKnownWords", () => {
  it("collects words from both ends of a history line", () => {
    const words = collectKnownWords(["conda deactivate"]);
    expect(words).toEqual(["conda", "deactivate"]);
  });

  it("deduplicates case-insensitively, keeping the first spelling", () => {
    const words = collectKnownWords(["Conda deactivate", "conda activate"]);
    expect(words).toEqual(["Conda", "deactivate", "activate"]);
  });

  it("skips flags so they do not crowd out subcommands", () => {
    expect(collectKnownWords(["ls --color=auto -la"])).toEqual(["ls"]);
  });

  it("respects the limit", () => {
    expect(collectKnownWords(["a b c d e"], 3)).toHaveLength(3);
  });
});

describe("applyWordCompletion", () => {
  it("replaces only the token under the caret", () => {
    const line = "conda ac";
    const token = tokenizeCommandLine(line)[1];
    expect(applyWordCompletion(line, token, "activate")).toEqual({
      line: "conda activate",
      cursor: 14,
    });
  });

  it("preserves the rest of the line after the token", () => {
    const line = "git che --all";
    const token = tokenizeCommandLine(line)[1];
    expect(applyWordCompletion(line, token, "checkout").line).toBe("git checkout --all");
  });

  it("re-quotes when the token was quoted", () => {
    const line = 'echo "ac';
    const token = tokenizeCommandLine(line)[1];
    const result = applyWordCompletion(line, token, "activate", tokenQuote(token, line));
    expect(result.line).toBe('echo "activate"');
  });
});

describe("tokenQuote", () => {
  it("detects both quote styles", () => {
    const doubleLine = 'echo "ac"';
    expect(tokenQuote(tokenizeCommandLine(doubleLine)[1], doubleLine)).toBe('"');
    const singleLine = "echo 'ac'";
    expect(tokenQuote(tokenizeCommandLine(singleLine)[1], singleLine)).toBe("'");
  });

  it("returns undefined for an unquoted token", () => {
    const line = "echo ac";
    expect(tokenQuote(tokenizeCommandLine(line)[1], line)).toBeUndefined();
  });
});

describe("buildWordCompletionKeystrokes", () => {
  it("rewrites the line and walks the caret back to the insertion point", () => {
    const line = "conda ac";
    const token = tokenizeCommandLine(line)[1];
    const keys = buildWordCompletionKeystrokes(line, token, "activate");

    // Ctrl-E, Ctrl-U, the rewritten line, then one left arrow so the caret
    // lands right after "activate" (the line ends with it, so there are none).
    expect(keys).toBe("\u0005\u0015conda activate");
    expect(keys.endsWith("\r")).toBe(false);
  });

  it("moves the caret left when the replaced word is not at the end", () => {
    const line = "git ch --all";
    const token = tokenizeCommandLine(line)[1];
    const keys = buildWordCompletionKeystrokes(line, token, "checkout");

    // "git checkout --all" is 18 chars; insertion ends at 12, so 6 steps back.
    expect(keys).toBe(`\u0005\u0015git checkout --all${"\x1b[D".repeat(6)}`);
  });

  it("keeps an opening quote so the shell still sees one argument", () => {
    const line = 'echo "ac';
    const token = tokenizeCommandLine(line)[1];
    const keys = buildWordCompletionKeystrokes(line, token, "activate", '"');
    expect(keys).toBe('\u0005\u0015echo "activate"');
  });

  it("completes a word in the middle of a pipeline without touching the tail", () => {
    // The caret is inside "de" when the user has already typed the rest.
    const line = "conda de | grep x";
    const hit = tokenAtCursor(line, 8);
    expect(hit?.prefix).toBe("de");
    expect(hit).not.toBeNull();

    const keys = buildWordCompletionKeystrokes(line, hit!.token, "deactivate");
    const rewritten = keys.replace("\u0005\u0015", "").replace(/\x1b\[D/g, "");
    expect(rewritten).toBe("conda deactivate | grep x");
  });
});
