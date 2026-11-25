import {
  DEFAULT_THEME_ID,
  isBuiltinThemeId,
  type Theme,
  resolveTheme,
} from "@/lib/themes";

export const DEFAULT_LIGHT_THEME_ID = "github-light";

export type SystemAppearance = "light" | "dark";

/** Device-local preference only: never persisted, backed up, or synchronized. */
export function systemAppearanceFromMatchMedia(matchesDark: boolean): SystemAppearance {
  return matchesDark ? "dark" : "light";
}

/**
 * Resolve the theme actually used by the UI.
 *
 * Manual mode (and any unknown/future mode) keeps the saved `theme` unchanged,
 * so legacy settings and forward-compatible values keep working. System mode
 * selects between the saved light/dark themes; a missing custom theme falls
 * back to the matching built-in without rewriting the id in settings.
 */
export function resolveEffectiveThemeId(
  settings: {
    theme: string;
    theme_mode: string;
    light_theme: string;
    dark_theme: string;
    custom_themes?: readonly Theme[];
  },
  system: SystemAppearance,
): string {
  if (settings.theme_mode !== "system") return settings.theme || DEFAULT_THEME_ID;

  const customThemes = settings.custom_themes ?? [];
  const candidate = system === "dark" ? settings.dark_theme : settings.light_theme;
  const fallback = system === "dark" ? DEFAULT_THEME_ID : DEFAULT_LIGHT_THEME_ID;
  const resolved = resolveTheme(candidate, customThemes);
  if (candidate && (isBuiltinThemeId(candidate) || resolved.id === candidate)) return candidate;
  return fallback;
}
