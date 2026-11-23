import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function keys(value, prefix = "") {
  return Object.entries(value)
    .flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof child === "object" && child !== null
        ? keys(child, path)
        : [path];
    })
    .map((key) => key.replace(/_(zero|one|two|few|many|other|plural)$/, ""))
    .filter((key, index, all) => all.indexOf(key) === index)
    .sort();
}
const locales = ["en", "zh-CN", "zh-TW", "ko", "ru"];
const en = JSON.parse(readFileSync(`src/i18n/locales/en.json`, "utf8"));
const reference = keys(en);
for (const locale of locales.slice(1)) {
  const current = keys(
    JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, "utf8")),
  );
  const missing = reference.filter((key) => !current.includes(key));
  const extra = current.filter((key) => !reference.includes(key));
  if (missing.length || extra.length)
    throw new Error(
      `${locale}: missing ${missing.join(", ")}; extra ${extra.join(", ")}`,
    );
}

// Cross-check literal t("...") calls in the frontend against the reference
// locale. This catches the class of bug where a component looks up a key in
// the wrong namespace (or one that was never added): i18next silently falls
// back to the English default or renders the raw key, so the locale-consistency
// check above cannot see it. Dynamic keys are skipped; they are resolved at
// runtime and usually have their own tests covering the possible values.
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
      ? [full]
      : [];
  });
}

const referenceSet = new Set(reference);
const callPattern = /\bt\(\s*(["'])([^"']+)\1/g;
const missingCalls = [];
for (const file of sourceFiles("src")) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(callPattern)) {
    const key = match[2];
    // Skip interpolated keys resolved at runtime (e.g. `panel.${id}`).
    if (key.includes("$") || key.includes("{")) continue;
    if (referenceSet.has(key)) continue;
    const line = source.slice(0, match.index).split("\n").length;
    missingCalls.push(`${file}:${line} ${key}`);
  }
}
if (missingCalls.length)
  throw new Error(
    `Literal t() keys missing from en.json:\n  ${missingCalls.join("\n  ")}`,
  );

console.log(
  `All ${locales.length} locales have the same ${reference.length} translation keys, and every literal t() key resolves.`,
);
