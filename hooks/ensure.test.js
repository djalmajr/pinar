import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { describe, test } from "node:test";
import { darwinOpenArgs, pinarLauncher, runEnsure } from "./ensure.mjs";

describe("ensure", () => {
  test("Windows prefers pinar.exe then pinar.cmd", () => {
    const exe = pinarLauncher("C:\\pinar", "win32");
    assert.equal(exe.args[0], "ensure");
    assert.match(exe.bin, /pinar\.(exe|cmd)$/);
  });

  test("Unix launches bin/pinar ensure", () => {
    const unix = pinarLauncher("/opt/pinar", "linux");
    assert.equal(unix.bin, join("/opt/pinar", "bin", "pinar"));
    assert.deepEqual(unix.args, ["ensure"]);
    assert.equal(unix.shell, false);
  });

  test("Darwin open targets Applications/Pinar.app when the folder exists", () => {
    const open = darwinOpenArgs("/nonexistent-pinar-home");
    assert.equal(open.bin, "/usr/bin/open");
    assert.equal(open.args[0], "-ga");
  });

  test("runEnsure returns the child exit code", async () => {
    const child = new EventEmitter();
    const code = await runEnsure({
      drain: async () => {},
      platform: "linux",
      root: "/opt/pinar",
      spawnFn: () => {
        queueMicrotask(() => child.emit("close", 0));
        return child;
      },
    });
    assert.equal(code, 0);
  });
});
