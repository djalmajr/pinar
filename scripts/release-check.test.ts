import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { RELEASE_LOCALES, SEMVER, SHIPPED_PACKAGES, releaseProblems } from "./release-check.mjs";

const fixtures: string[] = [];

function write(root: string, rel: string, text: string) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function git(root: string, ...args: string[]) {
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: root, stdio: "ignore" });
}

/** A repository at `version`, committed; `notes` lists the tags the release notes know. */
function fixture(version: string, { notes = [] as string[], tags = [] as string[] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pinar-release-check-"));
  fixtures.push(root);
  for (const rel of ["package.json", ...SHIPPED_PACKAGES]) write(root, rel, JSON.stringify({ version }));
  write(root, "apps/server/src/lib/release-content.ts", notes.map((tag) => `{ tag: "${tag}" }`).join("\n"));
  for (const lang of RELEASE_LOCALES) {
    write(root, `apps/server/src/lib/release-locales/${lang}.ts`, notes.map((tag) => `"${tag}": {}`).join("\n"));
  }
  git(root, "init", "-q");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "release");
  for (const tag of tags) git(root, "tag", tag);
  return root;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("release check for production", () => {
  test("accepts a closed version on its tag with notes", () => {
    const root = fixture("1.2.3", { notes: ["v1.2.3"], tags: ["v1.2.3"] });
    expect(releaseProblems({ root }).problems).toEqual([]);
  });

  test("accepts a prerelease on its tag without notes", () => {
    const root = fixture("1.2.3-rc.1", { tags: ["v1.2.3-rc.1"] });
    expect(releaseProblems({ root })).toEqual({ problems: [], tag: "v1.2.3-rc.1", version: "1.2.3-rc.1" });
  });

  test("accepts build metadata on its tag", () => {
    const root = fixture("1.2.3-rc.1+build.5", { tags: ["v1.2.3-rc.1+build.5"] });
    expect(releaseProblems({ root }).problems).toEqual([]);
  });

  test("finds the tag when HEAD carries more than one", () => {
    const root = fixture("1.2.3", { notes: ["v1.2.3"], tags: ["v1.2.3-rc.2", "v1.2.3"] });
    expect(releaseProblems({ root }).problems).toEqual([]);
  });

  test("still needs notes for a closed version", () => {
    const root = fixture("1.2.3", { tags: ["v1.2.3"] });
    expect(releaseProblems({ root }).problems).toContain("release-content.ts has no entry for v1.2.3");
  });

  test("refuses HEAD without the tag", () => {
    const root = fixture("1.2.3-rc.1", { tags: ["v1.2.3-rc.0"] });
    expect(releaseProblems({ root }).problems).toEqual([
      "HEAD is not on v1.2.3-rc.1 (v1.2.3-rc.0). Production builds come from the release tag only.",
    ]);
  });

  test("refuses a dirty tree", () => {
    const root = fixture("1.2.3-rc.1", { tags: ["v1.2.3-rc.1"] });
    write(root, "extra.txt", "x");
    expect(releaseProblems({ root }).problems).toEqual(["working tree is not clean"]);
  });

  test("refuses a version that is not semver", () => {
    const root = fixture("1.2", { tags: ["v1.2"] });
    expect(releaseProblems({ root }).problems).toContain("root version 1.2 is not a valid semver");
  });

  test("refuses packages out of sync", () => {
    const root = fixture("1.2.3-rc.1", { tags: [] });
    write(root, "apps/tray/package.json", JSON.stringify({ version: "1.2.2" }));
    git(root, "commit", "-q", "-am", "drift");
    git(root, "tag", "v1.2.3-rc.1");
    expect(releaseProblems({ root }).problems).toEqual([
      "apps/tray/package.json is 1.2.2; root is 1.2.3-rc.1. Run: bun run release <patch|minor|major>",
    ]);
  });

  test("outside production only the versions matter", () => {
    const root = fixture("1.2.3-rc.1");
    expect(releaseProblems({ requireTag: false, root }).problems).toEqual([]);
  });
});

describe("SEMVER", () => {
  test("matches Semantic Versioning 2.0.0", () => {
    for (const ok of ["0.7.2", "1.0.0-rc.1", "1.0.0-0", "1.0.0-alpha.beta", "1.0.0+20261015", "1.0.0-rc.1+build.5"]) {
      expect(SEMVER.test(ok)).toBe(true);
    }
    for (const bad of ["1.2", "01.2.3", "1.2.3-", "1.2.3+", "v1.2.3", "1.2.3-rc..1"]) {
      expect(SEMVER.test(bad)).toBe(false);
    }
  });
});
