import { describe, expect, it } from "vitest";
import { planSuggestionFill } from "./suggestionFillPolicy";

describe("planSuggestionFill", () => {
  it("rewrites by backspacing the tracked line when routing is local", () => {
    expect(
      planSuggestionFill({
        line: "git st",
        cursor: 6,
        suggestion: "git status",
        mayFanOut: false,
      }),
    ).toEqual({
      policy: "rewrite",
      data: `${"\x7f".repeat(6)}git status`,
    });
  });

  it("rewrites a mid-line suggestion with Ctrl-U while local", () => {
    expect(
      planSuggestionFill({
        line: "git st",
        cursor: 3,
        suggestion: "git status",
        mayFanOut: false,
      }),
    ).toEqual({ policy: "rewrite", data: "\u0005\u0015git status" });
  });

  it("appends only the suffix at the end of the line when routing is shared", () => {
    expect(
      planSuggestionFill({
        line: "git st",
        cursor: 6,
        suggestion: "git status",
        mayFanOut: true,
      }),
    ).toEqual({ policy: "append-only", data: "atus" });
  });

  it("rejects a suggestion that disagrees with typed text when routing is shared", () => {
    expect(
      planSuggestionFill({
        line: "git st",
        cursor: 6,
        suggestion: "npm start",
        mayFanOut: true,
      }),
    ).toEqual({ policy: "reject", data: "" });
  });

  it("rejects a mid-line fill when routing is shared", () => {
    expect(
      planSuggestionFill({
        line: "git st",
        cursor: 3,
        suggestion: "git status",
        mayFanOut: true,
      }),
    ).toEqual({ policy: "reject", data: "" });
  });
});
