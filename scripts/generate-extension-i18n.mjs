import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { translations } from "../packages/shared/src/i18n/index.ts";
import { SUPPORTED_LANGUAGES } from "../packages/shared/src/types/index.ts";

const MV3_KEYS = [
  "batch_active",
  "batch_idle",
  "batch_label",
  "batch_finish",
  "batch_start",
  "capture_destination_label",
  "collection_label",
  "context_open_panel",
  "destination_unavailable",
  "name",
  "project_label",
];

const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "../extension/i18n.js");

export function renderExtensionI18n(catalog = translations) {
  const body = SUPPORTED_LANGUAGES.map((code) => {
    const source = catalog[code];
    if (!source) throw new Error(`Missing translations for '${code}'`);
    const fields = MV3_KEYS.map((key) => {
      const value = source[key];
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Missing MV3 string '${key}' for '${code}'`);
      }
      return `    ${key}: ${JSON.stringify(value)},`;
    }).join("\n");
    return `  ${code}: {\n${fields}\n  },`;
  }).join("\n");

  return `// Generated from packages/shared/src/i18n by scripts/generate-extension-i18n.mjs. Do not edit.

export const translations = {
${body}
};

function normalizeLanguage(value) {
  const language = value?.trim().toLowerCase().split("-")[0];
  return language in translations ? language : undefined;
}

export function getBestLanguage(preferred, _browserLanguages = []) {
  const preferredLanguage = normalizeLanguage(preferred);
  if (preferredLanguage) return preferredLanguage;
  return "en";
}
`;
}

function main() {
  const source = renderExtensionI18n();
  if (process.argv.includes("--stdout")) {
    process.stdout.write(source);
    return;
  }
  if (process.argv.includes("--check")) {
    const current = readFileSync(outputPath, "utf8");
    if (current !== source) {
      console.error("extension/i18n.js is out of date. Run: bun scripts/generate-extension-i18n.mjs");
      process.exit(1);
    }
    return;
  }
  writeFileSync(outputPath, source);
}

if (import.meta.main) main();
