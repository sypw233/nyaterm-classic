import { describe, expect, it } from "vitest";
import { formatSize } from "./utils";

describe("formatSize", () => {
  it("delegates to the shared IEC formatter", () => {
    // Three copies of this helper had drifted apart, and two of them labelled
    // 1024-based values as KB/MB. They now agree with byteSize.ts.
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1024)).toBe("1.0 KiB");
    expect(formatSize(1536)).toBe("1.5 KiB");
    expect(formatSize(1024 ** 2)).toBe("1.0 MiB");
    expect(formatSize(1024 ** 3)).toBe("1.0 GiB");
    expect(formatSize(10 * 1024)).toBe("10 KiB");
  });
});
