import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  clearServerPid,
  findListeningPid,
  isPidAlive,
  pidPath,
  readServerPid,
  stopPid,
  writeServerPid,
} from "./process.mjs";

describe("process", () => {
  test("pid file round-trips under PINAR_HOME", async () => {
    const root = await mkdtemp(join(tmpdir(), "pinar-pid-"));
    assert.equal(pidPath(root), join(root, "server.pid"));
    assert.equal(await readServerPid(root), null);
    await writeServerPid(4242, root);
    assert.equal(await readServerPid(root), 4242);
    await clearServerPid(root);
    assert.equal(await readServerPid(root), null);
    await clearServerPid(root);
  });

  test("stopPid terminates a living child", async () => {
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    assert.equal(isPidAlive(child.pid), true);
    assert.equal(await stopPid(child.pid), "stopped");
    assert.equal(isPidAlive(child.pid), false);
  });

  test("stopPid reports already_stopped for a dead pid", async () => {
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    process.kill(child.pid, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await stopPid(child.pid), "already_stopped");
  });

  test("findListeningPid parses lsof output", async () => {
    const pid = await findListeningPid(17373, async () => "18841\n");
    assert.equal(pid, 18841);
  });
});
