import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  readRequiredCapabilities,
  resolveCottontailReleaseBin,
  syncCottontailRuntime,
} from "../apps/tray/scripts/cottontail-runtime-sync.mjs";

// Exercises syncCottontailRuntime against staged fixtures for BOTH layouts
// (win32 and darwin) and a fake Cottontail release dir. Fixtures live under
// os.tmpdir() and are removed in a finally. Only the sync module is imported;
// post-build.mjs is never imported or spawned (its platform branches would run
// macos-agent-app / copy artifacts).

const VERSION = "0.7.2-canary.6";

const CATALOG = {
  schema: 1,
  capabilities: {
    ffi: { requires: [] },
    compression: { requires: [] },
    archive: { requires: ["compression"] },
    build: { requires: [] },
  },
};

const ALL_CAP_DIRS = ["ffi", "compression", "archive", "build"];

const CAPS_FFI_COMPRESSION =
  'export default { build: { cottontail: { entrypoint: "x", capabilities: ["ffi", "compression"] } } };';
const CAPS_FFI_ARCHIVE =
  'export default { build: { cottontail: { entrypoint: "x", capabilities: ["ffi", "archive"] } } };';
const CAPS_FFI = 'export default { build: { cottontail: { entrypoint: "x", capabilities: ["ffi"] } } };';
const CAPS_ARCHIVE = 'export default { build: { cottontail: { entrypoint: "x", capabilities: ["archive"] } } };';
const CAPS_FFI_GHOST =
  'export default { build: { cottontail: { entrypoint: "x", capabilities: ["ffi", "ghost"] } } };';
const NO_CAPS = 'export default { build: { cottontail: { entrypoint: "x" } } };';

function withTemp<T>(prefix: string, fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeConfig(root: string, text: string): string {
  const configPath = join(root, "cfg", "electrobun.config.ts");
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, text);
  return configPath;
}

interface ReleaseOpts {
  withCore?: boolean;
  coreEmpty?: boolean;
  withStdlib?: boolean;
  withCatalog?: boolean;
  catalog?: unknown;
  capabilityDirs?: string[];
}

function makeRelease(root: string, opts: ReleaseOpts = {}): string {
  const {
    withCore = true,
    coreEmpty = false,
    withStdlib = true,
    withCatalog = true,
    catalog = CATALOG,
    capabilityDirs = ALL_CAP_DIRS,
  } = opts;
  const releaseBin = join(root, "rel", "bin");
  if (withCore) {
    const core = join(releaseBin, "cottontail-core");
    mkdirSync(core, { recursive: true });
    if (!coreEmpty) {
      mkdirSync(join(core, "runtime"), { recursive: true });
      writeFileSync(join(core, "host-bootstrap.jsc"), "HOST-BOOTSTRAP-BYTES");
      writeFileSync(join(core, "runtime", "x"), "CORE-RUNTIME-X-BYTES");
    }
  }
  if (withStdlib) {
    const stdlib = join(releaseBin, "cottontail-stdlib");
    mkdirSync(stdlib, { recursive: true });
    if (withCatalog) {
      writeFileSync(
        join(stdlib, "capabilities.json"),
        typeof catalog === "string" ? catalog : JSON.stringify(catalog, null, 2),
      );
    }
    for (const name of capabilityDirs) {
      mkdirSync(join(stdlib, name), { recursive: true });
      writeFileSync(join(stdlib, name, "mod.js"), `CAP-${name}-BYTES`);
    }
  }
  return releaseBin;
}

interface StagedOpts {
  withCottontail?: boolean;
  buildJson?: unknown;
  buildJsonRaw?: string;
}

function makeStaged(root: string, platform: string, opts: StagedOpts = {}): string {
  const { withCottontail = true, buildJson, buildJsonRaw } = opts;
  const buildDir = join(root, "build");
  if (platform === "win32") {
    const bin = join(buildDir, "Pinar", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, withCottontail ? "cottontail.exe" : "launcher.exe"), "STAGED-RUNTIME");
    if (buildJsonRaw !== undefined || buildJson !== undefined) {
      mkdirSync(join(buildDir, "Pinar", "Resources"), { recursive: true });
      const raw =
        buildJsonRaw !== undefined ? buildJsonRaw : typeof buildJson === "string" ? buildJson : JSON.stringify(buildJson);
      writeFileSync(join(buildDir, "Pinar", "Resources", "build.json"), raw);
    }
  } else {
    const macos = join(buildDir, "Pinar.app", "Contents", "MacOS");
    mkdirSync(macos, { recursive: true });
    writeFileSync(join(macos, withCottontail ? "cottontail" : "launcher"), "STAGED-RUNTIME");
    if (buildJsonRaw !== undefined || buildJson !== undefined) {
      mkdirSync(join(buildDir, "Pinar.app", "Contents", "Resources"), { recursive: true });
      const raw =
        buildJsonRaw !== undefined ? buildJsonRaw : typeof buildJson === "string" ? buildJson : JSON.stringify(buildJson);
      writeFileSync(join(buildDir, "Pinar.app", "Contents", "Resources", "build.json"), raw);
    }
  }
  return buildDir;
}

function stagedBinOf(buildDir: string, platform: string): string {
  return platform === "win32" ? join(buildDir, "Pinar", "bin") : join(buildDir, "Pinar.app", "Contents", "MacOS");
}

interface Fixture {
  buildDir: string;
  stagedBin: string;
  configPath: string;
  releaseBin: string;
  platform: string;
}

function fixture(
  root: string,
  platform: string,
  configText: string,
  opts: { buildJson?: unknown; buildJsonRaw?: string; noBuildJson?: boolean; releaseOpts?: ReleaseOpts } = {},
): Fixture {
  const { buildJson = { runtimeVersions: { cottontail: VERSION } }, buildJsonRaw, noBuildJson = false, releaseOpts = {} } = opts;
  const releaseBin = makeRelease(root, releaseOpts);
  const stagedOpts: StagedOpts = noBuildJson
    ? {}
    : buildJsonRaw !== undefined
      ? { buildJsonRaw }
      : { buildJson };
  const buildDir = makeStaged(root, platform, stagedOpts);
  const configPath = writeConfig(root, configText);
  return { buildDir, stagedBin: stagedBinOf(buildDir, platform), configPath, releaseBin, platform };
}

function runSync(f: Fixture): string {
  return syncCottontailRuntime(f.buildDir, {
    platform: f.platform,
    configPath: f.configPath,
    resolveReleaseBin: () => f.releaseBin,
  });
}

function bytesEqual(a: string, b: string): boolean {
  return readFileSync(a).equals(readFileSync(b));
}

function assertCoreAndCatalog(f: Fixture): void {
  expect(bytesEqual(join(f.stagedBin, "cottontail-core", "host-bootstrap.jsc"), join(f.releaseBin, "cottontail-core", "host-bootstrap.jsc")), "core host-bootstrap.jsc bytes").toBe(true);
  expect(bytesEqual(join(f.stagedBin, "cottontail-core", "runtime", "x"), join(f.releaseBin, "cottontail-core", "runtime", "x")), "core runtime/x bytes").toBe(true);
  expect(bytesEqual(join(f.stagedBin, "cottontail-stdlib", "capabilities.json"), join(f.releaseBin, "cottontail-stdlib", "capabilities.json")), "capabilities.json bytes").toBe(true);
}

function assertCopiedCaps(f: Fixture, caps: string[]): void {
  for (const cap of caps) {
    expect(bytesEqual(join(f.stagedBin, "cottontail-stdlib", cap, "mod.js"), join(f.releaseBin, "cottontail-stdlib", cap, "mod.js")), `capability ${cap} bytes`).toBe(true);
  }
}

function assertNotCopied(f: Fixture, caps: string[]): void {
  for (const cap of caps) {
    expect(existsSync(join(f.stagedBin, "cottontail-stdlib", cap)), `capability ${cap} must not be copied`).toBe(false);
  }
}

describe("syncCottontailRuntime success (real execution)", () => {
  test("win32: copies core, catalog and requested capabilities with exact bytes; skips unrequested", () => {
    withTemp("pinar-sync-win-ok-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI_COMPRESSION);
      expect(runSync(f)).toBe(
        `ok (synced Cottontail ${VERSION}: cottontail-core/, capabilities.json, ffi, compression)`,
      );
      assertCoreAndCatalog(f);
      assertCopiedCaps(f, ["ffi", "compression"]);
      assertNotCopied(f, ["archive", "build"]);
    });
  });

  test("darwin: copies core, catalog and requested capabilities with exact bytes", () => {
    withTemp("pinar-sync-darwin-ok-", (root) => {
      const f = fixture(root, "darwin", CAPS_FFI_COMPRESSION);
      expect(runSync(f)).toBe(
        `ok (synced Cottontail ${VERSION}: cottontail-core/, capabilities.json, ffi, compression)`,
      );
      assertCoreAndCatalog(f);
      assertCopiedCaps(f, ["ffi", "compression"]);
      assertNotCopied(f, ["archive", "build"]);
    });
  });

  test("win32: a requested archive pulls transitive compression (visit order)", () => {
    withTemp("pinar-sync-win-transitive-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI_ARCHIVE);
      expect(runSync(f)).toBe(
        `ok (synced Cottontail ${VERSION}: cottontail-core/, capabilities.json, ffi, archive, compression)`,
      );
      assertCoreAndCatalog(f);
      assertCopiedCaps(f, ["ffi", "archive", "compression"]);
      assertNotCopied(f, ["build"]);
    });
  });
});

describe("syncCottontailRuntime fail-closed (each case throws naming the problem)", () => {
  test("missing build.json next to a staged runtime", () => {
    withTemp("pinar-sync-neg-nobuildjson-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI, { noBuildJson: true });
      expect(() => runSync(f)).toThrow(/has no .*build\.json/);
    });
  });

  test("malformed build.json", () => {
    withTemp("pinar-sync-neg-badbuildjson-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI, { buildJsonRaw: "{ not json" });
      expect(() => runSync(f)).toThrow(/cannot parse .*build\.json/);
    });
  });

  test("missing version", () => {
    withTemp("pinar-sync-neg-noversion-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI, { buildJson: { runtimeVersions: {} } });
      expect(() => runSync(f)).toThrow(/no valid runtimeVersions\.cottontail/);
    });
  });

  test("non-string version", () => {
    withTemp("pinar-sync-neg-nonstringversion-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI, { buildJson: { runtimeVersions: { cottontail: 42 } } });
      expect(() => runSync(f)).toThrow(/no valid runtimeVersions\.cottontail/);
    });
  });

  test("invalid-format version (latest, 0.7, ../x)", () => {
    for (const bad of ["latest", "0.7", "../x"]) {
      const slug = bad.replace(/[^a-z0-9]/gi, "_");
      withTemp(`pinar-sync-neg-badversion-${slug}-`, (root) => {
        const f = fixture(root, "win32", CAPS_FFI, { buildJson: { runtimeVersions: { cottontail: bad } } });
        expect(() => runSync(f)).toThrow(/no valid runtimeVersions\.cottontail/);
      });
    }
  });

  test("resolver throws", () => {
    withTemp("pinar-sync-neg-resolverthrow-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI);
      const err = () =>
        syncCottontailRuntime(f.buildDir, {
          platform: "win32",
          configPath: f.configPath,
          resolveReleaseBin: () => {
            throw new Error("resolver-boom");
          },
        });
      expect(err).toThrow("resolver-boom");
    });
  });

  test("release without cottontail-core for 0.7.2-canary.6", () => {
    withTemp("pinar-sync-neg-nocore-072-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI, { releaseOpts: { withCore: false } });
      expect(() => runSync(f)).toThrow(/has no .*cottontail-core/);
    });
  });

  test("release without cottontail-core for 0.5.0 (no pre-core exception)", () => {
    withTemp("pinar-sync-neg-nocore-050-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI, {
        buildJson: { runtimeVersions: { cottontail: "0.5.0" } },
        releaseOpts: { withCore: false },
      });
      expect(() => runSync(f)).toThrow(/has no .*cottontail-core/);
    });
  });

  test("empty cottontail-core", () => {
    withTemp("pinar-sync-neg-emptycore-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI, { releaseOpts: { coreEmpty: true } });
      expect(() => runSync(f)).toThrow(/is empty/);
    });
  });

  test("missing capabilities.json catalog", () => {
    withTemp("pinar-sync-neg-nocat-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI, { releaseOpts: { withCatalog: false } });
      expect(() => runSync(f)).toThrow(/no .*capabilities\.json/);
    });
  });

  test("invalid capabilities.json catalog", () => {
    withTemp("pinar-sync-neg-badcat-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI, { releaseOpts: { catalog: "{ not json" } });
      expect(() => runSync(f)).toThrow(/cannot parse .*capabilities\.json/);
    });
  });

  test("requested capability absent from catalog", () => {
    withTemp("pinar-sync-neg-notincat-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI_GHOST);
      expect(() => runSync(f)).toThrow(/capability "ghost".*is not in/);
    });
  });

  test("requested capability directory missing", () => {
    withTemp("pinar-sync-neg-nocapdir-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI, { releaseOpts: { capabilityDirs: ["compression", "archive", "build"] } });
      expect(() => runSync(f)).toThrow(/capability "ffi".*missing from/);
    });
  });

  test("transitive requirement directory missing", () => {
    withTemp("pinar-sync-neg-notransdir-", (root) => {
      const f = fixture(root, "win32", CAPS_ARCHIVE, { releaseOpts: { capabilityDirs: ["ffi", "archive", "build"] } });
      expect(() => runSync(f)).toThrow(/capability "compression".*missing from/);
    });
  });

  test("no capabilities declared", () => {
    withTemp("pinar-sync-neg-nocaps-", (root) => {
      const f = fixture(root, "win32", NO_CAPS);
      expect(() => runSync(f)).toThrow(/declares no build\.cottontail\.capabilities/);
    });
  });
});

describe("syncCottontailRuntime no-op preserved (legitimate wrapper stage)", () => {
  test("build dir missing -> skipped", () => {
    withTemp("pinar-sync-noop-nodir-", (root) => {
      const configPath = writeConfig(root, CAPS_FFI);
      const missing = join(root, "does-not-exist");
      const result = syncCottontailRuntime(missing, {
        platform: "win32",
        configPath,
        resolveReleaseBin: () => {
          throw new Error("must not be called");
        },
      });
      expect(result).toBe(`skipped (build dir not found: ${missing})`);
    });
  });

  test("win32 wrapper-only -> skipped, resolver NOT called, nothing written", () => {
    withTemp("pinar-sync-noop-winwrapper-", (root) => {
      const buildDir = makeStaged(root, "win32", { withCottontail: false });
      const configPath = writeConfig(root, CAPS_FFI);
      let called = false;
      const result = syncCottontailRuntime(buildDir, {
        platform: "win32",
        configPath,
        resolveReleaseBin: () => {
          called = true;
          throw new Error("must not be called");
        },
      });
      expect(result).toBe(`skipped (no staged Cottontail runtime executable in ${buildDir})`);
      expect(called).toBe(false);
      expect(existsSync(join(buildDir, "Pinar", "bin", "cottontail-core"))).toBe(false);
      expect(existsSync(join(buildDir, "Pinar", "bin", "cottontail-stdlib"))).toBe(false);
    });
  });

  test("darwin wrapper-only -> skipped, resolver NOT called, nothing written", () => {
    withTemp("pinar-sync-noop-darwinwrapper-", (root) => {
      const buildDir = makeStaged(root, "darwin", { withCottontail: false });
      const configPath = writeConfig(root, CAPS_FFI);
      let called = false;
      const result = syncCottontailRuntime(buildDir, {
        platform: "darwin",
        configPath,
        resolveReleaseBin: () => {
          called = true;
          throw new Error("must not be called");
        },
      });
      expect(result).toBe(`skipped (no staged Cottontail runtime executable in ${buildDir})`);
      expect(called).toBe(false);
      expect(existsSync(join(buildDir, "Pinar.app", "Contents", "MacOS", "cottontail-core"))).toBe(false);
      expect(existsSync(join(buildDir, "Pinar.app", "Contents", "MacOS", "cottontail-stdlib"))).toBe(false);
    });
  });
});

describe("syncCottontailRuntime darwin staged bundle selection", () => {
  test("two .app bundles that both stage a runtime -> throws as ambiguous, resolver NOT called", () => {
    withTemp("pinar-sync-darwin-ambiguous-", (root) => {
      const f = fixture(root, "darwin", CAPS_FFI_COMPRESSION);
      const otherMacos = join(f.buildDir, "Other.app", "Contents", "MacOS");
      mkdirSync(otherMacos, { recursive: true });
      writeFileSync(join(otherMacos, "cottontail"), "STAGED-RUNTIME");
      let called = false;
      expect(() =>
        syncCottontailRuntime(f.buildDir, {
          platform: "darwin",
          configPath: f.configPath,
          resolveReleaseBin: () => {
            called = true;
            return f.releaseBin;
          },
        }),
      ).toThrow(/more than one staged Cottontail runtime/);
      expect(called).toBe(false);
      expect(existsSync(join(f.stagedBin, "cottontail-core"))).toBe(false);
    });
  });

  test("an extra .app without a runtime does not hide the staged one", () => {
    withTemp("pinar-sync-darwin-extra-app-", (root) => {
      const f = fixture(root, "darwin", CAPS_FFI_COMPRESSION);
      mkdirSync(join(f.buildDir, "Other.app", "Contents", "MacOS"), { recursive: true });
      const result = runSync(f);
      expect(result.startsWith(`ok (synced Cottontail ${VERSION}:`)).toBe(true);
      assertCoreAndCatalog(f);
      assertCopiedCaps(f, ["ffi", "compression"]);
    });
  });
});

describe("resolveCottontailReleaseBin (default resolver through injected spawnSync)", () => {
  test("last non-empty stdout line -> its dirname (existing bin dir)", () => {
    withTemp("pinar-sync-resolver-ok-", (root) => {
      const binDir = join(root, "rel", "bin");
      mkdirSync(binDir, { recursive: true });
      const result = resolveCottontailReleaseBin(VERSION, {
        spawnSync: () => ({ status: 0, stdout: `download noise\n${join(binDir, "cottontail.exe")}\n`, stderr: "" }),
      });
      expect(result).toBe(binDir);
    });
  });

  test("nonzero exit throws", () => {
    const err = () =>
      resolveCottontailReleaseBin(VERSION, {
        spawnSync: () => ({ status: 1, stdout: "", stderr: "hutch failed" }),
      });
    expect(err).toThrow(/failed/);
  });

  test("spawn error throws", () => {
    const err = () =>
      resolveCottontailReleaseBin(VERSION, {
        spawnSync: () => ({ status: null, stdout: "", stderr: "", error: new Error("spawn failed") }),
      });
    expect(err).toThrow(/spawn error/);
  });

  test("non-existent bin dir throws", () => {
    const missing = join(tmpdir(), `pinar-sync-resolver-nonexistent-${process.pid}`, "cottontail.exe");
    const err = () =>
      resolveCottontailReleaseBin(VERSION, {
        spawnSync: () => ({ status: 0, stdout: `${missing}\n`, stderr: "" }),
      });
    expect(err).toThrow(/did not yield an existing bin dir/);
  });
});

describe("readRequiredCapabilities", () => {
  test("parses single/double quotes, dedups preserving first order, and returns [] when absent", () => {
    expect(readRequiredCapabilities('capabilities: ["ffi", "compression"]')).toEqual(["ffi", "compression"]);
    expect(readRequiredCapabilities("capabilities: ['ffi', 'compression']")).toEqual(["ffi", "compression"]);
    expect(readRequiredCapabilities('capabilities: ["ffi", "ffi", "compression"]')).toEqual(["ffi", "compression"]);
    expect(readRequiredCapabilities('capabilities: ["compression", "ffi"]')).toEqual(["compression", "ffi"]);
    expect(readRequiredCapabilities("no capabilities block here")).toEqual([]);
  });
});

describe("post-build.mjs thin hook (static)", () => {
  test("imports syncCottontailRuntime from ./cottontail-runtime-sync.mjs and no longer defines its own copy", () => {
    const postBuild = readFileSync(join(import.meta.dir, "..", "apps", "tray", "scripts", "post-build.mjs"), "utf8");
    expect(postBuild).toMatch(
      /import\s*\{[^}]*\bsyncCottontailRuntime\b[^}]*\}\s*from\s*["']\.\/cottontail-runtime-sync\.mjs["']/,
    );
    expect(postBuild).not.toMatch(/function\s+syncCottontailRuntime/);
  });
});
