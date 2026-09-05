#!/usr/bin/env bun
// Cuts a release: one version everywhere, notes for closed tags, commit and tag.
//
//   bun run release patch|minor|major|<x.y.z>|<x.y.z-rc.1>
//
// Writes the new version to the root package.json and to every package that
// ships (cli, tray, server). Closed tags require notes in every language.
// Commits "chore: release vX.Y.Z" and tags. It does not push: pushing the tag
// deploys (closed → production Worker + desktop; prerelease → staging Worker).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RELEASE_LOCALES, SHIPPED_PACKAGES, releaseProblems } from "./release-check.mjs";
import { classifyReleaseTag } from "./release-tag.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const path = (rel) => new URL(rel, `file://${root}`);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function bump(current, kind) {
  if (/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(kind)) return kind;
  const [major, minor, patch] = current.split(".").map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`unknown bump "${kind}"; use patch, minor, major, x.y.z or x.y.z-rc.1`);
}

function setVersion(rel, version) {
  const file = path(rel);
  const text = readFileSync(file, "utf8");
  const next = text.replace(/("version":\s*)"[^"]+"/, `$1"${version}"`);
  if (next === text) throw new Error(`${rel}: no version field found`);
  writeFileSync(file, next);
}

const kind = process.argv[2];
if (!kind) {
  console.error("usage: bun run release patch|minor|major|<x.y.z>|<x.y.z-rc.1>");
  process.exit(2);
}
// The release commit is the bump plus the notes for the new tag, and nothing
// else: the notes cannot be committed earlier because the release tests demand
// a tag for every note, and the bump cannot land without notes.
const NOTES_PATHS = ["apps/server/src/lib/release-content.ts", "apps/server/src/lib/release-locales/"];
// Raw output: the helper trims, which would eat the leading status column.
const porcelain = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
const dirty = porcelain.split("\n").filter(Boolean).map((line) => line.slice(3).replace(/^.* -> /, ""));
const foreign = dirty.filter((file) => !NOTES_PATHS.some((allowed) => file.startsWith(allowed)));
if (foreign.length) {
  console.error("release: commit or stash these first; only the release notes may be pending:");
  for (const file of foreign) console.error(`  - ${file}`);
  process.exit(1);
}
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") console.warn(`release: you are on "${branch}", not main. Tagging here is allowed but the tag should land on main.`);

const current = JSON.parse(readFileSync(path("package.json"), "utf8")).version;
const version = bump(current, kind);
const tag = `v${version}`;
const classified = classifyReleaseTag(tag);

// Closed tags need notes in every language. Prerelease tags (rc/alpha/beta)
// skip that gate so staging can ship without a public history entry.
if (classified.kind === "closed") {
  const notes = readFileSync(path("apps/server/src/lib/release-content.ts"), "utf8");
  const missing = [];
  if (!notes.includes(`tag: "${tag}"`)) missing.push(`apps/server/src/lib/release-content.ts (releaseDefinitions entry for ${tag})`);
  for (const lang of RELEASE_LOCALES) {
    if (!readFileSync(path(`apps/server/src/lib/release-locales/${lang}.ts`), "utf8").includes(`"${tag}": {`)) missing.push(`apps/server/src/lib/release-locales/${lang}.ts`);
  }
  if (missing.length) {
    console.error(`release: write the notes for ${tag} before releasing. Missing in:`);
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }
}

for (const rel of ["package.json", ...SHIPPED_PACKAGES]) setVersion(rel, version);
const { problems } = releaseProblems({ requireTag: false });
if (problems.length) {
  console.error("release: aborting, versions did not converge:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
git("add", "package.json", ...SHIPPED_PACKAGES, ...NOTES_PATHS);
git("commit", "-q", "-m", `chore: release ${tag}`);
git("tag", "-a", tag, "-m", tag);
console.log(`release: ${current} -> ${version}, tagged ${tag} (${classified.kind})`);
if (classified.kind === "closed") {
  console.log("next: git push && git push --tags — CI deploys the production Worker and builds macOS/Windows, then marks GitHub Latest.");
} else {
  console.log("next: git push && git push --tags — CI deploys the staging Worker. No desktop build and no GitHub Latest.");
}
