#!/usr/bin/env node
/* global process, console */
/**
 * Stop @xterm/addon-image from repainting stale image tiles for NyaTerm.
 *
 * The image addon paints image tiles from a sparse per-cell `_extendedAttrs`
 * map. The xterm core clears the `HAS_EXTENDED` background flag on text writes,
 * ED/EL erases and SGR resets, but leaves the old `imageId`/`tileId` entry in
 * that sparse map. addon-image@0.10.0-beta.288 deliberately repaints tiles from
 * those stale entries ("lets top-layer images survive text overwrites"), so a
 * tile that should be erased keeps being drawn onto a separate canvas layer.
 * In a TUI that redraws with partial erases (yazi, opencode) this leaves a
 * semi-transparent image ghost that text can cover but that never goes away.
 *
 * Fix: in ImageStorage.render, skip cells whose HAS_EXTENDED background flag is
 * cleared instead of falling back to the stale `_extendedAttrs` entry. Full
 * wrapped Kitty placements/transmissions are unaffected because they always
 * carry the flag while they are live.
 *
 * Intended for @xterm/addon-image@0.10.0-beta.288. Idempotent and fails fast
 * when the installed version or minified bundles no longer match, so a
 * dependency upgrade cannot silently reintroduce the ghost-image bug.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PACKAGE_NAME = "@xterm/addon-image";
const EXPECTED_VERSION = "0.10.0-beta.288";
const MARKER = "/*nyaterm:image-stale-tile*/";

const PACKAGE_DIR = path.resolve(
  process.cwd(),
  "node_modules",
  "@xterm",
  "addon-image",
);
const PACKAGE_JSON = path.join(PACKAGE_DIR, "package.json");

const TARGETS = [
  {
    file: path.join(PACKAGE_DIR, "lib", "addon-image.mjs"),
    // ESM: render() fallback that repaints a tile from stale _extendedAttrs.
    from:
      "if(g.getBg(I)&268435456)_=g._extendedAttrs[I]??X;else{let u=g._extendedAttrs[I];if(!u||u.imageId===void 0||u.imageId===-1)continue;_=u}",
    to:
      "if(g.getBg(I)&268435456)_=g._extendedAttrs[I]??X;else continue;" + MARKER,
  },
  {
    file: path.join(PACKAGE_DIR, "lib", "addon-image.js"),
    // CJS: same fallback with the minifier's expanded nullish checks.
    from:
      'if(268435456&A.getBg(i))s=null!==(t=A._extendedAttrs[i])&&void 0!==t?t:r;else{const e=A._extendedAttrs[i];if(!e||void 0===e.imageId||-1===e.imageId)continue;s=e}',
    to:
      "if(268435456&A.getBg(i))s=null!==(t=A._extendedAttrs[i])&&void 0!==t?t:r;else continue;" + MARKER,
  },
];

function fail(message) {
  throw new Error(`[patch-xterm-image-stale-tile] ${message}`);
}

function writeFileAtomically(filename, content) {
  const temporary = `${filename}.nyaterm-patch-${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, filename);
}

if (!fs.existsSync(PACKAGE_JSON)) {
  fail(`${PACKAGE_NAME} is not installed: ${PACKAGE_JSON}`);
}

let packageJson;
try {
  packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
} catch (error) {
  fail(
    `cannot read ${PACKAGE_JSON}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

if (packageJson.version !== EXPECTED_VERSION) {
  fail(
    `unsupported ${PACKAGE_NAME} version ${JSON.stringify(packageJson.version)}; ` +
      `expected ${EXPECTED_VERSION}. Review and refresh this patch before upgrading.`,
  );
}

let patched = 0;
let already = 0;

for (const { file, from, to } of TARGETS) {
  const relative = path.relative(process.cwd(), file);

  if (!fs.existsSync(file)) {
    fail(`runtime bundle not found: ${relative}`);
  }

  let source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    fail(
      `cannot read ${relative}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (source.includes(MARKER)) {
    already += 1;
    continue;
  }

  const occurrences = source.split(from).length - 1;
  if (occurrences !== 1) {
    fail(
      `expected exactly one stale-tile fallback in ${relative}, found ${occurrences}. ` +
        "The minified addon bundle may have changed.",
    );
  }

  const patchedSource = source.replace(from, to);
  if (!patchedSource.includes(MARKER)) {
    fail(`patch verification failed for ${relative}`);
  }

  try {
    writeFileAtomically(file, patchedSource);
  } catch (error) {
    fail(
      `cannot write ${relative}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  patched += 1;
}

console.log(
  `[patch-xterm-image-stale-tile] stale tile repaint: ` +
    `patched=${patched} already=${already} total=${TARGETS.length}`,
);
