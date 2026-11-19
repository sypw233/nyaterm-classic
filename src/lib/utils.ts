import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatBytes } from "./byteSize";
import { logger } from "./logger";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Byte-size for display. Delegates to the shared IEC formatter: the value is
 * always 1024-based, so labelling it `KB`/`MB` would understate the real size,
 * and three copies of this helper had drifted apart.
 */
export function formatSize(bytes: number): string {
  return formatBytes(bytes);
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function ensureGlobalRegex(regex: RegExp): RegExp {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  return new RegExp(regex.source, flags);
}

export function parseJsonSearchParam<T>(value: string | null): T | null {
  if (!value) return null;

  try {
    // URLSearchParams.get() already returns a decoded value.
    return JSON.parse(value) as T;
  } catch (error) {
    logger.error({
      domain: "ui.error",
      event: "url_param.parse_failed",
      message: "Failed to parse JSON search param",
      error,
    });
    return null;
  }
}

export function isValidIPv4(text: string): boolean {
  const parts = text.split(".");
  if (parts.length !== 4) return false;

  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

export function isValidDomain(text: string): boolean {
  if (!text || text.length > 253) return false;

  const parts = text.split(".");
  if (parts.length < 2) return false;

  return parts.every((part) => {
    return /^[a-zA-Z0-9-]{1,63}$/.test(part) && !part.startsWith("-") && !part.endsWith("-");
  });
}

export function isValidArchiveName(text: string): boolean {
  return /\.(zip|rar|7z|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz)$/i.test(text);
}

export function isValidHostPort(text: string): boolean {
  const m = text.match(/^(.+):(\d{1,5})$/);
  if (!m) return false;

  const host = m[1];
  const port = Number(m[2]);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return false;
  }

  return host === "localhost" || isValidIPv4(host) || isValidDomain(host);
}
