import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  collectExtensionEntries,
  extensionVersions,
  parseOptions,
  validateEntryPaths,
  validateManifestFiles,
  validateReleaseTag,
} from "./package-extension.mjs";

const root = join(import.meta.dir, "..");

describe("extension package", () => {
  test("collects only Store runtime files", () => {
    const entries = collectExtensionEntries(root);
    expect(entries).toContain("manifest.json");
    expect(entries).toContain("batch.js");
    expect(entries).toContain("clipboard.js");
    expect(entries).toContain("dist/options.html");
    expect(entries.some((entry) => entry.endsWith(".test.js"))).toBe(false);
    expect(entries.some((entry) => entry.endsWith(".d.ts"))).toBe(false);
    expect(entries.some((entry) => entry.endsWith(".zip"))).toBe(false);
  });

  test("requires manifest and package versions to match", () => {
    const fixture = mkdtempSync(join(tmpdir(), "pinar-extension-version-"));
    mkdirSync(join(fixture, "extension"), { recursive: true });
    mkdirSync(join(fixture, "apps/extension"), { recursive: true });
    writeFileSync(join(fixture, "extension/manifest.json"), JSON.stringify({ version: "0.5.0" }));
    writeFileSync(join(fixture, "apps/extension/package.json"), JSON.stringify({ version: "0.4.0" }));
    expect(() => extensionVersions(fixture)).toThrow("extension version mismatch");
  });

  test("rejects files that caused the malformed 0.5.0 asset", () => {
    expect(() => validateEntryPaths(["manifest.json", "format.d.ts"])).toThrow("TypeScript declaration is forbidden");
    expect(() => validateEntryPaths(["manifest.json", "pinar-0.4.0.zip"])).toThrow("nested archive is forbidden");
    expect(() => validateEntryPaths(["pinar-extension-0.5.0/manifest.json"])).toThrow("manifest.json must be at the archive root");
  });

  test("requires every manifest runtime reference", () => {
    const { manifest } = extensionVersions(root);
    const entries = collectExtensionEntries(root).filter((entry) => entry !== manifest.background.service_worker);
    expect(() => validateManifestFiles({ entries, manifest, rootDirectory: root })).toThrow(manifest.background.service_worker);
  });

  test("keeps extension tags independent from product tags", () => {
    expect(() => validateReleaseTag("extension-v0.5.0", "0.5.0")).not.toThrow();
    expect(() => validateReleaseTag("v0.5.0", "0.5.0")).toThrow("extension-v0.5.0");
  });

  test("requires values for every packaging option", () => {
    expect(() => parseOptions(["--output"])).toThrow("--output requires a value");
    expect(() => parseOptions(["--output", "--expected-version", "0.5.0"])).toThrow("--output requires a value");
  });

  test("workflow never replaces the product Latest release", () => {
    const workflow = readFileSync(join(root, ".github/workflows/release-extension.yml"), "utf8");
    expect(workflow).toContain('tags: ["extension-v*"]');
    expect(workflow).toContain("permissions:\n  contents: write");
    expect(workflow).toContain("--latest=false");
    expect(workflow).toContain("bun run package:ext");
  });
});
