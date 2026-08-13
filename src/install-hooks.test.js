import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ensureCommand,
  ensureCommandWindows,
  grokDocument,
  installHooks,
  isPinarEnsureCommand,
  mergeAntigravity,
  mergeOmpConfig,
  mergeSettingsFile,
  upsertSessionStart,
} from "./install-hooks.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

describe("install-hooks", () => {
  test("ensure command points at the checkout script", () => {
    const command = ensureCommand("/opt/pinar", { platform: "darwin" });
    assert.equal(isPinarEnsureCommand(command), true);
    assert.match(command, /\/opt\/pinar\/hooks\/ensure\.sh/);
    assert.match(ensureCommand("/opt/pinar", { json: true, platform: "darwin" }), /^PINAR_HOOK_JSON=1 /);
    assert.match(ensureCommandWindows("/opt/pinar"), /ensure\.cmd/);
    assert.match(
      ensureCommand("/opt/pinar", { json: true, platform: "win32" }),
      /^set PINAR_HOOK_JSON=1&& /,
    );
  });

  test("upsertSessionStart is idempotent and updates an old path", () => {
    const first = upsertSessionStart({ SessionStart: [] }, ensureCommand("/opt/pinar", { platform: "darwin" }));
    assert.equal(first.changed, true);
    const second = upsertSessionStart(first.hooks, ensureCommand("/opt/pinar", { platform: "darwin" }));
    assert.equal(second.changed, false);
    assert.equal(second.hooks.SessionStart.length, 1);
    const moved = upsertSessionStart(first.hooks, ensureCommand("/home/me/.pinar", { platform: "darwin" }));
    assert.equal(moved.changed, true);
    assert.equal(moved.hooks.SessionStart.length, 1);
    assert.match(moved.hooks.SessionStart[0].hooks[0].command, /\.pinar\/hooks\/ensure\.sh/);
  });

  test("mergeSettingsFile keeps existing Claude hooks", () => {
    const existing = {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo other" }] }],
      },
    };
    const { doc, changed } = mergeSettingsFile(
      existing,
      ensureCommand("/opt/pinar", { platform: "darwin" }),
    );
    assert.equal(changed, true);
    assert.equal(doc.hooks.SessionStart.length, 2);
    assert.equal(doc.hooks.SessionStart[0].hooks[0].command, "echo other");
  });

  test("mergeAntigravity adds a named pinar group", () => {
    const { doc, changed } = mergeAntigravity(
      { "ai-memory": { Stop: [] } },
      ensureCommand("/opt/pinar", { json: true, platform: "darwin" }),
    );
    assert.equal(changed, true);
    assert.ok(doc["ai-memory"]);
    assert.equal(doc.pinar.enabled, true);
    assert.equal(doc.pinar.PreInvocation.length, 1);
  });

  test("mergeOmpConfig appends and later replaces the extension path", () => {
    const first = mergeOmpConfig("theme: dark\n", "/opt/pinar/hooks/pinar.ts");
    assert.equal(first.changed, true);
    assert.match(first.text, /extensions:\n  - "\/opt\/pinar\/hooks\/pinar\.ts"/);
    const second = mergeOmpConfig(first.text, "/opt/pinar/hooks/pinar.ts");
    assert.equal(second.changed, false);
    const moved = mergeOmpConfig(first.text, "/home/me/.pinar/hooks/pinar.ts");
    assert.equal(moved.changed, true);
    assert.match(moved.text, /\/home\/me\/\.pinar\/hooks\/pinar\.ts/);
    assert.doesNotMatch(moved.text, /\/opt\/pinar/);
  });

  test("grok document is a SessionStart command hook", () => {
    const doc = grokDocument(ensureCommand("/opt/pinar", { platform: "darwin" }));
    assert.equal(doc.hooks.SessionStart[0].hooks[0].type, "command");
  });

  test("installHooks writes user files without clobbering siblings", async () => {
    const home = await mkdtemp(join(tmpdir(), "pinar-hooks-"));
    await mkdir(join(home, ".claude"), { recursive: true });
    await writeFile(
      join(home, ".claude", "settings.json"),
      `${JSON.stringify({ hooks: { Stop: [] } }, null, 2)}\n`,
    );
    await mkdir(join(home, ".gemini", "config"), { recursive: true });
    await writeFile(
      join(home, ".gemini", "config", "hooks.json"),
      `${JSON.stringify({ "ai-memory": { Stop: [] } }, null, 2)}\n`,
    );
    await mkdir(join(home, ".omp", "agent"), { recursive: true });
    await writeFile(join(home, ".omp", "agent", "config.yml"), "theme: dark\n");

    const logs = [];
    const changed = await installHooks({
      home,
      root,
      platform: "darwin",
      log: (line) => logs.push(String(line)),
    });

    assert.ok(changed.some((path) => path.endsWith("settings.json")));
    const claude = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"));
    assert.ok(claude.hooks.Stop);
    assert.equal(isPinarEnsureCommand(claude.hooks.SessionStart[0].hooks[0].command), true);

    const antigravity = JSON.parse(
      await readFile(join(home, ".gemini", "config", "hooks.json"), "utf8"),
    );
    assert.ok(antigravity["ai-memory"]);
    assert.ok(antigravity.pinar);

    const grok = JSON.parse(await readFile(join(home, ".grok", "hooks", "pinar.json"), "utf8"));
    assert.ok(grok.hooks.SessionStart);

    const codex = JSON.parse(await readFile(join(home, ".codex", "hooks.json"), "utf8"));
    assert.ok(codex.hooks.SessionStart[0].hooks[0].commandWindows.includes("ensure.cmd"));

    const again = await installHooks({ home, root, platform: "darwin", log: () => {} });
    assert.deepEqual(again, []);
    assert.match(logs.join("\n"), /pinar hooks installed/);
  });
});
