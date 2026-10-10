import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  assertHutchMatchesPin,
  parseHutchVersionOutput,
  readHutchCliPin,
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

  test("returns null without the pin line", () => {
    expect(readHutchCliPin(NO_PIN_CONFIG)).toBe(null);
  });

  test("reads a pin with extra spaces", () => {
    expect(readHutchCliPin("//   @hutch   cli=0.9.9\nexport default {};")).toBe("0.9.9");
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
});

describe("assertHutchMatchesPin (injected spawnSync)", () => {
  test("match -> returns version and spawn got cwd === trayDir", () => {
    withTemp("pinar-hutchpin-match-", (root) => {
      const trayDir = writeTray(root, PIN_CONFIG);
      let seenCwd: string | undefined;
      const spawnSync = (_: string, __: string[], options?: { cwd?: string }) => {
        seenCwd = options?.cwd;
        return { status: 0, stdout: "0.25.0\n", stderr: "" };
      };
      expect(assertHutchMatchesPin({ trayDir, spawnSync })).toBe("0.25.0");
      expect(seenCwd).toBe(trayDir);
    });
  });

  test("mismatch (0.27.1) -> throws the exact message shape", () => {
    withTemp("pinar-hutchpin-mismatch-", (root) => {
      const trayDir = writeTray(root, PIN_CONFIG);
      const spawnSync = () => ({ status: 0, stdout: "0.27.1\n", stderr: "" });
      const err = () => assertHutchMatchesPin({ trayDir, spawnSync });
      expect(err).toThrow(
        `run-tray: Hutch 0.27.1 does not match the project pin 0.25.0 in ${join(trayDir, "hutch.config.ts")}; install or select Hutch 0.25.0`,
      );
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
      const err = () => assertHutchMatchesPin({ trayDir, spawnSync });
      expect(err).toThrow(`run-tray: ${join(trayDir, "hutch.config.ts")} has no "// @hutch cli=<version>" pin`);
      expect(spawned).toBe(false);
    });
  });

  test("nonzero exit -> throws", () => {
    withTemp("pinar-hutchpin-nonzero-", (root) => {
      const trayDir = writeTray(root, PIN_CONFIG);
      const spawnSync = () => ({ status: 1, stdout: "", stderr: "boom" });
      const err = () => assertHutchMatchesPin({ trayDir, spawnSync });
      expect(err).toThrow(/hutch --version failed/);
    });
  });

  test("no parsable output -> throws", () => {
    withTemp("pinar-hutchpin-nooutput-", (root) => {
      const trayDir = writeTray(root, PIN_CONFIG);
      const spawnSync = () => ({ status: 0, stdout: "", stderr: "" });
      const err = () => assertHutchMatchesPin({ trayDir, spawnSync });
      expect(err).toThrow(/no parsable version/);
    });
  });
});

// Real subprocess of scripts/run-tray.mjs build with a fake `hutch` first on
// PATH. The fake appends its argv to $LOGFILE and prints a version from
// $HUTCH_FAKE_VERSION. Bounded timeout per subprocess (30 s).
function makeFakeHutch(dir: string): void {
  if (process.platform === "win32") {
    const cmd = ["@echo off", '>> "%LOGFILE%" echo %*', "echo %HUTCH_FAKE_VERSION%"].join("\r\n") + "\r\n";
    writeFileSync(join(dir, "hutch.cmd"), cmd);
  } else {
    const sh = "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$LOGFILE\"\nprintf '%s\\n' \"$HUTCH_FAKE_VERSION\"\n";
    writeFileSync(join(dir, "hutch"), sh);
    chmodSync(join(dir, "hutch"), 0o755);
  }
}

function runTrayBuild(fakeDir: string, logFile: string, version: string) {
  const repoRoot = join(import.meta.dir, "..");
  return spawnSync(process.execPath, [join(import.meta.dir, "run-tray.mjs"), "build"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30000,
    env: {
      ...process.env,
      PATH: `${fakeDir}${delimiter}${process.env.PATH}`,
      LOGFILE: logFile,
      HUTCH_FAKE_VERSION: version,
    },
  });
}

describe("run-tray.mjs build (real subprocess, fake hutch on PATH)", () => {
  test("fake reports 0.27.1 -> exit 1, mismatch on stderr, only --version logged (no electrobun build)", () => {
    withTemp("pinar-hutchpin-subproc-mismatch-", (root) => {
      const fakeDir = join(root, "fakebin");
      mkdirSync(fakeDir, { recursive: true });
      makeFakeHutch(fakeDir);
      const logFile = join(root, "hutch-calls.log");
      const result = runTrayBuild(fakeDir, logFile, "0.27.1");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Hutch 0.27.1 does not match the project pin 0.25.0");
      const log = readFileSync(logFile, "utf8");
      expect(log).toContain("--version");
      expect(log).not.toContain("electrobun");
    });
  });

  test("fake reports 0.25.0 -> exit 0, --version then electrobun build --env=stable logged", () => {
    withTemp("pinar-hutchpin-subproc-match-", (root) => {
      const fakeDir = join(root, "fakebin");
      mkdirSync(fakeDir, { recursive: true });
      makeFakeHutch(fakeDir);
      const logFile = join(root, "hutch-calls.log");
      const result = runTrayBuild(fakeDir, logFile, "0.25.0");
      expect(result.status).toBe(0);
      const log = readFileSync(logFile, "utf8");
      expect(log.indexOf("--version")).toBeGreaterThanOrEqual(0);
      expect(log).toContain("electrobun build --env=stable");
      expect(log.indexOf("--version")).toBeLessThan(log.indexOf("electrobun build --env=stable"));
    });
  });
});
