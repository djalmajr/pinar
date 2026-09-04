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
  parseNetstatListeningPid,
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
    if (process.platform === "win32") return;
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    assert.equal(isPidAlive(child.pid), true);
    assert.equal(await stopPid(child.pid), "stopped");
    assert.equal(isPidAlive(child.pid), false);
  });

  test("stopPid reports already_stopped for a dead pid", async () => {
    if (process.platform === "win32") return;
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    process.kill(child.pid, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await stopPid(child.pid), "already_stopped");
  });

  test("findListeningPid parses lsof output", async () => {
    const pid = await findListeningPid(17373, async () => "18841\n", "linux");
    assert.equal(pid, 18841);
  });

  test("findListeningPid parses netstat output on Windows", async () => {
    const stdout = "  TCP    127.0.0.1:17373        0.0.0.0:0              LISTENING       41156\r\n";
    const pid = await findListeningPid(17373, async () => stdout, "win32");
    assert.equal(pid, 41156);
  });

  test("parseNetstatListeningPid reads the LISTENING pid", () => {
    const stdout = "  TCP    127.0.0.1:17373        0.0.0.0:0              LISTENING       41156\r\n";
    assert.equal(parseNetstatListeningPid(stdout, 17373), 41156);
    assert.equal(parseNetstatListeningPid(stdout, 80), null);
  });
});
