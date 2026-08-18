import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../../..");
const FLOWS_DIR = join(ROOT, "e2e", "flows");
const MAPPING_PATH = join(ROOT, "e2e", "coverage", "automated-tests.json");
const SURFACES_PATH = join(ROOT, "e2e", "coverage", "product-surfaces.json");

function listMarkdown(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listMarkdown(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

function parseId(path: string) {
  return readFileSync(path, "utf8").match(/^id:\s*(\S+)\s*$/m)?.[1] || "";
}

describe("E2E flow catalog", () => {
  test("keeps 62 unique categorized flows with complete frontmatter", () => {
    const paths = listMarkdown(FLOWS_DIR);
    const ids = paths.map(parseId);

    assert.equal(paths.length, 62);
    assert.equal(new Set(ids).size, 62);
    for (const path of paths) {
      const body = readFileSync(path, "utf8");
      assert.match(body, /^name:\s*.+$/m, basename(path));
      assert.match(body, /^persona:\s*.+$/m, basename(path));
      assert.match(body, /^entry:\s*.+$/m, basename(path));
      assert.match(body, /^## User goal$/m, basename(path));
      assert.match(body, /^## Steps$/m, basename(path));
      assert.match(body, /^## Expected result$/m, basename(path));
    }
  });

  test("maps every flow exactly once to conservative automated coverage", () => {
    const ids = listMarkdown(FLOWS_DIR).map(parseId).sort();
    const mapping = JSON.parse(readFileSync(MAPPING_PATH, "utf8")) as {
      flows: Record<string, { status: string; tests: string[] }>;
    };

    assert.deepEqual(Object.keys(mapping.flows).sort(), ids);
    for (const [id, entry] of Object.entries(mapping.flows)) {
      assert.match(entry.status, /^(automated|partial|missing|env-gated|usability-only)$/, id);
      for (const testPath of entry.tests) assert.equal(existsSync(join(ROOT, testPath)), true, `${id}: ${testPath}`);
    }
  });

  test("links every declared product surface to existing source and flows", () => {
    const ids = new Set(listMarkdown(FLOWS_DIR).map(parseId));
    const catalog = JSON.parse(readFileSync(SURFACES_PATH, "utf8")) as {
      surfaces: Array<{ flows: string[]; id: string; source: string }>;
    };
    const surfaceIds = new Set<string>();

    for (const surface of catalog.surfaces) {
      assert.equal(surfaceIds.has(surface.id), false, surface.id);
      surfaceIds.add(surface.id);
      assert.equal(existsSync(join(ROOT, surface.source)), true, surface.source);
      assert.ok(surface.flows.length > 0, surface.id);
      for (const id of surface.flows) assert.equal(ids.has(id), true, `${surface.id}: ${id}`);
    }
  });
});
