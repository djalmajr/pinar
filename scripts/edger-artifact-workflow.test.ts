import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const root = join(import.meta.dir, "..");

describe("EdgeR artifact workflow", () => {
  const workflow = readFileSync(join(root, ".github/workflows/edger-artifact.yml"), "utf8");

  test("runs on product tags and never listens for extension tags", () => {
    expect(workflow).toContain('tags:\n      - "v*"');
    expect(workflow).not.toContain("ext-v*\"");
  });

  test("builds the artifact before running it under Deno", () => {
    const build = "run: bun run build:edger";
    const smoke = "run: bun run smoke:edger";
    expect(workflow).toContain(build);
    expect(workflow).toContain(smoke);
    expect(workflow.indexOf(build)).toBeLessThan(workflow.indexOf(smoke));
  });

  test("installs nothing and reads no secret", () => {
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("edger:install");
    expect(workflow).not.toContain("/api/admin");
    expect(workflow).toContain("permissions:\n  contents: read");
  });

  test("keeps the zip only for product tags", () => {
    expect(workflow).toContain("if: startsWith(github.ref, 'refs/tags/v')");
    expect(workflow).toContain("path: apps/server/dist/pinar-edger.zip");
  });

  test("pins every action to a commit", () => {
    const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/);
  });
});
