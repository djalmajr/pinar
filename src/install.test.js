import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ensureUserPath, installApp, launcherPath } from "./install.mjs";

const source = join(fileURLToPath(new URL(".", import.meta.url)), "..");

describe("install", () => {
  test("installApp copies the launcher and leaves shots alone", async () => {
    const dest = await mkdtemp(join(tmpdir(), "pinar-app-"));
    await mkdir(join(dest, "shots"), { recursive: true });
    await writeFile(join(dest, "shots", "keep.png"), "png");
    const result = await installApp({ source, dest, log: () => {} });
    assert.equal(result.copied, true);
    assert.ok(existsSync(launcherPath(dest, "darwin")));
    assert.ok(existsSync(join(dest, "bin", "pinar.cmd")));
    assert.ok(existsSync(join(dest, "hooks", "ensure.sh")));
    assert.ok(existsSync(join(dest, "hooks", "ensure.cmd")));
    assert.ok(existsSync(join(dest, "lib", "cli.mjs")));
    assert.equal(existsSync(join(dest, "src")), false);
    assert.ok(existsSync(join(dest, "hooks", "pinar.js")));
    assert.ok(existsSync(join(dest, "extension", "manifest.json")));
    assert.equal(existsSync(join(dest, "AGENTS.md")), false);
    assert.equal(existsSync(join(dest, "package.json")), false);
    assert.equal(existsSync(join(dest, "lib", "shots.test.js")), false);
    assert.equal(existsSync(join(dest, "extension", "format.test.js")), false);
    assert.equal(await readFile(join(dest, "shots", "keep.png"), "utf8"), "png");
  });

  test("installApp replaces managed dirs and drops leftover top-level files", async () => {
    const dest = await mkdtemp(join(tmpdir(), "pinar-prune-"));
    await mkdir(join(dest, "shots"), { recursive: true });
    await mkdir(join(dest, "src"), { recursive: true });
    await mkdir(join(dest, "legacy"), { recursive: true });
    await writeFile(join(dest, "shots", "keep.png"), "png");
    await writeFile(join(dest, "helper.json"), "{\"port\":17373}\n");
    await writeFile(join(dest, "AGENTS.md"), "old\n");
    await writeFile(join(dest, "package.json"), "{}\n");
    await writeFile(join(dest, "src", "old.js"), "stale\n");
    await writeFile(join(dest, "legacy", "gone.txt"), "x\n");
    const result = await installApp({ source, dest, log: () => {} });
    assert.deepEqual(result.removed.sort(), ["AGENTS.md", "legacy", "package.json", "src"]);
    assert.equal(existsSync(join(dest, "src")), false);
    assert.equal(existsSync(join(dest, "legacy")), false);
    assert.ok(existsSync(join(dest, "lib", "cli.mjs")));
    assert.equal(await readFile(join(dest, "shots", "keep.png"), "utf8"), "png");
    assert.equal(await readFile(join(dest, "helper.json"), "utf8"), "{\"port\":17373}\n");
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
    const first = await ensureUserPath({ home, dest, platform: "darwin", log: () => {} });
    const text = await readFile(join(home, ".zshrc"), "utf8");
    assert.equal(first.changed.length, 1);
    assert.match(text, /\.pinar\/bin/);
    const again = await ensureUserPath({ home, dest, platform: "darwin", log: () => {} });
    assert.deepEqual(again.changed, []);
  });
});
