import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  darwinOpenAppCommand,
  ensureCommand,
  ensureCommandWindows,
  grokDocument,
  hookExtensionPath,
  installHooks,
  isPinarEnsureCommand,
  mergeAntigravity,
  mergeOmpConfig,
  mergeSettingsFile,
  upsertSessionStart,
} from "./install-hooks.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));

describe("install-hooks", () => {
  test("ensure command opens Pinar.app on Darwin and keeps scripts elsewhere", () => {
    const command = ensureCommand("/opt/pinar", {
      platform: "darwin",
      home: "/Users/me",
    });
    assert.equal(isPinarEnsureCommand(command), true);
    assert.match(command, /\/Users\/me\/\.pinar\/tray\.pid/);
    assert.match(command, /\/bin\/kill -0/);
    assert.match(command, /\/usr\/bin\/shlock/);
    assert.match(command, /\/usr\/bin\/open -ga "\/Users\/me\/Applications\/Pinar\.app"/);
    assert.match(
      ensureCommand("/opt/pinar", {
        json: true,
        platform: "darwin",
        home: "/Users/me",
      }),
      /printf/,
    );
    assert.match(ensureCommand("/opt/pinar", { platform: "linux" }), /\/opt\/pinar\/hooks\/ensure\.sh/);
    assert.match(ensureCommandWindows("/opt/pinar"), /ensure\.cmd/);
    assert.match(ensureCommand("/opt/pinar", { json: true, platform: "win32" }), /^set PINAR_HOOK_JSON=1&& /);
    assert.equal(hookExtensionPath(root), join(root, "hooks", "pinar.js"));
    const helperDir = mkdtempSync(join(tmpdir(), "pinar-helper-ext-"));
    writeFileSync(join(helperDir, "pinar.js"), "");
    assert.equal(hookExtensionPath("/missing-pinar-root", join(helperDir, "pinar")), join(helperDir, "pinar.js"));
  });

  test("Darwin ensure command skips open while the tray PID is alive", () => {
    const home = mkdtempSync(join(tmpdir(), "pinar-running-tray-"));
    mkdirSync(join(home, ".pinar"), { recursive: true });
    writeFileSync(join(home, ".pinar", "tray.pid"), `${process.pid}\n`);

    assert.doesNotThrow(() => {
      execFileSync("/bin/sh", ["-c", ensureCommand("/opt/pinar", { platform: "darwin", home })]);
    });
  });

  test("Darwin ensure command serializes concurrent cold launches", async () => {
    const home = mkdtempSync(join(tmpdir(), "pinar-concurrent-launch-"));
    const pinarDir = join(home, ".pinar");
    const countPath = join(home, "open-count");
    const opener = join(home, "fake-open");
    mkdirSync(pinarDir, { recursive: true });
    writeFileSync(
      opener,
      `#!/bin/sh\n/bin/sleep 0.2\nprintf x >> ${JSON.stringify(countPath)}\nprintf '%s\\n' "$PPID" > ${JSON.stringify(join(pinarDir, "tray.pid"))}\n`,
    );
    chmodSync(opener, 0o755);
    const command = darwinOpenAppCommand(home, { opener });

    await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          new Promise((resolve, reject) => {
            const child = spawn("/bin/sh", ["-c", command], {
              stdio: "ignore",
            });
            child.once("error", reject);
            child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`hook exited ${code}`))));
          }),
      ),
    );

    assert.equal(readFileSync(countPath, "utf8"), "x");
  });

  test("upsertSessionStart is idempotent and updates an old path", () => {
    const first = upsertSessionStart({ SessionStart: [] }, ensureCommand("/opt/pinar", { platform: "darwin" }));
    assert.equal(first.changed, true);
    const second = upsertSessionStart(first.hooks, ensureCommand("/opt/pinar", { platform: "darwin" }));
    assert.equal(second.changed, false);
    assert.equal(second.hooks.SessionStart.length, 1);
    const moved = upsertSessionStart(first.hooks, ensureCommand("/home/me/.pinar", { platform: "linux" }));
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
    const { doc, changed } = mergeSettingsFile(existing, ensureCommand("/opt/pinar", { platform: "darwin" }));
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
    const first = mergeOmpConfig("theme: dark\n", "/opt/pinar/hooks/pinar.js");
    assert.equal(first.changed, true);
    assert.match(first.text, /extensions:\n  - "\/opt\/pinar\/hooks\/pinar\.js"/);
    const second = mergeOmpConfig(first.text, "/opt/pinar/hooks/pinar.js");
    assert.equal(second.changed, false);
    const moved = mergeOmpConfig(first.text, "/home/me/.pinar/hooks/pinar.js");
    assert.equal(moved.changed, true);
    assert.match(moved.text, /\/home\/me\/\.pinar\/hooks\/pinar\.js/);
    assert.doesNotMatch(moved.text, /\/opt\/pinar/);
  });

  test("grok document is a SessionStart command hook", () => {
    const doc = grokDocument(ensureCommand("/opt/pinar", { platform: "darwin" }));
    assert.equal(doc.hooks.SessionStart[0].hooks[0].type, "command");
  });

  test("installHooks writes user files without clobbering siblings", async () => {
    const home = await mkdtemp(join(tmpdir(), "pinar-hooks-"));
    await mkdir(join(home, ".claude"), { recursive: true });
    await writeFile(join(home, ".claude", "settings.json"), `${JSON.stringify({ hooks: { Stop: [] } }, null, 2)}\n`);
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
    assert.equal(claude.hooks.SessionStart[0].hooks[0].command, ensureCommand(root, { platform: "darwin", home }));

    const antigravity = JSON.parse(await readFile(join(home, ".gemini", "config", "hooks.json"), "utf8"));
    assert.ok(antigravity["ai-memory"]);
    assert.ok(antigravity.pinar);

    const grok = JSON.parse(await readFile(join(home, ".grok", "hooks", "pinar.json"), "utf8"));
    assert.ok(grok.hooks.SessionStart);

    const codex = JSON.parse(await readFile(join(home, ".codex", "hooks.json"), "utf8"));
    assert.ok(codex.hooks.SessionStart[0].hooks[0].commandWindows.includes("ensure.cmd"));

    const again = await installHooks({
      home,
      root,
      platform: "darwin",
      log: () => {},
    });
    assert.deepEqual(again, []);
    assert.match(logs.join("\n"), /pinar hooks installed/);
  });
});
