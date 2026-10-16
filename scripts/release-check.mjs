#!/usr/bin/env bun
// Refuses to build or install a production artifact from a commit that is not
// a release.
//
// A release is: the root version is a valid semver (closed 1.2.3, prerelease
// 1.2.3-rc.1 or with build metadata 1.2.3+build.5), HEAD carries the tag
// v<root version>, the tree is clean, and every workspace package.json that
// ships (cli, tray, server) carries the same version. A closed version also
// needs release notes for its tag in every language; a prerelease does not.
// Anything else is unreleased work and must not reach production. Staging and
// local builds pass through untouched - they are where unreleased work belongs.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isClosedProductTag } from "./release-tag.mjs";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));

export const SHIPPED_PACKAGES = ["apps/cli/package.json", "apps/tray/package.json", "apps/server/package.json"];
export const RELEASE_LOCALES = ["en", "pt", "es", "fr", "de", "zh", "ja"];
/** Semantic Versioning 2.0.0, prerelease and build metadata included. */
export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function releaseProblems({ requireTag = true, root = defaultRoot } = {}) {
  const read = (rel) => readFileSync(join(root, rel), "utf8");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const problems = [];
  const version = JSON.parse(read("package.json")).version;
  const tag = `v${version}`;

  if (typeof version !== "string" || !SEMVER.test(version)) {
    problems.push(`root version ${version} is not a valid semver`);
  }

  for (const rel of SHIPPED_PACKAGES) {
    const shipped = JSON.parse(read(rel)).version;
    if (shipped !== version) problems.push(`${rel} is ${shipped}; root is ${version}. Run: bun run release <patch|minor|major>`);
  }

  if (isClosedProductTag(tag)) {
    const definitions = read("apps/server/src/lib/release-content.ts");
    if (!definitions.includes(`tag: "${tag}"`)) problems.push(`release-content.ts has no entry for ${tag}`);
    for (const lang of RELEASE_LOCALES) {
      if (!read(`apps/server/src/lib/release-locales/${lang}.ts`).includes(`"${tag}": {`)) problems.push(`release-locales/${lang}.ts has no notes for ${tag}`);
    }
  }

  if (requireTag) {
    // Every tag on HEAD, not `git describe`: that one names a single tag, and
    // a commit may carry more than one (an rc and its closed release).
    let tags = [];
    try { tags = git("tag", "--points-at", "HEAD").split("\n").filter(Boolean); } catch { /* no tags */ }
    if (!tags.includes(tag)) problems.push(`HEAD is not on ${tag} (${tags.join(", ") || "no tag"}). Production builds come from the release tag only.`);
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
