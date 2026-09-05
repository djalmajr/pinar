#!/usr/bin/env bun
// Classifies git tags for the product and extension release channels.
//
//   v1.2.3              closed product → production Worker + desktop Latest
//   v1.2.3-rc.1         prerelease     → staging Worker only
//   v1.2.3-0            prerelease     → staging Worker only
//   ext-v1.2.3          extension      → Chrome zip, never Latest
import { appendFileSync } from "node:fs";

export const CLOSED_PRODUCT_TAG = /^v(\d+\.\d+\.\d+)$/;
export const PRERELEASE_PRODUCT_TAG = /^v(\d+\.\d+\.\d+)-([0-9A-Za-z.-]+)$/;
export const EXTENSION_TAG = /^ext-v(\d+\.\d+\.\d+)$/;

export function classifyReleaseTag(tag) {
  if (typeof tag !== "string" || !tag) {
    throw new Error("release tag is required");
  }
  const closed = tag.match(CLOSED_PRODUCT_TAG);
  if (closed) {
    return { channel: "production", kind: "closed", tag, version: closed[1] };
  }
  const prerelease = tag.match(PRERELEASE_PRODUCT_TAG);
  if (prerelease) {
    return {
      channel: "staging",
      kind: "prerelease",
      tag,
      version: `${prerelease[1]}-${prerelease[2]}`,
    };
  }
  const extension = tag.match(EXTENSION_TAG);
  if (extension) {
    return { channel: "extension", kind: "extension", tag, version: extension[1] };
  }
  throw new Error(`unrecognized release tag: ${tag}`);
}

export function isClosedProductTag(tag) {
  return CLOSED_PRODUCT_TAG.test(tag);
}

function writeGithubOutput(classified) {
  const lines = [
    `tag=${classified.tag}`,
    `kind=${classified.kind}`,
    `version=${classified.version}`,
    `channel=${classified.channel}`,
  ];
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
  console.log(lines.join("\n"));
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--github-output" && arg !== "--json");
  const classified = classifyReleaseTag(args[0]);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(classified));
  } else {
    writeGithubOutput(classified);
  }
}
