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
  test("installApp copies the launcher and leaves screenshots alone", async () => {
    const dest = await mkdtemp(join(tmpdir(), "pinar-app-"));
    await mkdir(join(dest, "screenshots"), { recursive: true });
    await writeFile(join(dest, "screenshots", "keep.png"), "png");
    const result = await installApp({ source, dest, log: () => {} });
    assert.equal(result.copied, true);
    assert.ok(existsSync(launcherPath(dest, "darwin")));
    assert.ok(existsSync(join(dest, "bin", "pinar.cmd")));
    assert.ok(existsSync(join(dest, "hooks", "ensure.sh")));
    assert.ok(existsSync(join(dest, "hooks", "ensure.cmd")));
    assert.ok(existsSync(join(dest, "src", "cli.mjs")));
    assert.ok(existsSync(join(dest, "extension", "manifest.json")));
    assert.equal(await readFile(join(dest, "screenshots", "keep.png"), "utf8"), "png");
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
