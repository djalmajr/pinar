import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hutchExecutableName, resolveHutchExecutable } from "./hutch-exe.mjs";
import {
  assertHutchMatchesPin,
  parseHutchVersionOutput,
  readHutchCliPin,
  readHutchCottontailPin,
} from "./hutch-pin.mjs";

function withTemp<T>(prefix: string, fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const PIN_CONFIG = `// @hutch cli=0.25.0
export default {
	electrobun: {
		version: "2.0.3-beta.11",
	},
};
`;
const BOTH_PIN_CONFIG = `// @hutch cli=0.25.0 cottontail=0.7.2-canary.6
export default {
	electrobun: {
		version: "2.0.3-beta.11",
	},
};
`;
const NO_PIN_CONFIG = `export default {
	electrobun: {
		version: "2.0.3-beta.11",
	},
};
`;

function writeTray(root: string, config: string): string {
  const trayDir = join(root, "tray");
  mkdirSync(trayDir, { recursive: true });
  writeFileSync(join(trayDir, "hutch.config.ts"), config);
  return trayDir;
}

describe("readHutchCliPin", () => {
  test("reads the real apps/tray/hutch.config.ts -> 0.25.0", () => {
    const text = readFileSync(join(import.meta.dir, "..", "apps", "tray", "hutch.config.ts"), "utf8");
    expect(readHutchCliPin(text)).toBe("0.25.0");
  });

  test("reads cli= from a marker line with a second cottontail= key", () => {
    expect(readHutchCliPin("// @hutch cli=0.25.0 cottontail=0.7.2-canary.6\nexport default {};")).toBe("0.25.0");
  });

  test("returns null without the pin line", () => {
    expect(readHutchCliPin(NO_PIN_CONFIG)).toBe(null);
  });

  test("returns null when only a cottontail pin is present", () => {
    expect(readHutchCliPin("// @hutch cottontail=0.7.2-canary.6\nexport default {};")).toBe(null);
  });

  test("reads a pin with extra spaces", () => {
    expect(readHutchCliPin("//   @hutch   cli=0.9.9\nexport default {};")).toBe("0.9.9");
  });
});

describe("readHutchCottontailPin", () => {
  test("reads the real apps/tray/hutch.config.ts -> 0.7.2-canary.6", () => {
    const text = readFileSync(join(import.meta.dir, "..", "apps", "tray", "hutch.config.ts"), "utf8");
    expect(readHutchCottontailPin(text)).toBe("0.7.2-canary.6");
  });

  test("reads the cottontail key next to cli=", () => {
    expect(readHutchCottontailPin("// @hutch cli=0.25.0 cottontail=0.7.2-canary.6\nexport default {};")).toBe(
      "0.7.2-canary.6",
    );
  });

  test("returns null when only a cli pin is present", () => {
    expect(readHutchCottontailPin(PIN_CONFIG)).toBe(null);
  });
});

describe("parseHutchVersionOutput", () => {
  test("parses a bare version", () => {
    expect(parseHutchVersionOutput("0.25.0\n")).toBe("0.25.0");
  });

  test("parses 'hutch 0.25.0'", () => {
    expect(parseHutchVersionOutput("hutch 0.25.0\n")).toBe("0.25.0");
  });

  test("ignores download noise lines before it (last non-empty line wins)", () => {
    expect(parseHutchVersionOutput("hutch: downloading hutch 0.27.1 for windows-x64\n0.25.0\n")).toBe("0.25.0");
  });

  test("handles CRLF", () => {
    expect(parseHutchVersionOutput("noise\r\n0.25.0\r\n")).toBe("0.25.0");
  });

  test("returns null for empty or unparsable output", () => {
    expect(parseHutchVersionOutput("")).toBe(null);
    expect(parseHutchVersionOutput("no version here\n")).toBe(null);
  });

  test("parses a canary version with a dot in the suffix", () => {
    expect(parseHutchVersionOutput("0.7.2-canary.6\n")).toBe("0.7.2-canary.6");
  });
});

describe("assertHutchMatchesPin (injected spawnSync)", () => {
  const RESOLVED = process.platform === "win32" ? "C:\\hutch\\bin\\hutch.exe" : "/home/u/.hutch/bin/hutch";

  test("match -> returns version, spawn got the resolved absolute argv0, shell false, cwd === trayDir", () => {
    withTemp("pinar-hutchpin-match-", (root) => {
      const trayDir = writeTray(root, PIN_CONFIG);
      let seenArgv0: string | undefined;
      let seenShell: unknown;
      let seenCwd: string | undefined;
      const spawnSync = (argv0: string, _args: string[], options?: { cwd?: string; shell?: unknown }) => {
        seenArgv0 = argv0;
        seenShell = options?.shell;
        seenCwd = options?.cwd;
        return { status: 0, stdout: "0.25.0\n", stderr: "" };
      };
      expect(assertHutchMatchesPin({ trayDir, spawnSync, resolve: () => RESOLVED })).toBe("0.25.0");
      expect(seenArgv0).toBe(RESOLVED);
      expect(isAbsolute(seenArgv0!)).toBe(true);
      expect(seenShell).toBe(false);
      expect(seenCwd).toBe(trayDir);
    });
  });

  test("both pins -> hutch --version then hutch cottontail version <pin>, both shell false", () => {
    withTemp("pinar-hutchpin-bothpins-", (root) => {
      const trayDir = writeTray(root, BOTH_PIN_CONFIG);
      const calls: { argv0: string; args: string[]; shell: unknown; cwd?: string }[] = [];
      const spawnSync = (argv0: string, args: string[], options?: { cwd?: string; shell?: unknown }) => {
        calls.push({ argv0, args, shell: options?.shell, cwd: options?.cwd });
        return { status: 0, stdout: args[0] === "--version" ? "0.25.0\n" : "0.7.2-canary.6\n", stderr: "" };
      };
      expect(assertHutchMatchesPin({ trayDir, spawnSync, resolve: () => RESOLVED })).toBe("0.25.0");
      expect(calls.map((call) => call.args)).toEqual([["--version"], ["cottontail", "version", "0.7.2-canary.6"]]);
      for (const call of calls) {
        expect(call.argv0).toBe(RESOLVED);
        expect(call.shell).toBe(false);
        expect(call.cwd).toBe(trayDir);
      }
    });
  });

  test("mismatch (0.27.1) -> throws the exact message shape", () => {
    withTemp("pinar-hutchpin-mismatch-", (root) => {
      const trayDir = writeTray(root, PIN_CONFIG);
      const spawnSync = () => ({ status: 0, stdout: "0.27.1\n", stderr: "" });
      const err = () => assertHutchMatchesPin({ trayDir, spawnSync, resolve: () => RESOLVED });
      expect(err).toThrow(
        `run-tray: Hutch 0.27.1 does not match the project pin 0.25.0 in ${join(trayDir, "hutch.config.ts")}; install or select Hutch 0.25.0`,
      );
    });
  });

  test("cottontail mismatch (0.5.0) -> throws the exact message shape", () => {
    withTemp("pinar-hutchpin-cottontail-mismatch-", (root) => {
      const trayDir = writeTray(root, BOTH_PIN_CONFIG);
      const spawnSync = (_: string, args: string[]) =>
        ({ status: 0, stdout: args[0] === "--version" ? "0.25.0\n" : "0.5.0\n", stderr: "" });
      const err = () => assertHutchMatchesPin({ trayDir, spawnSync, resolve: () => RESOLVED });
      expect(err).toThrow(
        `run-tray: Hutch cottontail 0.5.0 does not match the project pin 0.7.2-canary.6 in ${join(trayDir, "hutch.config.ts")}; install or select Hutch cottontail 0.7.2-canary.6`,
      );
    });
  });

  test("cottontail version check fails -> throws", () => {
    withTemp("pinar-hutchpin-cottontail-fail-", (root) => {
      const trayDir = writeTray(root, BOTH_PIN_CONFIG);
      const spawnSync = (_: string, args: string[]) =>
        args[0] === "--version"
          ? { status: 0, stdout: "0.25.0\n", stderr: "" }
          : { status: 1, stdout: "", stderr: "boom" };
      const err = () => assertHutchMatchesPin({ trayDir, spawnSync, resolve: () => RESOLVED });
      expect(err).toThrow(
        /cannot read the Hutch Cottontail version in .+: hutch cottontail version 0\.7\.2-canary\.6 failed/,
      );
    });
  });

  test("resolver throws -> run-tray: error and spawn not called", () => {
    withTemp("pinar-hutchpin-resolve-", (root) => {
      const trayDir = writeTray(root, PIN_CONFIG);
      let spawned = false;
      const spawnSync = () => {
        spawned = true;
        return { status: 0, stdout: "0.25.0\n", stderr: "" };
      };
      const err = () =>
        assertHutchMatchesPin({
          trayDir,
          spawnSync,
          resolve: () => {
            throw new Error("no hutch.exe in an absolute PATH entry");
          },
        });
      expect(err).toThrow("run-tray: cannot resolve the Hutch executable: no hutch.exe in an absolute PATH entry");
      expect(spawned).toBe(false);
    });
  });

  test("missing pin -> throws (does not spawn)", () => {
    withTemp("pinar-hutchpin-nopin-", (root) => {
      const trayDir = writeTray(root, NO_PIN_CONFIG);
      let spawned = false;
      const spawnSync = () => {
        spawned = true;
        return { status: 0, stdout: "0.25.0\n", stderr: "" };
      };
      const err = () => assertHutchMatchesPin({ trayDir, spawnSync, resolve: () => RESOLVED });
      expect(err).toThrow(`run-tray: ${join(trayDir, "hutch.config.ts")} has no "// @hutch cli=<version>" pin`);
      expect(spawned).toBe(false);
    });
  });

  test("nonzero exit -> throws", () => {
    withTemp("pinar-hutchpin-nonzero-", (root) => {
      const trayDir = writeTray(root, PIN_CONFIG);
      const spawnSync = () => ({ status: 1, stdout: "", stderr: "boom" });
      const err = () => assertHutchMatchesPin({ trayDir, spawnSync, resolve: () => RESOLVED });
      expect(err).toThrow(/hutch --version failed/);
    });
  });

  test("spawn returns { error } (ENOENT) -> run-tray: message with spawn error, not a ReferenceError", () => {
    withTemp("pinar-hutchpin-enent-", (root) => {
      const trayDir = writeTray(root, PIN_CONFIG);
      let caught: unknown;
      const spawnSync = () => ({ status: null, error: new Error("spawn hutch ENOENT"), stdout: "", stderr: "" });
      try {
        assertHutchMatchesPin({ trayDir, spawnSync, resolve: () => RESOLVED });
      } catch (error) {
        caught = error;
      }
      expect(caught, "expected a throw").toBeDefined();
      expect(caught, "expected the run-tray: error, not a ReferenceError").not.toBeInstanceOf(ReferenceError);
      const message = (caught as Error).message;
      expect(message).toContain(`run-tray: cannot read the Hutch version in ${trayDir}: hutch --version failed`);
      expect(message).toContain("exit status n/a, spawn error: spawn hutch ENOENT");
    });
  });

  test("cottontail step spawn returns { error } -> run-tray: Cottontail message with spawn error, not a ReferenceError", () => {
    withTemp("pinar-hutchpin-cottontail-enent-", (root) => {
      const trayDir = writeTray(root, BOTH_PIN_CONFIG);
      let caught: unknown;
      const spawnSync = (_: string, args: string[]) =>
        args[0] === "--version"
          ? { status: 0, stdout: "0.25.0\n", stderr: "" }
          : { status: null, error: new Error("spawn hutch ENOENT"), stdout: "", stderr: "" };
      try {
        assertHutchMatchesPin({ trayDir, spawnSync, resolve: () => RESOLVED });
      } catch (error) {
        caught = error;
      }
      expect(caught, "expected a throw").toBeDefined();
      expect(caught, "expected the run-tray: error, not a ReferenceError").not.toBeInstanceOf(ReferenceError);
      const message = (caught as Error).message;
      expect(message).toContain(
        `run-tray: cannot read the Hutch Cottontail version in ${trayDir}: hutch cottontail version 0.7.2-canary.6 failed`,
      );
      expect(message).toContain("exit status n/a, spawn error: spawn hutch ENOENT");
    });
  });

  test("no parsable output -> throws", () => {
    withTemp("pinar-hutchpin-nooutput-", (root) => {
      const trayDir = writeTray(root, PIN_CONFIG);
      const spawnSync = () => ({ status: 0, stdout: "", stderr: "" });
      const err = () => assertHutchMatchesPin({ trayDir, spawnSync, resolve: () => RESOLVED });
      expect(err).toThrow(/no parsable version/);
    });
  });
});

describe("assertHutchMatchesPin (real filesystem, real resolver)", () => {
  test("a planted hutch.cmd + hutch.exe in the trayDir is never the executable", () => {
    withTemp("pinar-hutchpin-planted-", (root) => {
      const trayDir = writeTray(root, PIN_CONFIG);
      const binDir = join(root, "bin");
      mkdirSync(binDir, { recursive: true });
      // Plant look-alikes in the working directory (the tray dir).
      const plantedExe = join(trayDir, hutchExecutableName(process.platform));
      writeFileSync(plantedExe, "planted");
      if (process.platform === "win32") {
        writeFileSync(join(trayDir, "hutch.cmd"), "@echo off\r\n");
        writeFileSync(join(trayDir, "hutch.bat"), "@echo off\r\n");
      } else {
        chmodSync(plantedExe, 0o755);
      }
      // The installed (dummy) executable lives in an absolute PATH entry.
      const installedExe = join(binDir, hutchExecutableName(process.platform));
      writeFileSync(installedExe, "installed");
      const env = { [process.platform === "win32" ? "Path" : "PATH"]: `.;${binDir}` };
      let seenArgv0: string | undefined;
      let seenShell: unknown;
      const spawn = (argv0: string, _args: string[], options?: { shell?: unknown }) => {
        seenArgv0 = argv0;
        seenShell = options?.shell;
        return { status: 0, stdout: "0.25.0\n", stderr: "" };
      };
      expect(
        assertHutchMatchesPin({ trayDir, spawnSync: spawn, resolve: () => resolveHutchExecutable({ env }) }),
      ).toBe("0.25.0");
      expect(seenArgv0).toBe(installedExe);
      expect(seenArgv0).not.toBe(plantedExe);
      expect(isAbsolute(seenArgv0!)).toBe(true);
      expect(seenShell).toBe(false);
    });
  });
});

// Real subprocess of scripts/run-tray.mjs build with a fake `hutch` first on
// PATH. The fake appends its argv to $LOGFILE and prints versions from
// $HUTCH_FAKE_VERSION / $HUTCH_FAKE_COTTONTAIL_VERSION. On win32 the fake is
// a real PE executable (bun --compile): run-tray spawns the resolved absolute
// path with shell: false, so a .cmd/.bat shim would never run. Bounded
// timeout per subprocess (15 s).
function makeFakeHutch(binDir: string): void {
  if (process.platform === "win32") {
    const fixture = join(binDir, "fake-hutch.mjs");
    writeFileSync(
      fixture,
      [
        'import { appendFileSync } from "node:fs";',
        "const args = process.argv.slice(2);",
        'appendFileSync(process.env.LOGFILE, args.join(" ") + "\\n");',
        'console.log(args[0] === "--version" ? process.env.HUTCH_FAKE_VERSION : process.env.HUTCH_FAKE_COTTONTAIL_VERSION);',
        "",
      ].join("\n"),
    );
    execFileSync(process.execPath, ["build", "--compile", fixture, "--outfile", join(binDir, "hutch.exe")], {
      timeout: 120000,
    });
  } else {
    const sh =
      "#!/bin/sh\n" +
      'printf \'%s %s\\n\' "$0" "$*" >> "$LOGFILE"\n' +
      'if [ "$1" = "--version" ]; then printf \'%s\\n\' "$HUTCH_FAKE_VERSION"; else printf \'%s\\n\' "$HUTCH_FAKE_COTTONTAIL_VERSION"; fi\n';
    writeFileSync(join(binDir, "hutch"), sh);
    chmodSync(join(binDir, "hutch"), 0o755);
  }
}

describe("run-tray.mjs build (real subprocess, fake hutch on PATH)", () => {
  let root: string;
  let fakeDir: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "pinar-hutchpin-subproc-"));
    fakeDir = join(root, "fakebin");
    mkdirSync(fakeDir, { recursive: true });
    makeFakeHutch(fakeDir);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function runTrayBuild(logFile: string, version: string, cottontailVersion: string) {
    const repoRoot = join(import.meta.dir, "..");
    return spawnSync(process.execPath, [join(import.meta.dir, "run-tray.mjs"), "build"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        PATH: `${fakeDir}${delimiter}${process.env.PATH}`,
        LOGFILE: logFile,
        HUTCH_FAKE_VERSION: version,
        HUTCH_FAKE_COTTONTAIL_VERSION: cottontailVersion,
      },
    });
  }

  test("fake reports 0.27.1 -> exit 1, mismatch on stderr, only --version logged (no cottontail, no build)", () => {
    const logFile = join(root, "hutch-calls-mismatch.log");
    const result = runTrayBuild(logFile, "0.27.1", "0.7.2-canary.6");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Hutch 0.27.1 does not match the project pin 0.25.0");
    const log = readFileSync(logFile, "utf8");
    expect(log).toContain("--version");
    expect(log).not.toContain("cottontail");
    expect(log).not.toContain("electrobun");
  });

  test("fake reports the pins -> exit 0, --version then cottontail version then electrobun build --env=stable", () => {
    const logFile = join(root, "hutch-calls-match.log");
    const result = runTrayBuild(logFile, "0.25.0", "0.7.2-canary.6");
    expect(result.status).toBe(0);
    const log = readFileSync(logFile, "utf8");
    const versionIdx = log.indexOf("--version");
    const cottontailIdx = log.indexOf("cottontail version 0.7.2-canary.6");
    const buildIdx = log.indexOf("electrobun build --env=stable");
    expect(versionIdx).toBeGreaterThanOrEqual(0);
    expect(cottontailIdx).toBeGreaterThanOrEqual(0);
    expect(buildIdx).toBeGreaterThanOrEqual(0);
    expect(versionIdx).toBeLessThan(cottontailIdx);
    expect(cottontailIdx).toBeLessThan(buildIdx);
  });

  test("cli matches but fake reports cottontail 0.5.0 -> exit 1, cottontail mismatch, no build", () => {
    const logFile = join(root, "hutch-calls-cottontail-mismatch.log");
    const result = runTrayBuild(logFile, "0.25.0", "0.5.0");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Hutch cottontail 0.5.0 does not match the project pin 0.7.2-canary.6");
    const log = readFileSync(logFile, "utf8");
    expect(log).toContain("cottontail version 0.7.2-canary.6");
    expect(log).not.toContain("electrobun");
  });
});
