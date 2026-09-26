import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  collectExtensionEntries,
  extensionVersions,
  packageExtension,
  parseOptions,
  releaseManifest,
  validateEntryPaths,
  validateManifestFiles,
  validateReleaseTag,
} from "./package-extension.mjs";

const root = join(import.meta.dir, "..");

function chromeExtensionId(publicKey: string) {
  const digest = createHash("sha256").update(Buffer.from(publicKey, "base64")).digest();
  return [...digest.subarray(0, 16)]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join("");
}

function createPackagingFixture(rootDirectory: string, version: string, key?: string) {
  const extension = join(rootDirectory, "extension");
  mkdirSync(join(extension, "_locales"), { recursive: true });
  mkdirSync(join(extension, "dist"), { recursive: true });
  mkdirSync(join(extension, "icons"), { recursive: true });
  mkdirSync(join(rootDirectory, "apps/extension"), { recursive: true });
  writeFileSync(join(extension, "manifest.json"), JSON.stringify({
    background: { service_worker: "background.js" },
    ...(key === undefined ? {} : { key }),
    manifest_version: 3,
    options_ui: { page: "dist/options.html" },
    version,
  }));
  writeFileSync(join(extension, "background.js"), "// fixture service worker\n");
  writeFileSync(join(extension, "background.test.js"), "// excluded test fixture\n");
  writeFileSync(join(extension, "offscreen.html"), "<!doctype html><html></html>\n");
  writeFileSync(join(extension, "dist/options.html"), "<!doctype html><html></html>\n");
  writeFileSync(join(rootDirectory, "apps/extension/package.json"), JSON.stringify({ version }));
  return rootDirectory;
}

describe("extension package", () => {
  test("collects the shared validated runtime file set", () => {
    const fixture = createPackagingFixture(mkdtempSync(join(tmpdir(), "pinar-extension-entries-")), "0.6.5");
    try {
      const entries = collectExtensionEntries(fixture);
      expect(entries).toContain("manifest.json");
      expect(entries).toContain("background.js");
      expect(entries).toContain("dist/options.html");
      expect(entries.some((entry) => entry.endsWith(".test.js"))).toBe(false);
      expect(entries.some((entry) => entry.endsWith(".d.ts"))).toBe(false);
      expect(entries.some((entry) => entry.endsWith(".zip"))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("requires manifest and package versions to match", () => {
    const fixture = mkdtempSync(join(tmpdir(), "pinar-extension-version-"));
    mkdirSync(join(fixture, "extension"), { recursive: true });
    mkdirSync(join(fixture, "apps/extension"), { recursive: true });
    writeFileSync(join(fixture, "extension/manifest.json"), JSON.stringify({ version: "0.5.0" }));
    writeFileSync(join(fixture, "apps/extension/package.json"), JSON.stringify({ version: "0.4.0" }));
    expect(() => extensionVersions(fixture)).toThrow("extension version mismatch");
  });

  test("strips the key for Store and preserves the stable key for unpacked manifests", () => {
    const { manifest } = extensionVersions(root);
    expect(typeof manifest.key === "string" && manifest.key.length > 0).toBe(true);
    expect(releaseManifest(manifest).key).toBeUndefined();
    const unpacked = releaseManifest(manifest, { unpacked: true });
    expect(unpacked.key === manifest.key).toBe(true);
    expect(chromeExtensionId(unpacked.key)).toBe("idpeaokdndjedekacfdfbilcolpholbo");
    expect(unpacked.version).toBe(manifest.version);
  });

  test("rejects missing, empty, malformed, and mismatched keys for unpacked packages", () => {
    const invalidKeys = [
      { key: undefined, message: "unpacked packaging requires a non-empty valid manifest.key" },
      { key: "", message: "unpacked packaging requires a non-empty valid manifest.key" },
      { key: "not base64!", message: "unpacked packaging requires a non-empty valid manifest.key" },
      { key: "aGVsbG8=", message: "unpacked manifest.key does not match the expected extension ID" },
    ];
    for (const { key, message } of invalidKeys) {
      const fixture = mkdtempSync(join(tmpdir(), "pinar-extension-invalid-key-"));
      try {
        createPackagingFixture(fixture, "0.6.5", key);
        const archive = join(fixture, "extension/pinar-extension-0.6.5-unpacked.zip");
        expect(() => packageExtension({ rootDirectory: fixture, runBuild: false, unpacked: true }))
          .toThrow(message);
        expect(existsSync(archive)).toBe(false);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  test("creates reproducible Store and unpacked archives with identical runtime entries", () => {
    const directory = mkdtempSync(join(tmpdir(), "pinar-extension-artifacts-"));
    try {
      const fixture = join(directory, "repo");
      const { manifest: sourceManifest, version } = extensionVersions(root);
      createPackagingFixture(fixture, version, sourceManifest.key);
      const { manifest } = extensionVersions(fixture);
      const store = packageExtension({ expectedVersion: version, rootDirectory: fixture, runBuild: false });
      const unpacked = packageExtension({ expectedVersion: version, rootDirectory: fixture, runBuild: false, unpacked: true });
      const storeAgain = packageExtension({ expectedVersion: version, rootDirectory: fixture, runBuild: false });
      const unpackedAgain = packageExtension({ expectedVersion: version, rootDirectory: fixture, runBuild: false, unpacked: true });
      const entries = (archive: string) => execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
      const archivedManifest = (archive: string) => JSON.parse(execFileSync("unzip", ["-p", archive, "manifest.json"], { encoding: "utf8" }));
      const storeManifest = archivedManifest(store.outputPath);
      const unpackedManifest = archivedManifest(unpacked.outputPath);

      expect(execFileSync("unzip", ["-t", store.outputPath], { encoding: "utf8" })).toContain("No errors detected");
      expect(execFileSync("unzip", ["-t", unpacked.outputPath], { encoding: "utf8" })).toContain("No errors detected");
      expect(entries(store.outputPath)).toEqual(store.entries);
      expect(entries(unpacked.outputPath)).toEqual(unpacked.entries);
      expect(store.entries).toEqual(unpacked.entries);
      expect(store.outputPath).toBe(join(fixture, `extension/pinar-extension-${version}.zip`));
      expect(unpacked.outputPath).toBe(join(fixture, `extension/pinar-extension-${version}-unpacked.zip`));
      expect(storeManifest.version).toBe(version);
      expect("key" in storeManifest).toBe(false);
      expect(unpackedManifest.version).toBe(version);
      expect(unpackedManifest.key === manifest.key).toBe(true);
      expect(chromeExtensionId(unpackedManifest.key)).toBe("idpeaokdndjedekacfdfbilcolpholbo");
      expect(store.sha256).toBe(storeAgain.sha256);
      expect(unpacked.sha256).toBe(unpackedAgain.sha256);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects files that caused the malformed 0.5.0 asset", () => {
    expect(() => validateEntryPaths(["manifest.json", "format.d.ts"])).toThrow("TypeScript declaration is forbidden");
    expect(() => validateEntryPaths(["manifest.json", "pinar-0.4.0.zip"])).toThrow("nested archive is forbidden");
    expect(() => validateEntryPaths(["pinar-extension-0.5.0/manifest.json"])).toThrow("manifest.json must be at the archive root");
  });

  test("requires every manifest runtime reference", () => {
    const fixture = createPackagingFixture(mkdtempSync(join(tmpdir(), "pinar-extension-references-")), "0.6.5");
    try {
      const { manifest } = extensionVersions(fixture);
      const entries = collectExtensionEntries(fixture).filter((entry) => entry !== manifest.background.service_worker);
      expect(() => validateManifestFiles({ entries, manifest, rootDirectory: fixture })).toThrow(manifest.background.service_worker);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("keeps extension tags independent from product tags", () => {
    expect(() => validateReleaseTag("ext-v0.5.0", "0.5.0")).not.toThrow();
    expect(() => validateReleaseTag("v0.5.0", "0.5.0")).toThrow("ext-v0.5.0");
    expect(() => validateReleaseTag("extension-v0.5.0", "0.5.0")).toThrow("ext-v0.5.0");
  });

  test("parses the unpacked packaging flag", () => {
    expect(parseOptions(["--expected-version", "0.6.5", "--unpacked"])).toEqual({
      expectedVersion: "0.6.5",
      unpacked: true,
    });
    expect(parseOptions([])).toEqual({ unpacked: false });
    expect(() => parseOptions(["--unpacked", "yes"])).toThrow("unknown option: yes");
  });

  test("requires values for every value-taking packaging option", () => {
    expect(() => parseOptions(["--output"])).toThrow("--output requires a value");
    expect(() => parseOptions(["--output", "--expected-version", "0.5.0"])).toThrow("--output requires a value");
    expect(() => parseOptions(["--expected-version"])).toThrow("--expected-version requires a value");
  });

  test("workflow never replaces the product Latest release", () => {
    const workflow = readFileSync(join(root, ".github/workflows/release-extension.yml"), "utf8");
    expect(workflow).toContain("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1");
    expect(workflow).toContain('tags: ["ext-v*"]');
    expect(workflow).toContain("permissions:\n  contents: write");
    expect(workflow).toContain("--latest=false");
    expect(workflow).toContain('bun run package:ext -- --expected-version "${{ steps.extension.outputs.version }}"');
    expect(workflow).toContain('bun run package:ext -- --expected-version "${{ steps.extension.outputs.version }}" --unpacked');
    expect(workflow).toContain('"extension/pinar-extension-$VERSION.zip"');
    expect(workflow).toContain('"extension/pinar-extension-$VERSION-unpacked.zip"');
  });
});
