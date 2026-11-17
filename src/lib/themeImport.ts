import { generateCustomThemeId, normalizeImportedTheme } from "./customThemes";
import type { TerminalColors, Theme } from "./themes";

/**
 * Windows Terminal color scheme (a subset of the fields NyaTerm understands).
 * https://learn.microsoft.com/windows/terminal/customize-settings/color-schemes
 */
interface WindowsTerminalScheme {
  name?: string;
  background?: string;
  foreground?: string;
  cursorColor?: string;
  selectionBackground?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

const ANSI_FALLBACK: Omit<
  TerminalColors,
  | "foregroundIntense"
  | "lineHighlight"
  | "findMatchBackground"
  | "findMatchBorder"
> = {
  background: "#0d1117",
  foreground: "#e6edf3",
  cursor: "#e6edf3",
  selectionBackground: "#264f78",
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#3b82f6",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
};

/**
 * Removes `//` and `/* *\/` comments plus trailing commas from a JSONC document
 * while leaving string contents untouched. Windows Terminal settings use JSONC.
 */
export function stripJsonc(input: string): string {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        out += char;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === "\\") {
        if (i + 1 < input.length) {
          out += input[i + 1];
          i += 1;
        }
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    out += char;
  }
  // Drop trailing commas before } or ] (outside strings is already guaranteed here).
  return out.replace(/,\s*([}\]])/g, "$1");
}

function normalizeHex(value: string | undefined, fallback: string): string {
  const candidate = (value ?? "").trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(candidate);
  if (!match) return fallback;
  let hex = match[1].toLowerCase();
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((char) => char + char)
      .join("");
  }
  return `#${hex.slice(0, 6)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function mix(a: string, b: string, ratio: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const channel = (x: number, y: number) =>
    Math.round(x + (y - x) * ratio)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`;
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function schemeSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "windows-terminal";
}

export function parseWindowsTerminalSchemes(
  text: string,
): WindowsTerminalScheme[] {
  let data: unknown;
  try {
    data = JSON.parse(stripJsonc(text));
  } catch {
    return [];
  }
  if (Array.isArray(data)) {
    return data.filter((item): item is WindowsTerminalScheme =>
      Boolean(item && typeof item === "object"),
    );
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.schemes)) {
      return record.schemes.filter((item): item is WindowsTerminalScheme =>
        Boolean(item && typeof item === "object"),
      );
    }
    // A single scheme object (has at least one color field).
    if (record.background || record.foreground || record.black || record.blue) {
      return [record as WindowsTerminalScheme];
    }
  }
  return [];
}

export function windowsTerminalSchemeToTheme(
  scheme: WindowsTerminalScheme,
  existingIds: Set<string> = new Set(),
): Theme {
  const background = normalizeHex(scheme.background, ANSI_FALLBACK.background);
  const foreground = normalizeHex(scheme.foreground, ANSI_FALLBACK.foreground);
  const cursor = normalizeHex(scheme.cursorColor, foreground);
  const selection = normalizeHex(
    scheme.selectionBackground,
    mix(background, ANSI_FALLBACK.brightBlue, 0.35),
  );
  const ansi = {
    black: normalizeHex(scheme.black, ANSI_FALLBACK.black),
    red: normalizeHex(scheme.red, ANSI_FALLBACK.red),
    green: normalizeHex(scheme.green, ANSI_FALLBACK.green),
    yellow: normalizeHex(scheme.yellow, ANSI_FALLBACK.yellow),
    blue: normalizeHex(scheme.blue, ANSI_FALLBACK.blue),
    magenta: normalizeHex(scheme.magenta, ANSI_FALLBACK.magenta),
    cyan: normalizeHex(scheme.cyan, ANSI_FALLBACK.cyan),
    white: normalizeHex(scheme.white, ANSI_FALLBACK.white),
    brightBlack: normalizeHex(scheme.brightBlack, ANSI_FALLBACK.brightBlack),
    brightRed: normalizeHex(scheme.brightRed, ANSI_FALLBACK.brightRed),
    brightGreen: normalizeHex(scheme.brightGreen, ANSI_FALLBACK.brightGreen),
    brightYellow: normalizeHex(scheme.brightYellow, ANSI_FALLBACK.brightYellow),
    brightBlue: normalizeHex(scheme.brightBlue, ANSI_FALLBACK.brightBlue),
    brightMagenta: normalizeHex(
      scheme.brightMagenta,
      ANSI_FALLBACK.brightMagenta,
    ),
    brightCyan: normalizeHex(scheme.brightCyan, ANSI_FALLBACK.brightCyan),
    brightWhite: normalizeHex(scheme.brightWhite, ANSI_FALLBACK.brightWhite),
  };
  const name = (scheme.name ?? "").trim() || "Windows Terminal";
  const raw: Theme = {
    id: `wt-${schemeSlug(name)}`,
    name,
    label: name.slice(0, 14),
    swatch: background,
    colors: {
      bg: background,
      bgPanel: mix(background, foreground, 0.06),
      bgTerminal: background,
      bgHover: mix(background, foreground, 0.1),
      bgInput: background,
      bgSectionHeader: mix(background, foreground, 0.04),
      border: mix(background, foreground, 0.18),
      text: foreground,
      textMuted: mix(foreground, background, 0.35),
      textDimmed: mix(foreground, background, 0.55),
      primary: ansi.blue,
      primaryHover: ansi.brightBlue,
      onPrimary: background,
      focusRing: ansi.brightBlue,
      danger: ansi.red,
      dangerHover: ansi.brightRed,
      success: ansi.green,
      warning: ansi.yellow,
      link: ansi.brightBlue,
      shadow: "rgb(0 0 0 / 0.45)",
      scrollThumb: ansi.brightBlack,
      accent: ansi.brightBlue,
      terminal: {
        background,
        foreground,
        foregroundIntense: ansi.brightWhite,
        cursor,
        selectionBackground: selection,
        lineHighlight: mix(background, foreground, 0.05),
        findMatchBackground: rgba(ansi.yellow, 0.35),
        findMatchBorder: ansi.yellow,
        ...ansi,
      },
    },
  };
  // Ensure a unique, non-builtin id and trimmed label; `raw.id` is derived from
  // the scheme name so repeated imports of the same file stay stable.
  return normalizeImportedTheme(raw, existingIds);
}

/**
 * Parses a Windows Terminal settings file (JSONC) and maps every scheme to a
 * NyaTerm theme. Returns an empty array when the document is not a scheme file.
 */
export function parseWindowsTerminalThemes(
  text: string,
  existingIds: ReadonlySet<string> = new Set(),
): Theme[] {
  const schemes = parseWindowsTerminalSchemes(text);
  const ids = new Set(existingIds);
  const themes: Theme[] = [];
  for (const scheme of schemes) {
    const theme = windowsTerminalSchemeToTheme(scheme, ids);
    // Guard against duplicate generated ids within a single import.
    if (ids.has(theme.id)) {
      theme.id = generateCustomThemeId();
    }
    ids.add(theme.id);
    themes.push(theme);
  }
  return themes;
}
