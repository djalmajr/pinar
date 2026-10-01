import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  DEVELOPMENT_EXTENSION_ID,
  DEVELOPMENT_EXTENSION_KEY,
  STAGING_CLOUD_URL,
  resolveCloudUrl,
} from "../extension/environment.js";
import {
  OFFICIAL_EXTENSION_PUBLIC_KEY,
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
const OFFICIAL_EXTENSION_ID = "idpeaokdndjedekacfdfbilcolpholbo";

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
  const fixtureKey = arguments.length < 3 ? DEVELOPMENT_EXTENSION_KEY : key;
  writeFileSync(join(extension, "manifest.json"), JSON.stringify({
    background: { service_worker: "background.js" },
    ...(fixtureKey === undefined ? {} : { key: fixtureKey }),
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

  test("the tracked source manifest is the development identity pinned to staging", () => {
    const { manifest } = extensionVersions(root);
    expect(manifest.key).toBe(DEVELOPMENT_EXTENSION_KEY);
    expect(chromeExtensionId(manifest.key)).toBe(DEVELOPMENT_EXTENSION_ID);
    expect(resolveCloudUrl(manifest)).toBe(STAGING_CLOUD_URL);
  });

  test("the official unpacked release key is pinned to the official extension ID", () => {
    expect(chromeExtensionId(OFFICIAL_EXTENSION_PUBLIC_KEY)).toBe(OFFICIAL_EXTENSION_ID);
  });

  test("strips the key for Store and pins the unpacked release to the official identity", () => {
    const { manifest } = extensionVersions(root);
    const store = releaseManifest(manifest);
    expect("key" in store).toBe(false);
    const unpacked = releaseManifest(manifest, { unpacked: true });
    expect(unpacked.key).toBe(OFFICIAL_EXTENSION_PUBLIC_KEY);
    expect(chromeExtensionId(unpacked.key)).toBe(OFFICIAL_EXTENSION_ID);
    expect(unpacked.version).toBe(manifest.version);
  });

  test("rejects missing, malformed, and unrecognized source keys without writing archives", () => {
    const missingMessage = "source manifest.key is missing; the repository extension must carry the recognized development key";
    const unrecognizedMessage = "source manifest.key is not the recognized development key; refusing unrecognized key material";
    const invalidKeys = [
      { key: undefined, message: missingMessage },
      { key: "", message: missingMessage },
      { key: "not base64!", message: unrecognizedMessage },
      { key: "aGVsbG8=", message: unrecognizedMessage },
      // A real, well-formed key that is not the recognized development source key
      // (the official production key misplaced in the source manifest).
      { key: OFFICIAL_EXTENSION_PUBLIC_KEY, message: unrecognizedMessage },
    ];
    for (const { key, message } of invalidKeys) {
      for (const unpacked of [false, true]) {
        const fixture = mkdtempSync(join(tmpdir(), "pinar-extension-invalid-key-"));
        try {
          createPackagingFixture(fixture, "0.6.5", key);
          const archive = join(fixture, `extension/pinar-extension-0.6.5${unpacked ? "-unpacked" : ""}.zip`);
          expect(() => packageExtension({ rootDirectory: fixture, runBuild: false, unpacked }))
            .toThrow(message);
          expect(existsSync(archive)).toBe(false);
        } finally {
          rmSync(fixture, { recursive: true, force: true });
        }
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
      expect(chromeExtensionId(sourceManifest.key)).toBe(DEVELOPMENT_EXTENSION_ID);
      expect(unpackedManifest.key).toBe(OFFICIAL_EXTENSION_PUBLIC_KEY);
      expect(chromeExtensionId(unpackedManifest.key)).toBe(OFFICIAL_EXTENSION_ID);
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
