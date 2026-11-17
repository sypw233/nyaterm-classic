import { describe, expect, it } from "vitest";
import { formatByteRate, formatBytes, formatBytesCompact } from "./byteSize";

describe("formatBytes", () => {
  it("uses IEC labels for 1024-based tiers", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KiB");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(1024 ** 2)).toBe("1.0 MiB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GiB");
  });

  it("drops decimals at or above ten units", () => {
    expect(formatBytes(10 * 1024)).toBe("10 KiB");
    expect(formatBytes(99 * 1024 ** 2)).toBe("99 MiB");
  });

  it("renders missing values as not applicable", () => {
    expect(formatBytes(null)).toBe("-");
    expect(formatBytes(undefined)).toBe("-");
    expect(formatBytes(Number.NaN)).toBe("-");
    expect(formatBytes(null, "n/a")).toBe("n/a");
  });

  it("treats negative input as zero rather than producing NaN", () => {
    expect(formatBytes(-1)).toBe("0 B");
  });
});

describe("formatByteRate", () => {
  it("appends a per-second suffix", () => {
    expect(formatByteRate(0)).toBe("0 B/s");
    expect(formatByteRate(1536)).toBe("1.5 KiB/s");
    expect(formatByteRate(5 * 1024 ** 2)).toBe("5.0 MiB/s");
  });
});

describe("formatBytesCompact", () => {
  it("always shows one decimal once scaled", () => {
    expect(formatBytesCompact(1024)).toBe("1.0 KiB");
    expect(formatBytesCompact(1024 ** 3)).toBe("1.0 GiB");
    expect(formatBytesCompact(1023)).toBe("1023 B");
  });
});
