#!/usr/bin/env bun
// Cuts a release: one version everywhere, notes required, commit and tag.
//
//   bun run release patch|minor|major|<x.y.z>
//
// Writes the new version to the root package.json and to every package that
// ships (cli, tray, server), verifies release notes exist for the new tag in
// every language, commits "chore: release vX.Y.Z" and tags it. It does not
// push and does not deploy: those stay deliberate, per AGENTS.md.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RELEASE_LOCALES, SHIPPED_PACKAGES, releaseProblems } from "./release-check.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const path = (rel) => new URL(rel, `file://${root}`);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function bump(current, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [major, minor, patch] = current.split(".").map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`unknown bump "${kind}"; use patch, minor, major or x.y.z`);
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
  console.error("usage: bun run release patch|minor|major|<x.y.z>");
  process.exit(2);
}
if (git("status", "--porcelain")) {
  console.error("release: commit or stash your changes first; the release commit must contain only the version bump.");
  process.exit(1);
}
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") console.warn(`release: you are on "${branch}", not main. Tagging here is allowed but the tag should land on main.`);

const current = JSON.parse(readFileSync(path("package.json"), "utf8")).version;
const version = bump(current, kind);
const tag = `v${version}`;

// Notes first: a release without notes is not a release, and the check below
// reports exactly which language is missing.
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

for (const rel of ["package.json", ...SHIPPED_PACKAGES]) setVersion(rel, version);
const { problems } = releaseProblems({ requireTag: false });
if (problems.length) {
  console.error("release: aborting, versions did not converge:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
git("add", "package.json", ...SHIPPED_PACKAGES);
git("commit", "-q", "-m", `chore: release ${tag}`);
git("tag", "-a", tag, "-m", tag);
console.log(`release: ${current} -> ${version}, tagged ${tag}`);
console.log("next: git push && git push --tags, then CLOUDFLARE_ENV=staging bun run build:server / bunx wrangler deploy --env staging, smoke-test, then production.");
