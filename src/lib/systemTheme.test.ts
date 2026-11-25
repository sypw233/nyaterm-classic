import { describe, expect, it } from "vitest";
import { resolveEffectiveThemeId, systemAppearanceFromMatchMedia } from "./systemTheme";

function settings(overrides: Partial<Parameters<typeof resolveEffectiveThemeId>[0]> = {}) {
  return {
    theme: "github-dark",
    theme_mode: "manual",
    light_theme: "github-light",
    dark_theme: "github-dark",
    ...overrides,
  };
}

describe("systemAppearanceFromMatchMedia", () => {
  it("maps the dark media query to the dark appearance", () => {
    expect(systemAppearanceFromMatchMedia(true)).toBe("dark");
    expect(systemAppearanceFromMatchMedia(false)).toBe("light");
  });
});

describe("resolveEffectiveThemeId", () => {
  it("keeps the saved theme in manual mode regardless of OS appearance", () => {
    expect(
      resolveEffectiveThemeId(settings({ theme: "nord" }), "light"),
    ).toBe("nord");
    expect(
      resolveEffectiveThemeId(settings({ theme: "nord" }), "dark"),
    ).toBe("nord");
  });

  it("treats unknown modes as manual so future or legacy values stay usable", () => {
    expect(
      resolveEffectiveThemeId(settings({ theme: "dracula", theme_mode: "auto" }), "light"),
    ).toBe("dracula");
  });

  it("selects the configured light or dark theme in system mode", () => {
    expect(
      resolveEffectiveThemeId(
        settings({ light_theme: "solarized-light", dark_theme: "dracula", theme_mode: "system" }),
        "light",
      ),
    ).toBe("solarized-light");
    expect(
      resolveEffectiveThemeId(
        settings({ light_theme: "solarized-light", dark_theme: "dracula", theme_mode: "system" }),
        "dark",
      ),
    ).toBe("dracula");
  });

  it("falls back to built-in light/dark themes when a custom theme is missing", () => {
    expect(
      resolveEffectiveThemeId(
        settings({ light_theme: "deleted-custom", theme_mode: "system" }),
        "light",
      ),
    ).toBe("github-light");
    expect(
      resolveEffectiveThemeId(
        settings({ dark_theme: "deleted-custom", theme_mode: "system" }),
        "dark",
      ),
    ).toBe("github-dark");
  });

  it("keeps a custom light/dark theme that still exists in the catalog", () => {
    const custom = [
      {
        id: "my-light",
        name: "My Light",
        label: "ML",
        swatch: "#fff",
        colors: {} as never,
      },
    ];
    expect(
      resolveEffectiveThemeId(
        settings({ light_theme: "my-light", theme_mode: "system", custom_themes: custom }),
        "light",
      ),
    ).toBe("my-light");
  });
});
