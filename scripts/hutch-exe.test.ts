import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { hutchExecutableName, resolveHutchExecutable } from "./hutch-exe.mjs";

function withTemp<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "hutch-exe-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("resolveHutchExecutable", () => {
  test("returns the absolute hutch.exe from the first absolute PATH entry on win32", () => {
    const files = new Set(["C:\\tools\\hutch\\bin\\hutch.exe", "C:\\other\\hutch.exe"]);
    const found = resolveHutchExecutable({
      env: { Path: "C:\\nothing;C:\\tools\\hutch\\bin;C:\\other" },
      platform: "win32",
      isFile: (path: string) => files.has(path),
    });
    expect(found).toBe("C:\\tools\\hutch\\bin\\hutch.exe");
  });

  test("win32 falls back to the uppercase PATH variable when Path is missing", () => {
    const files = new Set(["C:\\up\\hutch.exe"]);
    const found = resolveHutchExecutable({
      env: { PATH: "C:\\up" },
      platform: "win32",
      isFile: (path: string) => files.has(path),
    });
    expect(found).toBe("C:\\up\\hutch.exe");
  });

  test("skips empty, '.', and relative PATH entries (the working directory is never searched)", () => {
    const seen: string[] = [];
    expect(() =>
      resolveHutchExecutable({
        env: { Path: ";.;bin;.\\tools;C:tools" },
        platform: "win32",
        isFile: (path: string) => {
          seen.push(path);
          return true;
        },
      }),
    ).toThrow(/no hutch\.exe in an absolute PATH entry/);
    expect(seen).toEqual([]);
  });

  test("never resolves a .cmd or .bat shim on win32", () => {
    const files = new Set(["C:\\shim\\hutch.cmd", "C:\\shim\\hutch.bat"]);
    expect(() =>
      resolveHutchExecutable({
        env: { Path: "C:\\shim" },
        platform: "win32",
        isFile: (path: string) => files.has(path),
      }),
    ).toThrow(/no hutch\.exe/);
  });

  test("strips quotes around a win32 PATH entry", () => {
    const files = new Set(["C:\\Program Files\\Hutch\\bin\\hutch.exe"]);
    const found = resolveHutchExecutable({
      env: { Path: '"C:\\Program Files\\Hutch\\bin"' },
      platform: "win32",
      isFile: (path: string) => files.has(path),
    });
    expect(found).toBe("C:\\Program Files\\Hutch\\bin\\hutch.exe");
  });

  test("resolves a POSIX hutch from an absolute PATH entry and ignores relative ones", () => {
    const files = new Set(["/home/u/.hutch/bin/hutch", "bin/hutch"]);
    const found = resolveHutchExecutable({
      env: { PATH: "bin:/usr/bin:/home/u/.hutch/bin" },
      platform: "darwin",
      isFile: (path: string) => files.has(path),
    });
    expect(found).toBe("/home/u/.hutch/bin/hutch");
  });

  test("a planted hutch in the working directory is not used (real filesystem)", () => {
    withTemp((root) => {
      const cwdDir = join(root, "cwd");
      const binDir = join(root, "installed", "bin");
      mkdirSync(cwdDir, { recursive: true });
      mkdirSync(binDir, { recursive: true });
      const name = hutchExecutableName(process.platform);
      writeFileSync(join(cwdDir, name), "planted");
      writeFileSync(join(binDir, name), "installed");
      const env = process.platform === "win32" ? { Path: `.;${binDir}` } : { PATH: `.:${binDir}` };
      expect(resolveHutchExecutable({ env })).toBe(join(binDir, name));
    });
  });
});
