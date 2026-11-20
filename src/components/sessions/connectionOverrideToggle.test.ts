import { describe, expect, it } from "vitest";
import type { ConnectionOverrides } from "@/types/global";
import { applyOverrideFieldToggle } from "./connectionOverrideToggle";

describe("applyOverrideFieldToggle", () => {
  it("stores the current global value when customizing", () => {
    const next = applyOverrideFieldToggle({}, "font_size", true, 16);
    expect(next).toEqual({ font_size: 16 });
  });

  it("deletes the key when switching back to global", () => {
    // Deleting rather than writing the global value is what keeps the
    // connection following later global changes.
    const next = applyOverrideFieldToggle({ font_size: 12 }, "font_size", false, 16);
    expect("font_size" in next).toBe(false);
    expect(next).toEqual({});
  });

  it("leaves other overrides untouched", () => {
    const before: ConnectionOverrides = {
      font_size: 12,
      scrollback_lines: 500,
      keyword_highlights: [],
    };
    const next = applyOverrideFieldToggle(before, "font_size", false, 16);
    expect(next).toEqual({ scrollback_lines: 500, keyword_highlights: [] });
    expect(before.font_size).toBe(12);
  });

  it("is idempotent when customizing an already customized field", () => {
    const next = applyOverrideFieldToggle({ font_size: 12 }, "font_size", true, 16);
    expect(next.font_size).toBe(16);
  });

  it("distinguishes an explicit false from unset", () => {
    const enabled = applyOverrideFieldToggle({}, "keyword_highlights_enabled", true, false);
    expect("keyword_highlights_enabled" in enabled).toBe(true);
    expect(enabled.keyword_highlights_enabled).toBe(false);

    const disabled = applyOverrideFieldToggle(enabled, "keyword_highlights_enabled", false, false);
    expect("keyword_highlights_enabled" in disabled).toBe(false);
  });
});
