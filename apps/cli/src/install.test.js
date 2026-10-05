import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ensureUserPath, installApp, installPlatformHooks, launcherPath, removeLegacyDarwinBin, RUNTIME_SCRIPTS } from "./install.mjs";

const source = fileURLToPath(new URL("../../../", import.meta.url));

describe("install", () => {
  test("installApp copies the launcher and leaves shots alone", async () => {
    const dest = await mkdtemp(join(tmpdir(), "pinar-app-"));
    await mkdir(join(dest, "shots"), { recursive: true });
    await writeFile(join(dest, "shots", "keep.png"), "png");
    await writeFile(join(dest, "history.db"), "history");
    await writeFile(join(dest, "desktop.json"), '{"loginEnabled":true}\n');
    await writeFile(join(dest, "server.pid"), "4242\n");
    const result = await installApp({ source, dest, log: () => {}, platform: "darwin" });
    assert.equal(result.copied, true);
    assert.ok(existsSync(launcherPath(dest, "darwin")));
    assert.equal(existsSync(join(dest, "bin", "pinar.cmd")), false);
    assert.ok(existsSync(join(dest, "hooks", "ensure.mjs")));
    assert.equal(existsSync(join(dest, "src")), false);
    assert.ok(existsSync(join(dest, "hooks", "pinar.js")));
    assert.equal(existsSync(join(dest, "extension")), false);
    assert.equal(existsSync(join(dest, "AGENTS.md")), false);
    assert.equal(existsSync(join(dest, "package.json")), false);
    assert.equal(await readFile(join(dest, "shots", "keep.png"), "utf8"), "png");
    assert.equal(await readFile(join(dest, "history.db"), "utf8"), "history");
    assert.equal(await readFile(join(dest, "desktop.json"), "utf8"), '{"loginEnabled":true}\n');
    assert.equal(await readFile(join(dest, "server.pid"), "utf8"), "4242\n");
  });

  test("installApp replaces managed dirs and drops leftover top-level files", async () => {
    const dest = await mkdtemp(join(tmpdir(), "pinar-prune-"));
    await mkdir(join(dest, "shots"), { recursive: true });
    await mkdir(join(dest, "src"), { recursive: true });
    await mkdir(join(dest, "legacy"), { recursive: true });
    await writeFile(join(dest, "shots", "keep.png"), "png");
    await writeFile(join(dest, "helper.json"), '{"port":17373}\n');
    await writeFile(join(dest, "AGENTS.md"), "old\n");
    await writeFile(join(dest, "package.json"), "{}\n");
    await writeFile(join(dest, "src", "old.js"), "stale\n");
    await writeFile(join(dest, "legacy", "gone.txt"), "x\n");
    const result = await installApp({ source, dest, log: () => {}, platform: "darwin" });
    assert.deepEqual(result.removed.sort(), ["AGENTS.md", "helper.json", "legacy", "package.json", "src"]);
    assert.equal(existsSync(join(dest, "src")), false);
    assert.equal(existsSync(join(dest, "legacy")), false);
    assert.equal(existsSync(join(dest, "helper.json")), false);
    assert.ok(existsSync(join(dest, "bin", "pinar")));
    assert.equal(await readFile(join(dest, "shots", "keep.png"), "utf8"), "png");
  });

  test("installApp renames leftover screenshots/ to shots/", async () => {
    const dest = await mkdtemp(join(tmpdir(), "pinar-shots-"));
    await mkdir(join(dest, "screenshots"), { recursive: true });
    await writeFile(join(dest, "screenshots", "keep.png"), "png");
    await installApp({ source, dest, log: () => {} });
    assert.equal(existsSync(join(dest, "screenshots")), false);
    assert.equal(await readFile(join(dest, "shots", "keep.png"), "utf8"), "png");
  });

  test("ensureUserPath writes a single profile line", async () => {
    const home = await mkdtemp(join(tmpdir(), "pinar-path-"));
    await writeFile(join(home, ".zshrc"), "export EDITOR=vim\n");
    const dest = join(home, ".pinar");
    const first = await ensureUserPath({
      home,
      dest,
      platform: "darwin",
      log: () => {},
    });
    const text = await readFile(join(home, ".zshrc"), "utf8");
    assert.equal(first.changed.length, 1);
    assert.match(text, /\.pinar[/\\]bin/);
    const again = await ensureUserPath({
      home,
      dest,
      platform: "darwin",
      log: () => {},
    });
    assert.deepEqual(again.changed, []);
  });

  test("removeLegacyDarwinBin deletes leftover ~/.pinar/bin", async () => {
    const dest = await mkdtemp(join(tmpdir(), "pinar-legacy-bin-"));
    await mkdir(join(dest, "bin"), { recursive: true });
    await writeFile(join(dest, "bin", "pinar"), "old\n");
    await writeFile(join(dest, "history.db"), "keep\n");
    await removeLegacyDarwinBin(dest);
    assert.equal(existsSync(join(dest, "bin")), false);
    assert.equal(await readFile(join(dest, "history.db"), "utf8"), "keep\n");
    await removeLegacyDarwinBin(dest);
    assert.equal(existsSync(join(dest, "bin")), false);
  });

  test("installPlatformHooks refreshes the Darwin launch guard", async () => {
    const dest = await mkdtemp(join(tmpdir(), "pinar-hooks-"));
    await installPlatformHooks(source, dest, "darwin");

    assert.equal(existsSync(join(dest, "hooks", "ensure.sh")), false);
    assert.equal(existsSync(join(dest, "hooks", "ensure.cmd")), false);
    assert.match(await readFile(join(dest, "hooks", "ensure.mjs"), "utf8"), /darwinOpenArgs/);
    assert.match(await readFile(join(dest, "hooks", "pinar.js"), "utf8"), /ensure\.mjs/);
  });

  test("installed runtime CLI answers --version without a native binary", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "pinar-runtime-"));
    const sourceDir = join(fixture, "source");
    const dest = join(fixture, "installed");
    // synthetic source fixture (same no-native-binary path the reviewer probe uses):
    // every RUNTIME_SCRIPTS entry plus the server output and a fake launcher
    for (const [from] of RUNTIME_SCRIPTS) {
      const target = join(sourceDir, from);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(source, from), target);
    }
    await mkdir(join(sourceDir, "apps/server/.output/server"), { recursive: true });
    await writeFile(join(sourceDir, "apps/server/.output/server/index.mjs"), "// fixture only\n");
    await mkdir(join(sourceDir, "bin"), { recursive: true });
    await writeFile(join(sourceDir, "bin/pinar"), "# fixture only\n");
    await installApp({ source: sourceDir, dest, platform: "linux", log: () => {} });
    assert.ok(existsSync(join(dest, "apps/cli/src/runtime.mjs")), "runtime.mjs must be installed");
    assert.ok(existsSync(join(dest, "apps/cli/package.json")), "cli package.json must be installed");
    const result = spawnSync(process.execPath, [join(dest, "apps/cli/src/cli.mjs"), "--version"], {
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env, PINAR_HOME: join(fixture, "home"), PINAR_PORT: "1" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "pinar 0.6.0\n");
  });
});
