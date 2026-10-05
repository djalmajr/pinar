import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  bundledHelperDir,
  darwinOpenAppCommand,
  ensureCommand,
  ensureCommandWindows,
  grokDocument,
  grokEnsureCommand,
  hookExtensionPath,
  installHooks,
  isPinarEnsureCommand,
  isPinarOwnedCommand,
  mergeAntigravity,
  mergeCursorHooks,
  mergeGrokDocument,
  mergeOmpConfig,
  mergeSettingsFile,
  upsertSessionStart,
} from "./install-hooks.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));

describe("install-hooks", () => {
  test("project Cursor hooks start the helper like Claude, Codex, and Grok", () => {
    const cursor = JSON.parse(readFileSync(join(root, ".cursor/hooks.json"), "utf8"));
    assert.equal(cursor.version, 1);
    assert.equal(cursor.hooks.sessionStart[0].command, "node hooks/ensure.mjs");
    assert.equal(cursor.hooks.sessionStart[0].timeout, 8);
  });

  test("project Grok SessionStart runs node ensure.mjs", () => {
    const grok = JSON.parse(readFileSync(join(root, ".grok/hooks/session-start.json"), "utf8"));
    const command = grok.hooks.SessionStart[0].hooks[0].command;
    assert.equal(command, "node hooks/ensure.mjs");
    assert.equal(grok.hooks.SessionStart[0].hooks[0].timeout, 8);
    assert.equal(isPinarEnsureCommand(command), true);
  });

  test("grokEnsureCommand uses node ensure.mjs on Windows", () => {
    const command = grokEnsureCommand("/opt/pinar", { platform: "win32" });
    assert.match(command, /^node "/);
    assert.match(command, /ensure\.mjs/);
    assert.equal(isPinarEnsureCommand(command), true);
    assert.equal(grokEnsureCommand("/opt/pinar", { platform: "linux" }), ensureCommand("/opt/pinar", { platform: "linux" }));
  });

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
    assert.equal(hookExtensionPath(root), join(root, "hooks", "pinar.js"));
    const helperDir = mkdtempSync(join(tmpdir(), "pinar-helper-ext-"));
    writeFileSync(join(helperDir, "pinar.js"), "");
    assert.equal(hookExtensionPath("/missing-pinar-root", join(helperDir, "pinar")), join(helperDir, "pinar.js"));
  });

  test("ensure command uses node ensure.mjs off Darwin", () => {
    assert.match(ensureCommand("/opt/pinar", { platform: "linux" }), /ensure\.mjs/);
    assert.match(ensureCommandWindows("/opt/pinar"), /ensure\.mjs/);
    assert.match(ensureCommand("/opt/pinar", { json: true, platform: "win32" }), /^set PINAR_HOOK_JSON=1&& node /);
  });

  test("isPinarEnsureCommand matches current and legacy ensure commands", () => {
    assert.equal(isPinarEnsureCommand("node hooks/ensure.mjs"), true);
    assert.equal(isPinarEnsureCommand('node "C:\\Users\\me\\.pinar\\hooks\\ensure.mjs"'), true);
    assert.equal(isPinarEnsureCommand("../../hooks/ensure.sh"), true);
    assert.equal(isPinarEnsureCommand("hooks\\ensure.cmd"), true);
    assert.equal(isPinarEnsureCommand("bun hooks/ensure-run.mjs"), true);
    assert.equal(isPinarEnsureCommand("echo other"), false);
  });

  test("Darwin ensure command skips open while the tray PID is alive", () => {
    if (process.platform !== "darwin") return;
    const home = mkdtempSync(join(tmpdir(), "pinar-running-tray-"));
    mkdirSync(join(home, ".pinar"), { recursive: true });
    writeFileSync(join(home, ".pinar", "tray.pid"), `${process.pid}\n`);

    assert.doesNotThrow(() => {
      execFileSync("/bin/sh", ["-c", ensureCommand("/opt/pinar", { platform: "darwin", home })]);
    });
  });

  test("Darwin ensure command serializes concurrent cold launches", async () => {
    if (process.platform !== "darwin") return;
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
    assert.match(moved.hooks.SessionStart[0].hooks[0].command, /ensure\.mjs/);
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

  test("mergeAntigravity is idempotent for Windows commands", () => {
    const command = 'set PINAR_HOOK_JSON=1&& node "C:\\Users\\me\\.pinar\\hooks\\ensure.mjs"';
    const first = mergeAntigravity({}, command);
    assert.equal(first.changed, true);
    const second = mergeAntigravity(first.doc, command);
    assert.equal(second.changed, false);
    assert.deepEqual(second.doc, first.doc);
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

  test("mergeGrokDocument keeps sibling grok hooks", () => {
    const existing = {
      extra: true,
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
      },
    };
    const { doc, changed } = mergeGrokDocument(existing, ensureCommand("/opt/pinar", { platform: "linux" }));
    assert.equal(changed, true);
    assert.equal(doc.extra, true);
    assert.equal(doc.hooks.Stop[0].hooks[0].command, "echo stop");
    assert.equal(isPinarEnsureCommand(doc.hooks.SessionStart[0].hooks[0].command), true);
  });

  test("mergeCursorHooks is idempotent and keeps unrelated Cursor hooks", () => {
    const existing = {
      version: 1,
      hooks: {
        afterFileEdit: [{ command: "format.sh" }],
      },
    };
    const command = ensureCommand("/opt/pinar", { platform: "darwin" });
    const first = mergeCursorHooks(existing, command);
    assert.equal(first.changed, true);
    assert.equal(first.doc.hooks.afterFileEdit[0].command, "format.sh");
    assert.equal(first.doc.hooks.sessionStart[0].command, command);
    const second = mergeCursorHooks(first.doc, command);
    assert.equal(second.changed, false);
    const moved = mergeCursorHooks(first.doc, ensureCommand("/home/me/.pinar", { platform: "linux" }));
    assert.equal(moved.changed, true);
    assert.equal(moved.doc.hooks.sessionStart.length, 1);
    assert.match(moved.doc.hooks.sessionStart[0].command, /ensure\.mjs/);
  });

  test("installHooks writes user files without clobbering siblings", async () => {
    const home = await mkdtemp(join(tmpdir(), "pinar-hooks-"));
    await mkdir(join(home, ".claude"), { recursive: true });
    await writeFile(join(home, ".claude", "settings.json"), `${JSON.stringify({ hooks: { Stop: [] } }, null, 2)}\n`);
    await mkdir(join(home, ".cursor"), { recursive: true });
    await writeFile(
      join(home, ".cursor", "hooks.json"),
      `${JSON.stringify({ version: 1, hooks: { afterFileEdit: [{ command: "format.sh" }] } }, null, 2)}\n`,
    );
    await mkdir(join(home, ".grok", "hooks"), { recursive: true });
    await writeFile(
      join(home, ".grok", "hooks", "pinar.json"),
      `${JSON.stringify({ extra: true, hooks: { Stop: [] } }, null, 2)}\n`,
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
    assert.equal(claude.hooks.SessionStart[0].hooks[0].command, ensureCommand(root, { platform: "darwin", home }));

    const antigravity = JSON.parse(await readFile(join(home, ".gemini", "config", "hooks.json"), "utf8"));
    assert.ok(antigravity["ai-memory"]);
    assert.ok(antigravity.pinar);

    const grok = JSON.parse(await readFile(join(home, ".grok", "hooks", "pinar.json"), "utf8"));
    assert.equal(grok.extra, true);
    assert.ok(grok.hooks.Stop);
    assert.ok(grok.hooks.SessionStart);

    const cursor = JSON.parse(await readFile(join(home, ".cursor", "hooks.json"), "utf8"));
    assert.equal(cursor.hooks.afterFileEdit[0].command, "format.sh");
    assert.equal(isPinarEnsureCommand(cursor.hooks.sessionStart[0].command), true);

    const codex = JSON.parse(await readFile(join(home, ".codex", "hooks.json"), "utf8"));
    assert.ok(codex.hooks.SessionStart[0].hooks[0].commandWindows.includes("ensure.mjs"));

    const again = await installHooks({
      home,
      root,
      platform: "darwin",
      log: () => {},
    });
    assert.deepEqual(again, []);
    assert.match(logs.join("\n"), /pinar hooks installed/);
  });

  test("installHooks writes a PowerShell-safe Grok command on Windows", async () => {
    const home = await mkdtemp(join(tmpdir(), "pinar-hooks-win-"));
    await installHooks({
      home,
      log: () => {},
      platform: "win32",
      root,
    });
    const grok = JSON.parse(await readFile(join(home, ".grok", "hooks", "pinar.json"), "utf8"));
    const command = grok.hooks.SessionStart[0].hooks[0].command;
    assert.match(command, /^node "/);
    assert.match(command, /ensure\.mjs/);
    assert.equal(isPinarEnsureCommand(command), true);
  });

  test("bundledHelperDir matches only the compiled app helper with ensure.mjs beside it", () => {
    const dir = mkdtempSync(join(tmpdir(), "pinar-bundled-"));
    const helpers = join(dir, "app", "Helpers");
    mkdirSync(helpers, { recursive: true });
    writeFileSync(join(helpers, "ensure.mjs"), "");
    assert.equal(bundledHelperDir(join(helpers, "pinar.exe")), helpers);
    assert.equal(bundledHelperDir(join(helpers, "Pinar.exe")), helpers);
    const standalone = join(dir, "bin");
    mkdirSync(standalone, { recursive: true });
    assert.equal(bundledHelperDir(join(standalone, "pinar.exe")), null);
    const other = join(dir, "other");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "ensure.mjs"), "");
    assert.equal(bundledHelperDir(join(other, "node.exe")), null);
    assert.equal(bundledHelperDir(join(other, "bun.exe")), null);
  });

  async function runBundledInstall(home) {
    const saved = { source: process.env.PINAR_SOURCE, pinarHome: process.env.PINAR_HOME };
    delete process.env.PINAR_SOURCE;
    delete process.env.PINAR_HOME;
    try {
      return await installHooks({ home, platform: "win32", execPath: join(home, "app", "Helpers", "pinar.exe"), log: () => {} });
    } finally {
      if (saved.source === undefined) delete process.env.PINAR_SOURCE;
      else process.env.PINAR_SOURCE = saved.source;
      if (saved.pinarHome === undefined) delete process.env.PINAR_HOME;
      else process.env.PINAR_HOME = saved.pinarHome;
    }
  }

  async function seedBundledHelper(home) {
    const helperDir = join(home, "app", "Helpers");
    await mkdir(helperDir, { recursive: true });
    await writeFile(join(helperDir, "ensure.mjs"), "// fake ensure\n");
    await writeFile(join(helperDir, "pinar.js"), "// fake extension\n");
  }

  test("installHooks materializes the bundled helper into pinar home on Windows", async () => {
    const home = await mkdtemp(join(tmpdir(), "pinar-bundled-home-"));
    await seedBundledHelper(home);
    const pinarHomeDir = join(home, ".pinar");
    const execPath = join(home, "app", "Helpers", "pinar.exe");
    const saved = { source: process.env.PINAR_SOURCE, pinarHome: process.env.PINAR_HOME };
    delete process.env.PINAR_SOURCE;
    delete process.env.PINAR_HOME;
    try {
      await installHooks({ home, platform: "win32", execPath, log: () => {} });
      assert.equal(await readFile(join(pinarHomeDir, "hooks", "ensure.mjs"), "utf8"), "// fake ensure\n");
      assert.equal(await readFile(join(pinarHomeDir, "hooks", "pinar.js"), "utf8"), "// fake extension\n");
      assert.equal(
        await readFile(join(pinarHomeDir, "bin", "pinar.cmd"), "utf8"),
        `@echo off\r\n"${execPath}" %*\r\nexit /b %ERRORLEVEL%\r\n`,
      );
      const claude = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"));
      assert.equal(claude.hooks.SessionStart[0].hooks[0].command, `node "${join(pinarHomeDir, "hooks", "ensure.mjs")}"`);
      const ompConfig = await readFile(join(home, ".omp", "agent", "config.yml"), "utf8");
      assert.ok(ompConfig.includes(JSON.stringify(join(pinarHomeDir, "hooks", "pinar.js"))));
      const again = await installHooks({ home, platform: "win32", execPath, log: () => {} });
      assert.deepEqual(again, []);
    } finally {
      if (saved.source === undefined) delete process.env.PINAR_SOURCE;
      else process.env.PINAR_SOURCE = saved.source;
      if (saved.pinarHome === undefined) delete process.env.PINAR_HOME;
      else process.env.PINAR_HOME = saved.pinarHome;
    }
  });

  test("installHooks skips pinar.cmd when a standalone pinar.exe is installed", async () => {
    const home = await mkdtemp(join(tmpdir(), "pinar-bundled-standalone-"));
    await seedBundledHelper(home);
    const bin = join(home, ".pinar", "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "pinar.exe"), "MZ");
    const changed = await runBundledInstall(home);
    assert.ok(changed.length > 0);
    assert.ok(!existsSync(join(bin, "pinar.cmd")));
    assert.equal(await readFile(join(bin, "pinar.exe"), "utf8"), "MZ");
    assert.equal(await readFile(join(home, ".pinar", "hooks", "ensure.mjs"), "utf8"), "// fake ensure\n");
    const claude = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"));
    assert.equal(claude.hooks.SessionStart[0].hooks[0].command, `node "${join(home, ".pinar", "hooks", "ensure.mjs")}"`);
  });

  test("installHooks second call does not rewrite identical materialized files", async () => {
    const home = await mkdtemp(join(tmpdir(), "pinar-bundled-mtime-"));
    await seedBundledHelper(home);
    const execPath = join(home, "app", "Helpers", "pinar.exe");
    const targets = [join(home, ".pinar", "hooks", "ensure.mjs"), join(home, ".pinar", "bin", "pinar.cmd")];
    const saved = { source: process.env.PINAR_SOURCE, pinarHome: process.env.PINAR_HOME };
    delete process.env.PINAR_SOURCE;
    delete process.env.PINAR_HOME;
    try {
      await installHooks({ home, platform: "win32", execPath, log: () => {} });
      const before = await Promise.all(targets.map((path) => stat(path)));
      await new Promise((resolve) => setTimeout(resolve, 100));
      await installHooks({ home, platform: "win32", execPath, log: () => {} });
      const after = await Promise.all(targets.map((path) => stat(path)));
      assert.equal(after[0].mtimeMs, before[0].mtimeMs, "ensure.mjs must not be rewritten");
      assert.equal(after[1].mtimeMs, before[1].mtimeMs, "pinar.cmd must not be rewritten");
    } finally {
      if (saved.source === undefined) delete process.env.PINAR_SOURCE;
      else process.env.PINAR_SOURCE = saved.source;
      if (saved.pinarHome === undefined) delete process.env.PINAR_HOME;
      else process.env.PINAR_HOME = saved.pinarHome;
    }
  });

  test("upsertSessionStart keeps a foreign /usr/bin/open -ga hook that is not Pinar", () => {
    const command = 'node "C:\\Users\\u\\.pinar\\hooks\\ensure.mjs"';
    const foreign = { type: "command", command: '/usr/bin/open -ga "/Applications/Other.app"', timeout: 8 };
    const hooks = {
      SessionStart: [
        { hooks: [{ type: "command", command, timeout: 8 }] },
        { hooks: [foreign] },
      ],
    };
    const { hooks: next, changed } = upsertSessionStart(hooks, command);
    assert.equal(changed, false);
    assert.equal(next.SessionStart.length, 2);
    assert.equal(next.SessionStart[0].hooks[0].command, command);
    assert.equal(next.SessionStart[1].hooks[0].command, foreign.command);
  });

  test("mergeCursorHooks keeps a foreign /usr/bin/open -ga hook that is not Pinar", () => {
    const command = 'node "C:\\Users\\u\\.pinar\\hooks\\ensure.mjs"';
    const foreign = { command: '/usr/bin/open -ga "/Applications/Other.app"', timeout: 8 };
    const doc = {
      version: 1,
      hooks: { sessionStart: [{ command: 'node "C:\\x\\hooks\\ensure.mjs"', timeout: 8 }, foreign] },
    };
    const { doc: next, changed } = mergeCursorHooks(doc, command);
    assert.equal(changed, true);
    assert.equal(next.hooks.sessionStart.length, 2);
    assert.equal(next.hooks.sessionStart[0].command, command);
    assert.equal(next.hooks.sessionStart[1].command, foreign.command);
  });

  test("isPinarOwnedCommand matches Pinar ensure and open commands only", () => {
    const darwin = darwinOpenAppCommand("/Users/u");
    assert.equal(isPinarOwnedCommand("node hooks/ensure.mjs"), true);
    assert.equal(isPinarOwnedCommand('node "C:\\Users\\u\\.pinar\\hooks\\ensure.mjs"'), true);
    assert.equal(isPinarOwnedCommand(darwin), true);
    assert.equal(isPinarOwnedCommand("/usr/bin/open -ga Pinar"), true);
    assert.equal(isPinarOwnedCommand('/usr/bin/open -ga "Pinar"'), true);
    assert.equal(isPinarOwnedCommand('/usr/bin/open -ga "/Applications/Other.app"'), false);
    assert.equal(isPinarOwnedCommand("/usr/bin/open -ga Other"), false);
    assert.equal(isPinarOwnedCommand("echo other"), false);
  });

  test("mergeOmpConfig drops pinar items with trailing comments and keeps the comment", () => {
    const input = 'extensions:\n  - "/old/hooks/pinar.js"\n  # user comment\n  - "/older/hooks/pinar.ts"\ntheme: dark\n';
    const first = mergeOmpConfig(input, "/new/hooks/pinar.js");
    assert.equal(first.changed, true);
    assert.equal(first.text, 'extensions:\n  - "/new/hooks/pinar.js"\n  # user comment\ntheme: dark\n');
    const second = mergeOmpConfig(first.text, "/new/hooks/pinar.js");
    assert.equal(second.changed, false);
    assert.equal(second.text, first.text);
  });

  test("mergeOmpConfig CRLF input keeps CRLF and drops inline-commented pinar item", () => {
    const input = 'extensions:\r\n  - "/old/hooks/pinar.js" # user comment\r\ntheme: dark\r\n';
    const first = mergeOmpConfig(input, "/new/hooks/pinar.js");
    assert.equal(first.changed, true);
    assert.equal(first.text, 'extensions:\r\n  - "/new/hooks/pinar.js"\r\ntheme: dark\r\n');
    assert.ok(!/(?<!\r)\n/.test(first.text), "no bare LF may appear in a CRLF file");
    const second = mergeOmpConfig(first.text, "/new/hooks/pinar.js");
    assert.equal(second.changed, false);
    assert.equal(second.text, first.text);
  });

  test("mergeOmpConfig keeps a foreign item whose comment mentions pinar.js", () => {
    const input = 'extensions:\n  - "/x/other.js" # pinar.js\ntheme: dark\n';
    const first = mergeOmpConfig(input, "/new/hooks/pinar.js");
    assert.equal(first.changed, true);
    assert.equal(first.text, 'extensions:\n  - "/new/hooks/pinar.js"\n  - "/x/other.js" # pinar.js\ntheme: dark\n');
    assert.ok(first.text.includes('# pinar.js'));
  });

  test("mergeOmpConfig removes a plain Pinar item with a literal apostrophe in the path", () => {
    const input = "extensions:\n  - C:/Users/O'Brien/.pinar/hooks/pinar.js # legacy\n  - /opt/other/other.js\ntheme: dark\n";
    const first = mergeOmpConfig(input, "/new/hooks/pinar.js");
    assert.equal(first.changed, true);
    assert.equal(first.text, 'extensions:\n  - "/new/hooks/pinar.js"\n  - /opt/other/other.js\ntheme: dark\n');
    const second = mergeOmpConfig(first.text, "/new/hooks/pinar.js");
    assert.equal(second.changed, false);
    assert.equal(second.text, first.text);
  });

  test("mergeOmpConfig removes a double-quoted Pinar item with escaped backslashes and quote", () => {
    const input = "extensions:\n" + String.raw`  - "C:\\Users\\a\"b\\pinar.js" # x` + "\ntheme: dark\n";
    const first = mergeOmpConfig(input, "/new/hooks/pinar.js");
    assert.equal(first.changed, true);
    assert.equal(first.text, 'extensions:\n  - "/new/hooks/pinar.js"\ntheme: dark\n');
    const second = mergeOmpConfig(first.text, "/new/hooks/pinar.js");
    assert.equal(second.changed, false);
    assert.equal(second.text, first.text);
  });

  test("mergeOmpConfig removes a single-quoted Pinar item with a doubled quote", () => {
    const input = "extensions:\n  - 'C:/Users/O''Brien/pinar.ts'\ntheme: dark\n";
    const first = mergeOmpConfig(input, "/new/hooks/pinar.js");
    assert.equal(first.changed, true);
    assert.equal(first.text, 'extensions:\n  - "/new/hooks/pinar.js"\ntheme: dark\n');
    const second = mergeOmpConfig(first.text, "/new/hooks/pinar.js");
    assert.equal(second.changed, false);
    assert.equal(second.text, first.text);
  });

  test("mergeOmpConfig keeps a plain foreign item with an apostrophe and a pinar comment", () => {
    const input = "extensions:\n  - /opt/x/it's-fine.js # pinar.js\ntheme: dark\n";
    const first = mergeOmpConfig(input, "/new/hooks/pinar.js");
    assert.equal(first.changed, true);
    assert.equal(first.text, "extensions:\n  - \"/new/hooks/pinar.js\"\n  - /opt/x/it's-fine.js # pinar.js\ntheme: dark\n");
    const second = mergeOmpConfig(first.text, "/new/hooks/pinar.js");
    assert.equal(second.changed, false);
    assert.equal(second.text, first.text);
  });

  test("upsertSessionStart preserves foreign groups without a hooks array", () => {
    const command = 'node "C:\\Users\\u\\.pinar\\hooks\\ensure.mjs"';
    const hooks = {
      SessionStart: [
        { matcher: "x" },
        { hooks: [{ type: "command", command: '"C:\\Users\\u\\.pinar\\apps\\cli\\hooks\\ensure.cmd"', timeout: 8 }] },
      ],
    };
    const { hooks: next, changed } = upsertSessionStart(hooks, command);
    assert.equal(changed, true);
    assert.equal(next.SessionStart.length, 2);
    assert.deepEqual(next.SessionStart[0], { matcher: "x" });
    assert.ok(!("hooks" in next.SessionStart[0]));
    assert.equal(next.SessionStart[1].hooks.length, 1);
    assert.equal(next.SessionStart[1].hooks[0].command, command);
    assert.equal(hooks.SessionStart.length, 2);
  });

  test("upsertSessionStart removes legacy pinar handlers from every group", () => {
    const legacy = {
      SessionStart: [
        {
          matcher: "startup",
          hooks: [{ type: "command", command: 'node "C:\\Users\\u\\.pinar\\apps\\cli\\hooks\\ensure.mjs"', timeout: 8 }],
        },
        { matcher: "startup", hooks: [{ type: "command", command: '"C:\\Users\\u\\.pinar\\apps\\cli\\hooks\\ensure.cmd"', timeout: 8 }] },
        { hooks: [{ type: "command", command: "echo other", timeout: 8 }] },
      ],
    };
    const command = 'node "C:\\Users\\u\\.pinar\\hooks\\ensure.mjs"';
    const commandWindows = 'set PINAR_HOOK_JSON=1&& node "C:\\Users\\u\\.pinar\\hooks\\ensure.mjs"';
    const { hooks, changed } = upsertSessionStart(legacy, command, { commandWindows });
    assert.equal(changed, true);
    assert.equal(hooks.SessionStart.length, 2);
    const pinar = hooks.SessionStart.find((group) => group.hooks.some((hook) => isPinarEnsureCommand(hook.command)));
    assert.equal(pinar.hooks.length, 1);
    assert.equal(pinar.hooks[0].command, command);
    assert.equal(pinar.hooks[0].commandWindows, commandWindows);
    const foreign = hooks.SessionStart.find((group) => !group.hooks.some((hook) => isPinarEnsureCommand(hook.command)));
    assert.equal(foreign.hooks[0].command, "echo other");
    for (const group of hooks.SessionStart) {
      for (const hook of group.hooks) {
        if (hook === pinar.hooks[0]) continue;
        assert.equal(isPinarEnsureCommand(hook.command), false, hook.command);
        assert.equal(isPinarEnsureCommand(hook.commandWindows), false, hook.commandWindows);
      }
    }
    const second = upsertSessionStart(hooks, command, { commandWindows });
    assert.equal(second.changed, false);
    assert.equal(legacy.SessionStart.length, 3);
  });

  test("upsertSessionStart reports changed when it only removes duplicates", () => {
    const command = 'node "C:\\Users\\u\\.pinar\\hooks\\ensure.mjs"';
    const hooks = {
      SessionStart: [
        { hooks: [{ type: "command", command, timeout: 8 }] },
        { hooks: [{ type: "command", command: '"C:\\Users\\u\\.pinar\\apps\\cli\\hooks\\ensure.cmd"', timeout: 8 }] },
      ],
    };
    const { hooks: next, changed } = upsertSessionStart(hooks, command);
    assert.equal(changed, true);
    assert.equal(next.SessionStart.length, 1);
    assert.equal(next.SessionStart[0].hooks[0].command, command);
  });

  test("mergeCursorHooks removes legacy pinar entries and keeps foreign ones in order", () => {
    const doc = {
      version: 1,
      hooks: {
        sessionStart: [
          { command: 'node "C:\\Users\\u\\.pinar\\apps\\cli\\hooks\\ensure.mjs"', timeout: 8 },
          { command: "echo other", timeout: 8 },
          { command: '"C:\\Users\\u\\.pinar\\apps\\cli\\hooks\\ensure.cmd"', timeout: 8 },
        ],
      },
    };
    const command = 'node "C:\\Users\\u\\.pinar\\hooks\\ensure.mjs"';
    const { doc: next, changed } = mergeCursorHooks(doc, command);
    assert.equal(changed, true);
    assert.equal(next.hooks.sessionStart.length, 2);
    assert.equal(next.hooks.sessionStart[0].command, command);
    assert.equal(next.hooks.sessionStart[1].command, "echo other");
    const again = mergeCursorHooks(next, command);
    assert.equal(again.changed, false);
    assert.deepEqual(again.doc, next);
  });

  test("mergeOmpConfig keeps exactly one pinar extension and the rest of the file", () => {
    const newPath = 'C:\\Users\\u\\.pinar\\hooks\\pinar.js';
    const text = [
      "extensions:",
      `  - ${JSON.stringify(newPath)}`,
      '  - C:\\Users\\u\\.pinar\\apps\\cli\\hooks\\pinar.js',
      '  - C:\\Users\\u\\repo.git\\pinar\\hooks\\pinar.js',
      "composer:",
      "  shape: pi",
      "",
    ].join("\n");
    const next = mergeOmpConfig(text, newPath);
    assert.equal(next.changed, true);
    assert.equal(next.text, `extensions:\n  - ${JSON.stringify(newPath)}\ncomposer:\n  shape: pi\n`);
    const again = mergeOmpConfig(next.text, newPath);
    assert.equal(again.changed, false);
    assert.equal(again.text, next.text);
  });

  test("mergeOmpConfig leaves other extensions and file content intact", () => {
    const text = [
      "extensions:",
      '  - "/opt/other/other.js"',
      "  - 'C:\\Users\\u\\.pinar\\apps\\cli\\hooks\\pinar.ts'",
      "  - /opt/other2/other2.js",
      "theme: dark",
      "",
    ].join("\n");
    const next = mergeOmpConfig(text, "C:/x/.pinar/hooks/pinar.js");
    assert.equal(next.changed, true);
    assert.equal(
      next.text,
      `extensions:\n  - "C:/x/.pinar/hooks/pinar.js"\n  - "/opt/other/other.js"\n  - /opt/other2/other2.js\ntheme: dark\n`,
    );
  });
});
