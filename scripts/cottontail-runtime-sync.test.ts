import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  assertContainedPath,
  isValidCapabilityName,
  readRequiredCapabilities,
  resolveCottontailReleaseBin,
  syncCottontailRuntime,
  verifyTreeEqual,
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

function thrownMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the operation to throw");
}

function capsConfig(caps: string[]): string {
  // Raw double-quoted names (like the CAPS_* constants above): the parser
  // strips quotes without unescaping, so the raw file text IS the name.
  const list = caps.map((c) => `"${c}"`).join(", ");
  return `export default { build: { cottontail: { entrypoint: "x", capabilities: [${list}] } } };`;
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
        hutchExecutable: join(root, "hutch.exe"),
        spawnSync: () => ({ status: 0, stdout: `download noise\n${join(binDir, "cottontail.exe")}\n`, stderr: "" }),
      });
      expect(result).toBe(binDir);
    });
  });

  test("nonzero exit throws", () => {
    const err = () =>
      resolveCottontailReleaseBin(VERSION, {
        hutchExecutable: "C:/fake/hutch.exe",
        spawnSync: () => ({ status: 1, stdout: "", stderr: "hutch failed" }),
      });
    expect(err).toThrow(/failed/);
  });

  test("spawn error throws", () => {
    const err = () =>
      resolveCottontailReleaseBin(VERSION, {
        hutchExecutable: "C:/fake/hutch.exe",
        spawnSync: () => ({ status: null, stdout: "", stderr: "", error: new Error("spawn failed") }),
      });
    expect(err).toThrow(/spawn error/);
  });

  test("non-existent bin dir throws", () => {
    const missing = join(tmpdir(), `pinar-sync-resolver-nonexistent-${process.pid}`, "cottontail.exe");
    const err = () =>
      resolveCottontailReleaseBin(VERSION, {
        hutchExecutable: "C:/fake/hutch.exe",
        spawnSync: () => ({ status: 0, stdout: `${missing}\n`, stderr: "" }),
      });
    expect(err).toThrow(/did not yield an existing bin dir/);
  });

  test("spawns the injected absolute executable with shell not true (no bare 'hutch')", () => {
    withTemp("pinar-sync-resolver-exe-", (root) => {
      const binDir = join(root, "rel", "bin");
      mkdirSync(binDir, { recursive: true });
      const exe = join(root, "hutch.exe");
      const calls: Array<{ file: unknown; args: unknown; options: unknown }> = [];
      const result = resolveCottontailReleaseBin(VERSION, {
        hutchExecutable: exe,
        spawnSync: (file: unknown, args: unknown, options: unknown) => {
          calls.push({ file, args, options });
          return { status: 0, stdout: `${join(binDir, "cottontail.exe")}\n`, stderr: "" };
        },
      });
      expect(result).toBe(binDir);
      expect(calls).toHaveLength(1);
      expect(calls[0].file).toBe(exe);
      expect(isAbsolute(String(calls[0].file)), "the spawned executable is absolute").toBe(true);
      expect((calls[0].options as { shell?: boolean }).shell, "shell is not true").not.toBe(true);
    });
  });

  test("a failing executable resolver becomes the existing cannot-resolve error with the reason", () => {
    const err = () =>
      resolveCottontailReleaseBin(VERSION, {
        hutchExecutable: () => {
          throw new Error("hutch-exe-resolver-boom");
        },
        spawnSync: () => {
          throw new Error("must not spawn");
        },
      });
    expect(err).toThrow(/cannot resolve the Cottontail .* release: hutch-exe-resolver-boom/);
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

describe("isValidCapabilityName (single capability path segment)", () => {
  test("accepts the pinned and ordinary catalog capability names", () => {
    for (const name of ["ffi", "compression", "dependencies", "node-compat", "fs.promises"]) {
      expect(isValidCapabilityName(name), `should accept ${JSON.stringify(name)}`).toBe(true);
    }
  });

  test("rejects traversal, device, trailing-dot, over-long and non-string names", () => {
    for (const name of [
      "../x",
      "a/b",
      "a\\b",
      "C:x",
      "..",
      ".",
      "x\u0000",
      "con",
      "nul.txt",
      "foo.",
      "foo ",
      "ffi~1",
      "",
      "a".repeat(65),
    ]) {
      expect(isValidCapabilityName(name), `should reject ${JSON.stringify(name)}`).toBe(false);
    }
    for (const name of [42, {}, null]) {
      expect(isValidCapabilityName(name), `should reject non-string ${JSON.stringify(name)}`).toBe(false);
    }
  });
});

describe("syncCottontailRuntime capability name validation (bad name -> throw before any write)", () => {
  // The catalog contains the malicious name with a valid `requires`, so
  // catalog membership cannot be what stops it: only the name validation can.
  // With validation removed the walk would succeed and the copies would start,
  // which is exactly what the untouched-dest assertions catch.
  function maliciousCatalog(name: string): unknown {
    const capabilities: Record<string, { requires: unknown }> = {
      ffi: { requires: [] },
      compression: { requires: [] },
      [name]: { requires: [] },
    };
    return { schema: 1, capabilities };
  }

  function assertStagedTreeUntouched(f: Fixture, sentinel: string): void {
    // The staged dest root must have NO new entries at all.
    expect(readdirSync(f.stagedBin)).toEqual(f.platform === "win32" ? ["cottontail.exe"] : ["cottontail"]);
    expect(existsSync(join(f.stagedBin, "cottontail-core")), "no cottontail-core").toBe(false);
    expect(existsSync(join(f.stagedBin, "cottontail-stdlib")), "no cottontail-stdlib").toBe(false);
    expect(existsSync(join(f.stagedBin, "capabilities.json")), "no capabilities.json at dest root").toBe(false);
    // And nothing may have been written outside the staged tree.
    expect(readdirSync(sentinel).length, "sentinel sibling dir stays empty").toBe(0);
  }

  test("a requested malicious name throws before any write (each traversal form)", () => {
    for (const name of ["../escape", "a/b", "a\\b", "C:x", ".."]) {
      const slug = name.replace(/[^a-z0-9]/gi, "_");
      withTemp(`pinar-sync-neg-badcap-${slug}-`, (root) => {
        const sentinel = join(root, "sentinel");
        mkdirSync(sentinel, { recursive: true });
        const f = fixture(root, "win32", capsConfig(["ffi", name]), {
          releaseOpts: { catalog: maliciousCatalog(name) },
        });
        const message = thrownMessage(() => runSync(f));
        expect(message).toContain(`invalid Cottontail capability name ${JSON.stringify(name)}`);
        expect(message).toContain("in the requested capabilities");
        assertStagedTreeUntouched(f, sentinel);
      });
    }
  });

  test("a transitive malicious name (via a valid requested capability's requires) throws before any write", () => {
    const name = "../escape";
    withTemp("pinar-sync-neg-badcap-transitive-", (root) => {
      const sentinel = join(root, "sentinel");
      mkdirSync(sentinel, { recursive: true });
      const f = fixture(root, "win32", CAPS_FFI, {
        releaseOpts: {
          catalog: {
            schema: 1,
            capabilities: {
              ffi: { requires: [name] },
              [name]: { requires: [] },
            },
          },
        },
      });
      const message = thrownMessage(() => runSync(f));
      expect(message).toContain(`invalid Cottontail capability name ${JSON.stringify(name)}`);
      expect(message).toContain(`in "ffi".requires of the`);
      expect(message).toContain("catalog");
      assertStagedTreeUntouched(f, sentinel);
    });
  });

  test("a requires that is a string instead of an array throws before any write", () => {
    withTemp("pinar-sync-neg-badrequires-string-", (root) => {
      const sentinel = join(root, "sentinel");
      mkdirSync(sentinel, { recursive: true });
      const f = fixture(root, "win32", CAPS_FFI, {
        releaseOpts: { catalog: { schema: 1, capabilities: { ffi: { requires: "compression" } } } },
      });
      const message = thrownMessage(() => runSync(f));
      expect(message).toMatch(/invalid Cottontail capability name/);
      expect(message).toContain(`in "ffi".requires of the`);
      assertStagedTreeUntouched(f, sentinel);
    });
  });

  test("a requires array containing a number throws before any write", () => {
    withTemp("pinar-sync-neg-badrequires-number-", (root) => {
      const sentinel = join(root, "sentinel");
      mkdirSync(sentinel, { recursive: true });
      const f = fixture(root, "win32", CAPS_FFI, {
        releaseOpts: { catalog: { schema: 1, capabilities: { ffi: { requires: [42] } } } },
      });
      const message = thrownMessage(() => runSync(f));
      expect(message).toMatch(/invalid Cottontail capability name 42/);
      expect(message).toContain(`in "ffi".requires of the`);
      assertStagedTreeUntouched(f, sentinel);
    });
  });
});

describe("assertContainedPath (defense in depth after name validation)", () => {
  test("accepts a contained path and rejects one that escapes the base", () => {
    withTemp("pinar-sync-containment-", (root) => {
      const base = join(root, "base");
      mkdirSync(base, { recursive: true });
      expect(() => assertContainedPath(base, join(base, "ffi", "mod.js"))).not.toThrow();
      expect(() => assertContainedPath(base, join(base, "..", "escape"))).toThrow(/escapes its base/);
      expect(() => assertContainedPath(base, join(root, "outside"))).toThrow(/escapes its base/);
    });
  });
});

describe("syncCottontailRuntime link-safe planning (SY-1: a link may not enter the staged tree)", () => {
  function replaceStdlibFfiWithLink(f: Fixture, outside: string, kind: "junction" | "dir"): NodeJS.ErrnoException | null {
    rmSync(join(f.releaseBin, "cottontail-stdlib", "ffi"), { recursive: true, force: true });
    try {
      symlinkSync(outside, join(f.releaseBin, "cottontail-stdlib", "ffi"), kind);
      return null;
    } catch (error) {
      return error as NodeJS.ErrnoException;
    }
  }

  test("win32: a junction capability dir pointing outside throws before any write and copies nothing", () => {
    withTemp("pinar-sync-neg-junction-", (root) => {
      if (process.platform !== "win32") {
        console.log(`(skip) the real junction test needs a win32 host (host: ${process.platform})`);
        return;
      }
      const f = fixture(root, "win32", CAPS_FFI);
      const outside = join(root, "outside-secret");
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "secret.txt"), "secret-bytes");
      const linkError = replaceStdlibFfiWithLink(f, outside, "junction");
      if (linkError) throw new Error(`junction creation failed on a win32 host: ${linkError.code} ${linkError.message}`);
      const message = thrownMessage(() => runSync(f));
      expect(message).toContain("symbolic link");
      expect(readdirSync(f.stagedBin)).toEqual(["cottontail.exe"]);
      expect(existsSync(join(f.stagedBin, "cottontail-core")), "no cottontail-core at dest").toBe(false);
      expect(existsSync(join(f.stagedBin, "cottontail-stdlib")), "no cottontail-stdlib at dest").toBe(false);
      expect(readdirSync(outside), "the outside dir keeps its single secret").toEqual(["secret.txt"]);
      expect(existsSync(join(f.stagedBin, "cottontail-stdlib", "ffi", "secret.txt")), "secret.txt never copied").toBe(false);
    });
  });

  test('a "dir" symlinked capability dir pointing outside throws before any write (skipped only on EPERM)', () => {
    withTemp("pinar-sync-neg-dirsymlink-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI);
      const outside = join(root, "outside-secret");
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "secret.txt"), "secret-bytes");
      const linkError = replaceStdlibFfiWithLink(f, outside, "dir");
      if (linkError && linkError.code === "EPERM") {
        console.log(`(skip) symlink(..., "dir") not permitted on this host: ${linkError.code} ${linkError.message}`);
        return;
      }
      if (linkError) throw new Error(`unexpected symlink failure: ${linkError.code} ${linkError.message}`);
      const message = thrownMessage(() => runSync(f));
      expect(message).toContain("symbolic link");
      expect(readdirSync(f.stagedBin)).toEqual(["cottontail.exe"]);
      expect(existsSync(join(f.stagedBin, "cottontail-stdlib", "ffi", "secret.txt")), "secret.txt never copied").toBe(false);
    });
  });

  test("a symlinked file inside cottontail-core throws before any write (skipped only on EPERM)", () => {
    withTemp("pinar-sync-neg-corefilelink-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI);
      const outsideFile = join(root, "core-secret.jsc");
      writeFileSync(outsideFile, "CORE-SECRET");
      let linkError: NodeJS.ErrnoException | null = null;
      try {
        symlinkSync(outsideFile, join(f.releaseBin, "cottontail-core", "evil.jsc"), "file");
      } catch (error) {
        linkError = error as NodeJS.ErrnoException;
      }
      if (linkError && linkError.code === "EPERM") {
        console.log(`(skip) symlink(..., "file") not permitted on this host: ${linkError.code} ${linkError.message}`);
        return;
      }
      if (linkError) throw new Error(`unexpected symlink failure: ${linkError.code} ${linkError.message}`);
      const message = thrownMessage(() => runSync(f));
      expect(message).toContain("symbolic link");
      expect(readdirSync(f.stagedBin)).toEqual(["cottontail.exe"]);
    });
  });

  test("a junction dir inside cottontail-core pointing outside throws before any write and copies nothing", () => {
    withTemp("pinar-sync-neg-corejunction-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI);
      const outside = join(root, "core-outside");
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "secret.txt"), "CORE-SECRET");
      let linkError: NodeJS.ErrnoException | null = null;
      try {
        symlinkSync(outside, join(f.releaseBin, "cottontail-core", "evil"), "junction");
      } catch (error) {
        linkError = error as NodeJS.ErrnoException;
      }
      if (linkError && linkError.code === "EPERM" && process.platform !== "win32") {
        console.log(`(skip) symlink creation not permitted on this host: ${linkError.code} ${linkError.message}`);
        return;
      }
      if (linkError) throw new Error(`unexpected link failure: ${linkError.code} ${linkError.message}`);
      const message = thrownMessage(() => runSync(f));
      expect(message).toContain("symbolic link");
      expect(readdirSync(f.stagedBin)).toEqual(["cottontail.exe"]);
      expect(existsSync(join(f.stagedBin, "cottontail-core")), "no cottontail-core at dest").toBe(false);
      expect(readdirSync(outside), "the outside dir keeps its single secret").toEqual(["secret.txt"]);
    });
  });

  test("a junction pre-existing at a planned destination path is rejected before any write", () => {
    withTemp("pinar-sync-neg-destjunction-", (root) => {
      if (process.platform !== "win32") {
        console.log(`(skip) the destination-junction test needs a win32 host (host: ${process.platform})`);
        return;
      }
      const f = fixture(root, "win32", CAPS_FFI);
      const outside = join(root, "dest-outside");
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "junk.txt"), "JUNK");
      symlinkSync(outside, join(f.stagedBin, "cottontail-core"), "junction"); // pre-existing dest entry is a link
      const message = thrownMessage(() => runSync(f));
      expect(message).toContain("symbolic link");
      expect([...readdirSync(f.stagedBin)].sort()).toEqual(["cottontail-core", "cottontail.exe"]);
      expect(existsSync(join(f.stagedBin, "cottontail-stdlib")), "no cottontail-stdlib at dest").toBe(false);
      expect(existsSync(join(outside, "host-bootstrap.jsc")), "nothing written through the link").toBe(false);
    });
  });

  test("re-syncing an already staged tree is idempotent (existing regular files are replaced, not rejected)", () => {
    withTemp("pinar-sync-ok-rerun-", (root) => {
      const f = fixture(root, "win32", CAPS_FFI_COMPRESSION);
      const first = runSync(f);
      expect(first).toBe(`ok (synced Cottontail ${VERSION}: cottontail-core/, capabilities.json, ffi, compression)`);
      const second = runSync(f);
      expect(second).toBe(first);
      assertCoreAndCatalog(f);
      assertCopiedCaps(f, ["ffi", "compression"]);
    });
  });

  test("verifyTreeEqual throws on a same-size byte swap after the copy and passes on the control copy", () => {
    withTemp("pinar-sync-neg-swap-", (root) => {
      const source = join(root, "src");
      const dest = join(root, "dest");
      mkdirSync(join(source, "sub"), { recursive: true });
      writeFileSync(join(source, "a.txt"), "AAAA");
      writeFileSync(join(source, "sub", "b.txt"), "00000000");
      mkdirSync(join(dest, "sub"), { recursive: true });
      copyFileSync(join(source, "a.txt"), join(dest, "a.txt"));
      copyFileSync(join(source, "sub", "b.txt"), join(dest, "sub", "b.txt"));
      expect(() => verifyTreeEqual(source, dest), "control: an identical copy passes").not.toThrow();
      writeFileSync(join(dest, "a.txt"), "BBBB"); // same size, different bytes
      const message = thrownMessage(() => verifyTreeEqual(source, dest));
      expect(message).toContain("SHA-256");
      writeFileSync(join(dest, "a.txt"), "AAAA"); // restore the control
      expect(() => verifyTreeEqual(source, dest), "control restored: passes again").not.toThrow();
    });
  });

  test("verifyTreeEqual re-walks the destination with lstat and fails on a link in it", () => {
    withTemp("pinar-sync-neg-verifylink-", (root) => {
      const source = join(root, "src");
      const dest = join(root, "dest");
      const outside = join(root, "outside");
      mkdirSync(source, { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(source, "a.txt"), "AAAA");
      writeFileSync(join(outside, "secret.txt"), "SECRET");
      mkdirSync(dest, { recursive: true });
      copyFileSync(join(source, "a.txt"), join(dest, "a.txt"));
      rmSync(join(dest, "a.txt"));
      let linkError: NodeJS.ErrnoException | null = null;
      try {
        symlinkSync(outside, join(dest, "a.txt"), process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        linkError = error as NodeJS.ErrnoException;
      }
      if (linkError && linkError.code === "EPERM") {
        console.log(`(skip) symlink creation not permitted on this host: ${linkError.code} ${linkError.message}`);
        return;
      }
      if (linkError) throw new Error(`unexpected link failure: ${linkError.code} ${linkError.message}`);
      const message = thrownMessage(() => verifyTreeEqual(source, dest));
      expect(message).toContain("symbolic link");
    });
  });
});

describe("syncCottontailRuntime reserved catalog name and case collisions (SY-2)", () => {
  function assertStagedTreeUntouched(f: Fixture, sentinel: string): void {
    // The staged dest root must have NO new entries at all.
    expect(readdirSync(f.stagedBin)).toEqual(f.platform === "win32" ? ["cottontail.exe"] : ["cottontail"]);
    expect(existsSync(join(f.stagedBin, "cottontail-core")), "no cottontail-core").toBe(false);
    expect(existsSync(join(f.stagedBin, "cottontail-stdlib")), "no cottontail-stdlib").toBe(false);
    expect(existsSync(join(f.stagedBin, "capabilities.json")), "no capabilities.json at dest root").toBe(false);
    // And nothing may have been written outside the staged tree.
    expect(readdirSync(sentinel).length, "sentinel sibling dir stays empty").toBe(0);
  }

  test("a requested name equal to capabilities.json (any case) throws before any write", () => {
    for (const name of ["capabilities.json", "CAPABILITIES.JSON", "Capabilities.Json"]) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]/gi, "_");
      withTemp(`pinar-sync-neg-reserved-${slug}-`, (root) => {
        const sentinel = join(root, "sentinel");
        mkdirSync(sentinel, { recursive: true });
        const f = fixture(root, "win32", capsConfig(["ffi", name]), {
          releaseOpts: {
            catalog: {
              schema: 1,
              capabilities: { ffi: { requires: [] }, [name]: { requires: [] } },
            },
          },
        });
        const message = thrownMessage(() => runSync(f));
        expect(message).toContain("reserved");
        expect(message).toContain(JSON.stringify(name));
        expect(message).toContain("capabilities.json");
        assertStagedTreeUntouched(f, sentinel);
      });
    }
  });

  test("a transitive name equal to capabilities.json (any case) throws before any write", () => {
    withTemp("pinar-sync-neg-reserved-transitive-", (root) => {
      const sentinel = join(root, "sentinel");
      mkdirSync(sentinel, { recursive: true });
      const f = fixture(root, "win32", CAPS_FFI, {
        releaseOpts: {
          catalog: {
            schema: 1,
            capabilities: {
              ffi: { requires: ["Capabilities.Json"] },
              "Capabilities.Json": { requires: [] },
            },
          },
        },
      });
      const message = thrownMessage(() => runSync(f));
      expect(message).toContain("reserved");
      expect(message).toContain(`in "ffi".requires of the`);
      assertStagedTreeUntouched(f, sentinel);
    });
  });

  test("two requested names equal case-insensitively (ffi + FFI) throw before any write", () => {
    withTemp("pinar-sync-neg-casecollide-requested-", (root) => {
      const sentinel = join(root, "sentinel");
      mkdirSync(sentinel, { recursive: true });
      const f = fixture(root, "win32", capsConfig(["ffi", "FFI"]), {
        releaseOpts: { catalog: { schema: 1, capabilities: { ffi: { requires: [] }, FFI: { requires: [] } } } },
      });
      const message = thrownMessage(() => runSync(f));
      expect(message).toContain("collides");
      expect(message).toContain(JSON.stringify("ffi"));
      expect(message).toContain(JSON.stringify("FFI"));
      assertStagedTreeUntouched(f, sentinel);
    });
  });

  test("a transitive name colliding case-insensitively with a requested one (FFI after ffi) throws before any write", () => {
    withTemp("pinar-sync-neg-casecollide-transitive-", (root) => {
      const sentinel = join(root, "sentinel");
      mkdirSync(sentinel, { recursive: true });
      const f = fixture(root, "win32", CAPS_FFI, {
        releaseOpts: { catalog: { schema: 1, capabilities: { ffi: { requires: ["FFI"] }, FFI: { requires: [] } } } },
      });
      const message = thrownMessage(() => runSync(f));
      expect(message).toContain("collides");
      expect(message).toContain(`in "ffi".requires of the`);
      assertStagedTreeUntouched(f, sentinel);
    });
  });

  test("an exact-case duplicate name still resolves once (no false positive from the case check)", () => {
    withTemp("pinar-sync-ok-exactdup-", (root) => {
      const f = fixture(root, "win32", capsConfig(["ffi", "ffi"]), {
        releaseOpts: { catalog: { schema: 1, capabilities: { ffi: { requires: ["ffi"] } } } },
      });
      expect(runSync(f)).toBe(`ok (synced Cottontail ${VERSION}: cottontail-core/, capabilities.json, ffi)`);
    });
  });

  test("trailing-dot, trailing-space and 8.3-style (tilde) names still throw before any write", () => {
    for (const name of ["ffi.", "ffi ", "ffi~1"]) {
      const slug = name.replace(/[^a-z0-9]/gi, "_");
      withTemp(`pinar-sync-neg-legacy-${slug}-`, (root) => {
        const sentinel = join(root, "sentinel");
        mkdirSync(sentinel, { recursive: true });
        const f = fixture(root, "win32", capsConfig(["ffi", name]), {
          releaseOpts: { catalog: { schema: 1, capabilities: { ffi: { requires: [] }, [name]: { requires: [] } } } },
        });
        const message = thrownMessage(() => runSync(f));
        expect(message).toContain(`invalid Cottontail capability name ${JSON.stringify(name)}`);
        assertStagedTreeUntouched(f, sentinel);
      });
    }
  });
});
