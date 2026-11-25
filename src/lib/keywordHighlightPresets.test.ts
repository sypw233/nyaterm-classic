import { describe, expect, it } from "vitest";
import type { KeywordHighlightRule } from "@/types/global";
import {
  overlaySessionHighlightRules,
  type ResolvedHighlightRule,
} from "./keywordHighlightPresets";

function sessionRule(overrides: Partial<KeywordHighlightRule> = {}): KeywordHighlightRule {
  return {
    id: "rule-1",
    name: "Error",
    patterns: ["ERROR"],
    color_dark: "#ff0000",
    color_light: "#aa0000",
    enabled: true,
    ...overrides,
  };
}

const globalRule = (id: string, color = "#111111"): ResolvedHighlightRule => ({
  id,
  name: id,
  patterns: [id],
  color,
  enabled: true,
});

describe("overlaySessionHighlightRules", () => {
  it("returns the global rules unchanged when there are no session rules", () => {
    const global = [globalRule("a"), globalRule("b")];
    expect(overlaySessionHighlightRules(global, [], true)).toEqual(global);
  });

  it("replaces a global rule with the same id in place", () => {
    const global = [globalRule("a", "#111111"), globalRule("b", "#222222")];
    const merged = overlaySessionHighlightRules(global, [sessionRule({ id: "a" })], true);

    expect(merged.map((rule) => rule.id)).toEqual(["a", "b"]);
    expect(merged[0].color).toBe("#ff0000");
    expect(merged[1].color).toBe("#222222");
  });

  it("picks the colour for the active theme", () => {
    const mergedLight = overlaySessionHighlightRules([], [sessionRule()], false);
    const mergedDark = overlaySessionHighlightRules([], [sessionRule()], true);
    expect(mergedLight[0].color).toBe("#aa0000");
    expect(mergedDark[0].color).toBe("#ff0000");
  });

  it("appends new session-only rules after the global rules", () => {
    const global = [globalRule("a")];
    const merged = overlaySessionHighlightRules(global, [sessionRule({ id: "session-only" })], true);
    expect(merged.map((rule) => rule.id)).toEqual(["a", "session-only"]);
  });

  it("does not mutate the input arrays", () => {
    const global = [globalRule("a")];
    const session = [sessionRule()];
    overlaySessionHighlightRules(global, session, true);
    expect(global).toHaveLength(1);
    expect(session).toHaveLength(1);
  });
});
