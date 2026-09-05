#!/usr/bin/env bun
// Refuses to build a production artifact from a commit that is not a release.
//
// A release is: HEAD sits exactly on tag v<root version>, the tree is clean,
// every workspace package.json that ships (cli, tray, server) carries the same
// version, and the release notes know that tag in every language. Anything
// else is unreleased work and must not reach production. Staging and local
// builds pass through untouched - they are where unreleased work belongs.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyReleaseTag } from "./release-tag.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(new URL(rel, `file://${root}`), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

export const SHIPPED_PACKAGES = ["apps/cli/package.json", "apps/tray/package.json", "apps/server/package.json"];
export const RELEASE_LOCALES = ["en", "pt", "es", "fr", "de", "zh", "ja"];

export function releaseProblems({ requireTag = true } = {}) {
  const problems = [];
  const version = JSON.parse(read("package.json")).version;
  const tag = `v${version}`;
  const classified = classifyReleaseTag(tag);

  for (const rel of SHIPPED_PACKAGES) {
    const shipped = JSON.parse(read(rel)).version;
    if (shipped !== version) problems.push(`${rel} is ${shipped}; root is ${version}. Run: bun run release <patch|minor|major>`);
  }

  if (classified.kind === "closed") {
    const definitions = read("apps/server/src/lib/release-content.ts");
    if (!definitions.includes(`tag: "${tag}"`)) problems.push(`release-content.ts has no entry for ${tag}`);
    for (const lang of RELEASE_LOCALES) {
      if (!read(`apps/server/src/lib/release-locales/${lang}.ts`).includes(`"${tag}": {`)) problems.push(`release-locales/${lang}.ts has no notes for ${tag}`);
    }
  }

  if (requireTag) {
    if (classified.kind !== "closed") {
      problems.push(`${tag} is ${classified.kind}; production builds require a closed vX.Y.Z tag.`);
    }
    let at = "";
    try { at = git("describe", "--tags", "--exact-match", "HEAD"); } catch { /* not on a tag */ }
    if (at !== tag) problems.push(`HEAD is not on ${tag} (${at || "no tag"}). Production builds come from the release tag only.`);
    if (git("status", "--porcelain")) problems.push("working tree is not clean");
  }
  return { problems, tag, version };
}

if (import.meta.main) {
  const production = process.env.CLOUDFLARE_ENV === "production" || process.argv.includes("--production");
  const { problems, tag } = releaseProblems({ requireTag: production });
  if (problems.length === 0) {
    console.log(`release-check: ${tag} ok${production ? "" : " (versions in sync; tag not required outside production)"}`);
    process.exit(0);
  }
  console.error(`release-check: refusing ${production ? "a production build" : "to continue"}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
