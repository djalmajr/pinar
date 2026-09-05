import { describe, expect, test } from "bun:test";
import { githubReleaseNotes } from "./github-release-notes.mjs";

describe("githubReleaseNotes", () => {
  test("renders the English closed-tag notes", () => {
    const notes = githubReleaseNotes("v0.3.5");
    expect(notes).toContain("# Pinar v0.3.5");
    expect(notes).toContain("Account tab, Founder-only one-time plan, faster capture copy");
    expect(notes).toContain("## What changed");
    expect(notes).toContain("Account tab code strip");
  });

  test("refuses prerelease and extension tags", () => {
    expect(() => githubReleaseNotes("v1.0.0-rc.1")).toThrow("closed tags");
    expect(() => githubReleaseNotes("ext-v0.5.3")).toThrow("closed tags");
  });
});
