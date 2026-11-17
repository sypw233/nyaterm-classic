import { describe, expect, it } from "vitest";
import { validateTheme } from "./customThemes";
import {
  parseWindowsTerminalSchemes,
  parseWindowsTerminalThemes,
  stripJsonc,
  windowsTerminalSchemeToTheme,
} from "./themeImport";

const SAMPLE = `{
  // Windows Terminal settings with JSONC comments
  "$schema": "https://aka.ms/terminal-profiles-schema",
  "schemes": [
    {
      "name": "Campbell",
      "background": "#0C0C0C",
      "foreground": "#CCCCCC",
      "cursorColor": "#FFFFFF",
      "selectionBackground": "#FFFFFF",
      "black": "#0C0C0C",
      "white": "#F2F2F2",
      "brightBlue": "#3B78FF", /* trailing block comment */
    },
    {
      "name": "Solarized Dark",
      "background": "#002B36",
      "foreground": "#839496",
      "blue": "#268BD2",
    },
  ],
}`;

describe("stripJsonc", () => {
  it("removes comments and trailing commas", () => {
    const text = stripJsonc(SAMPLE);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).not.toContain("Windows Terminal settings with JSONC comments");
    expect(text).not.toContain("trailing block comment");
  });

  it("keeps comment-like sequences inside strings", () => {
    const text = stripJsonc(
      '{"url":"https://example.com/a//b","note":"/* x */"}',
    );
    const parsed = JSON.parse(text);
    expect(parsed.url).toBe("https://example.com/a//b");
    expect(parsed.note).toBe("/* x */");
  });
});

describe("parseWindowsTerminalSchemes", () => {
  it("reads a schemes array", () => {
    const schemes = parseWindowsTerminalSchemes(SAMPLE);
    expect(schemes.map((scheme) => scheme.name)).toEqual([
      "Campbell",
      "Solarized Dark",
    ]);
  });

  it("reads a single scheme object and an array of schemes", () => {
    expect(
      parseWindowsTerminalSchemes(
        '{"background":"#000000","foreground":"#ffffff"}',
      ),
    ).toHaveLength(1);
    expect(
      parseWindowsTerminalSchemes('[{"background":"#000000"}]'),
    ).toHaveLength(1);
  });

  it("returns an empty array for non-scheme JSON", () => {
    expect(parseWindowsTerminalSchemes('{"version":1}')).toEqual([]);
  });
});

describe("windowsTerminalSchemeToTheme", () => {
  it("produces a valid NyaTerm theme", () => {
    const theme = windowsTerminalSchemeToTheme({
      name: "Campbell",
      background: "#0c0c0c",
      foreground: "#cccccc",
    });
    expect(validateTheme(theme)).toEqual([]);
    expect(theme.swatch).toBe("#0c0c0c");
    expect(theme.colors.terminal.background).toBe("#0c0c0c");
    expect(theme.id.startsWith("wt-")).toBe(true);
  });

  it("falls back to defaults for missing colors", () => {
    const theme = windowsTerminalSchemeToTheme({ name: "Sparse" });
    expect(validateTheme(theme)).toEqual([]);
  });
});

describe("parseWindowsTerminalThemes", () => {
  it("maps every scheme with unique ids", () => {
    const themes = parseWindowsTerminalThemes(SAMPLE);
    expect(themes).toHaveLength(2);
    const ids = new Set(themes.map((theme) => theme.id));
    expect(ids.size).toBe(2);
    for (const theme of themes) {
      expect(validateTheme(theme)).toEqual([]);
    }
  });
});
