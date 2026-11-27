import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageDir = path.resolve(
  process.cwd(),
  "node_modules",
  "@xterm",
  "addon-image",
  "lib",
);

const MARKER = "/*nyaterm:image-stale-tile*/";

const cases = [
  {
    name: "ESM",
    file: "addon-image.mjs",
    marker:
      "if(g.getBg(I)&268435456)_=g._extendedAttrs[I]??X;else continue;",
  },
  {
    name: "CJS",
    file: "addon-image.js",
    marker:
      "if(268435456&A.getBg(i))s=null!==(t=A._extendedAttrs[i])&&void 0!==t?t:r;else continue;",
  },
] as const;

describe("xterm image stale-tile patch", () => {
  it.each(cases)(
    "$name skips image tiles whose HAS_EXTENDED flag was cleared",
    ({ file, marker }) => {
      const source = fs.readFileSync(path.join(packageDir, file), "utf8");

      expect(source).toContain(MARKER);
      expect(source).toContain(marker);
      // The original stale-tile fallback must be gone from the render loop.
      expect(source).not.toContain("else{const e=A._extendedAttrs[i]");
      expect(source).not.toContain("else{let u=g._extendedAttrs[I]");
    },
  );
});
