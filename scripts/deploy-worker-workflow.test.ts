import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const root = join(import.meta.dir, "..");

describe("Worker deploy workflow", () => {
  const workflow = readFileSync(join(root, ".github/workflows/deploy-worker.yml"), "utf8");

  test("classifies product tags and never listens for extension tags", () => {
    expect(workflow).toContain('tags:\n      - "v*"');
    expect(workflow).toContain("bun scripts/release-tag.mjs --github-output");
    expect(workflow).toContain("ref: ${{ github.sha }}");
    expect(workflow).not.toContain("extension-v");
  });

  test("deploys production only on closed tags", () => {
    const migration = "bunx wrangler d1 migrations apply pinar-prd --env production --remote";
    const deploy = "bunx wrangler deploy --env production";
    expect(workflow).toContain("needs.classify.outputs.kind == 'closed'");
    expect(workflow).toContain("CLOUDFLARE_ENV: production");
    expect(workflow).toContain("bun scripts/assert-worker-artifact.mjs production");
    expect(workflow).toContain(migration);
    expect(workflow).toContain(deploy);
    expect(workflow.indexOf(migration)).toBeLessThan(workflow.indexOf(deploy));
    expect(workflow).toContain("https://pinar.dev/api/health");
  });

  test("deploys staging only on prerelease tags", () => {
    const migration = "bunx wrangler d1 migrations apply pinar-stg --env staging --remote";
    const deploy = "bunx wrangler deploy --env staging";
    expect(workflow).toContain("needs.classify.outputs.kind == 'prerelease'");
    expect(workflow).toContain("CLOUDFLARE_ENV: staging");
    expect(workflow).toContain("bun scripts/assert-worker-artifact.mjs staging");
    expect(workflow).toContain(migration);
    expect(workflow).toContain(deploy);
    expect(workflow.indexOf(migration)).toBeLessThan(workflow.indexOf(deploy));
  });
});
