import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const root = join(import.meta.dir, "..");

describe("Worker deploy workflow", () => {
  const workflow = readFileSync(join(root, ".github/workflows/deploy-worker.yml"), "utf8");

  test("classifies product tags and never listens for extension tags", () => {
    expect(workflow).toContain('tags:\n      - "v*"');
    expect(workflow).toContain("bun scripts/release-tag.mjs --github-output");
    expect(workflow).not.toContain("extension-v");
  });

  test("deploys production only on closed tags", () => {
    expect(workflow).toContain("needs.classify.outputs.kind == 'closed'");
    expect(workflow).toContain("CLOUDFLARE_ENV: production");
    expect(workflow).toContain("bun scripts/assert-worker-artifact.mjs production");
    expect(workflow).toContain("bunx wrangler deploy --env production");
    expect(workflow).toContain("https://pinar.dev/api/health");
  });

  test("deploys staging only on prerelease tags", () => {
    expect(workflow).toContain("needs.classify.outputs.kind == 'prerelease'");
    expect(workflow).toContain("CLOUDFLARE_ENV: staging");
    expect(workflow).toContain("bun scripts/assert-worker-artifact.mjs staging");
    expect(workflow).toContain("bunx wrangler deploy --env staging");
    expect(workflow).not.toContain("d1 migrations apply");
  });
});
