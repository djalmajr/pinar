#!/usr/bin/env bun
import { classifyReleaseTag } from "./release-tag.mjs";
import english from "../apps/server/src/lib/release-locales/en.ts";

export function githubReleaseNotes(tag) {
  const classified = classifyReleaseTag(tag);
  if (classified.kind !== "closed") {
    throw new Error(`GitHub product notes are only for closed tags; received ${tag}`);
  }
  const entry = english.releases[tag];
  if (!entry) throw new Error(`no English notes for ${tag}`);
  const lines = [`# Pinar ${tag}`, "", entry.title, "", entry.summary, ""];
  const changeIds = Object.keys(entry.changes);
  if (changeIds.length) {
    lines.push("## What changed", "");
    for (const id of changeIds) {
      const change = entry.changes[id];
      lines.push(`- **${change.title}.** ${change.description}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

if (import.meta.main) {
  process.stdout.write(githubReleaseNotes(process.argv[2]));
}
