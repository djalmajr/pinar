import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir as osHomedir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

export function defaultRoot() {
  if (process.env.PINAR_SOURCE && existsSync(process.env.PINAR_SOURCE)) {
    return process.env.PINAR_SOURCE;
  }
  const cwdPkg = join(process.cwd(), "package.json");
  if (existsSync(cwdPkg)) {
    try {
      const content = existsSync(cwdPkg);
      if (content) return process.cwd();
    } catch {}
  }
  const execDir = dirname(process.execPath);
  if (existsSync(join(execDir, "..", "..", "package.json"))) {
    return join(execDir, "..", "..");
  }
  if (existsSync(join(execDir, "..", "package.json"))) {
    return join(execDir, "..");
  }
  try {
    const metaPath = fileURLToPath(import.meta.url);
    if (!metaPath.startsWith("/$bunfs")) {
      const fromMeta = join(dirname(metaPath), "..");
      if (existsSync(fromMeta)) return fromMeta;
    }
  } catch {}
  return process.cwd();
}

function darwinPath(...parts) {
  return posix.join(...parts.map((part) => String(part).replaceAll("\\", "/")));
}

export function desktopAppPath(home = osHomedir()) {
  return darwinPath(home, "Applications", "Pinar.app");
}

export function darwinOpenAppCommand(home = osHomedir(), { opener = "/usr/bin/open" } = {}) {
  const pinarDir = JSON.stringify(darwinPath(home, ".pinar"));
  const pidFile = JSON.stringify(darwinPath(home, ".pinar", "tray.pid"));
  const launchLock = JSON.stringify(darwinPath(home, ".pinar", "tray-launch.lock"));
  const app = JSON.stringify(desktopAppPath(home));
  const open = `${opener === "/usr/bin/open" ? opener : JSON.stringify(opener)} -ga ${app}`;
  return `pinar_dir=${pinarDir}; pid_file=${pidFile}; launch_lock=${launchLock}; /bin/mkdir -p "$pinar_dir"; if [ -r "$pid_file" ] && pid="$(/bin/cat "$pid_file" 2>/dev/null)" && [ -n "$pid" ] && /bin/kill -0 "$pid" 2>/dev/null; then :; elif /usr/bin/shlock -p "$$" -f "$launch_lock"; then trap '/bin/rm -f "$launch_lock"' 0 1 2 15; if [ -r "$pid_file" ] && pid="$(/bin/cat "$pid_file" 2>/dev/null)" && [ -n "$pid" ] && /bin/kill -0 "$pid" 2>/dev/null; then :; elif ${open}; then attempts=0; while [ "$attempts" -lt 100 ]; do if [ -r "$pid_file" ] && pid="$(/bin/cat "$pid_file" 2>/dev/null)" && [ -n "$pid" ] && /bin/kill -0 "$pid" 2>/dev/null; then break; fi; attempts=$((attempts + 1)); /bin/sleep 0.05; done; fi; else :; fi`;
}

export function darwinOpenAppCommandJson(home = osHomedir()) {
  return `${darwinOpenAppCommand(home)}; printf '%s\\n' '{}'`;
}

export function ensureScript(root) {
  return join(root, "hooks", "ensure.mjs");
}

export function nodeEnsureCommand(root, { json = false, platform = process.platform } = {}) {
  const command = `node "${ensureScript(root)}"`;
  if (!json) return command;
  if (platform === "win32") return `set PINAR_HOOK_JSON=1&& ${command}`;
  return `PINAR_HOOK_JSON=1 ${command}`;
}

export function ensureCommand(root, { json = false, platform = process.platform, home = osHomedir() } = {}) {
  if (platform === "darwin") {
    return json ? darwinOpenAppCommandJson(home) : darwinOpenAppCommand(home);
  }
  return nodeEnsureCommand(root, { json, platform });
}

export function ensureCommandWindows(root, { json = false } = {}) {
  return ensureCommand(root, { json, platform: "win32" });
}

export function grokEnsureCommand(root, { platform = process.platform, home = osHomedir() } = {}) {
  return ensureCommand(root, { home, platform });
}

export function hookExtensionPath(root, execPath = process.execPath) {
  const candidates = [join(root, "hooks", "pinar.js"), join(dirname(execPath), "pinar.js")];
  return candidates.find((path) => existsSync(path)) ?? candidates[0];
}

export function isPinarEnsureCommand(command = "") {
  return (
    /"?\/usr\/bin\/open"? -ga /.test(command) ||
    /hooks[/\\]ensure\.mjs/.test(command) ||
    /hooks[/\\]ensure-run\.mjs/.test(command) ||
    /hooks[/\\]ensure\.(sh|cmd)/.test(command) ||
    /[/\\]\.pinar[/\\](bin[/\\]pinar(?:\.cmd)?|hooks[/\\]ensure(?:\.mjs|\.(sh|cmd)))/.test(command)
  );
}

export function upsertSessionStart(hooks, command, extra = {}) {
  const events = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
  const groupIndex = events.findIndex((group) =>
    (group?.hooks ?? []).some((hook) => isPinarEnsureCommand(hook?.command)),
  );
  if (groupIndex >= 0) {
    const group = events[groupIndex];
    const hookIndex = group.hooks.findIndex((hook) => isPinarEnsureCommand(hook.command));
    const hook = group.hooks[hookIndex];
    const same =
      hook.command === command && (extra.commandWindows === undefined || hook.commandWindows === extra.commandWindows);
    if (same) return { hooks, changed: false };
    const nextHook = { ...hook, command, timeout: hook.timeout ?? 8 };
    if (extra.commandWindows) nextHook.commandWindows = extra.commandWindows;
    const nextGroup = {
      ...group,
      hooks: group.hooks.map((item, index) => (index === hookIndex ? nextHook : item)),
    };
    const nextEvents = events.slice();
    nextEvents[groupIndex] = nextGroup;
    return { hooks: { ...hooks, SessionStart: nextEvents }, changed: true };
  }
  const handler = { type: "command", command, timeout: 8 };
  if (extra.commandWindows) handler.commandWindows = extra.commandWindows;
  const group = { ...extra };
  delete group.commandWindows;
  return {
    hooks: {
      ...hooks,
      SessionStart: [...events, { ...group, hooks: [handler] }],
    },
    changed: true,
  };
}

export function mergeSettingsFile(doc, command, extra = {}) {
  const current = doc && typeof doc === "object" ? doc : {};
  const { hooks, changed } = upsertSessionStart(current.hooks ?? {}, command, extra);
  if (!changed) return { doc: current, changed: false };
  return { doc: { ...current, hooks }, changed: true };
}

export function mergeAntigravity(doc, command) {
  const current = doc && typeof doc === "object" ? doc : {};
  if (current.pinar && isPinarEnsureCommand(JSON.stringify(current.pinar))) {
    const existing = current.pinar?.PreInvocation?.[0]?.command;
    if (existing === command) return { doc: current, changed: false };
  }
  return {
    doc: {
      ...current,
      pinar: {
        enabled: true,
        PreInvocation: [{ type: "command", command, timeout: 8 }],
      },
    },
    changed: true,
  };
}

export function grokDocument(command) {
  return mergeGrokDocument({}, command).doc;
}

export function mergeGrokDocument(doc, command) {
  const current = doc && typeof doc === "object" ? doc : {};
  const { hooks, changed } = upsertSessionStart(current.hooks ?? {}, command);
  if (!changed) return { doc: current, changed: false };
  return { doc: { ...current, hooks }, changed: true };
}

export function mergeCursorHooks(doc, command) {
  const current = doc && typeof doc === "object" ? doc : {};
  const hooks = current.hooks && typeof current.hooks === "object" ? { ...current.hooks } : {};
  const events = Array.isArray(hooks.sessionStart) ? hooks.sessionStart.slice() : [];
  const index = events.findIndex((hook) => isPinarEnsureCommand(hook?.command));
  if (index >= 0) {
    const existing = events[index];
    if (existing.command === command) return { doc: current, changed: false };
    events[index] = { ...existing, command, timeout: existing.timeout ?? 8 };
    return {
      doc: { ...current, version: current.version || 1, hooks: { ...hooks, sessionStart: events } },
      changed: true,
    };
  }
  events.push({ command, timeout: 8 });
  return {
    doc: { ...current, version: current.version || 1, hooks: { ...hooks, sessionStart: events } },
    changed: true,
  };
}

export function mergeOmpConfig(text, extensionPath) {
  const current = text ?? "";
  const encoded = JSON.stringify(extensionPath);
  if (current.includes(extensionPath) || current.includes(encoded)) {
    return { text: current, changed: false };
  }
  if (/pinar\.(ts|js)/.test(current)) {
    const next = current.replace(/["'][^"'\n]*pinar\.(ts|js)["']/, JSON.stringify(extensionPath));
    if (next !== current) return { text: next, changed: true };
  }
  const line = `  - ${JSON.stringify(extensionPath)}\n`;
  if (/^extensions:\s*$/m.test(current)) {
    return {
      text: current.replace(/^extensions:\s*$/m, `extensions:\n${line.trimEnd()}`),
      changed: true,
    };
  }
  if (/^extensions:\s*\n/m.test(current)) {
    return {
      text: current.replace(/^extensions:\s*\n/m, `extensions:\n${line}`),
      changed: true,
    };
  }
  const suffix = current.endsWith("\n") || current.length === 0 ? "" : "\n";
  return { text: `${current}${suffix}extensions:\n${line}`, changed: true };
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.pinar-tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, path);
}

async function writeText(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.pinar-tmp`;
  await writeFile(tmp, value);
  await rename(tmp, path);
}

async function linkExtension(from, to) {
  if (!existsSync(from)) return false;
  await mkdir(dirname(to), { recursive: true });
  try {
    const current = lstatSync(to);
    if (current.isSymbolicLink() && readlinkSync(to) === from) return false;
    if (current.isFile()) {
      const [source, existing] = await Promise.all([readFile(from), readFile(to)]);
      if (Buffer.compare(source, existing) === 0) return false;
    }
  } catch {
    // missing
  }
  await rm(to, { force: true });
  try {
    await symlink(from, to);
  } catch {
    await copyFile(from, to);
  }
  return true;
}

export async function installHooks({
  home = osHomedir(),
  root = defaultRoot(),
  platform = process.platform,
  log = console.error,
} = {}) {
  const command = ensureCommand(root, { home, platform });
  const antigravityCommand = ensureCommand(root, {
    home,
    json: true,
    platform,
  });
  const commandWindows = ensureCommandWindows(root);
  const extension = hookExtensionPath(root);
  const changed = [];

  const claudePath = join(home, ".claude", "settings.json");
  const claude = mergeSettingsFile(await readJson(claudePath, {}), command);
  if (claude.changed) {
    await writeJson(claudePath, claude.doc);
    changed.push(claudePath);
  }

  const codexPath = join(home, ".codex", "hooks.json");
  const codexDoc = await readJson(codexPath, { hooks: {} });
  const codexHooks = upsertSessionStart(codexDoc.hooks ?? {}, command, {
    commandWindows,
  });
  if (codexHooks.changed) {
    await writeJson(codexPath, { ...codexDoc, hooks: codexHooks.hooks });
    changed.push(codexPath);
  }

  const grokPath = join(home, ".grok", "hooks", "pinar.json");
  const grok = mergeGrokDocument(await readJson(grokPath, {}), grokEnsureCommand(root, { home, platform }));
  if (grok.changed) {
    await writeJson(grokPath, grok.doc);
    changed.push(grokPath);
  }

  const cursorPath = join(home, ".cursor", "hooks.json");
  const cursor = mergeCursorHooks(await readJson(cursorPath, { version: 1, hooks: {} }), command);
  if (cursor.changed) {
    await writeJson(cursorPath, cursor.doc);
    changed.push(cursorPath);
  }

  const antigravityPath = join(home, ".gemini", "config", "hooks.json");
  const antigravity = mergeAntigravity(await readJson(antigravityPath, {}), antigravityCommand);
  if (antigravity.changed) {
    await writeJson(antigravityPath, antigravity.doc);
    changed.push(antigravityPath);
  }

  const piExt = join(home, ".pi", "agent", "extensions", "pinar.ts");
  if (await linkExtension(extension, piExt)) changed.push(piExt);

  const ompExt = join(home, ".omp", "agent", "extensions", "pinar.js");
  if (await linkExtension(extension, ompExt)) changed.push(ompExt);
  const ompLegacy = join(home, ".omp", "agent", "extensions", "pinar.ts");
  if (existsSync(ompLegacy)) {
    await unlink(ompLegacy);
    changed.push(ompLegacy);
  }

  const ompConfigPath = join(home, ".omp", "agent", "config.yml");
  let ompConfig = "";
  try {
    ompConfig = await readFile(ompConfigPath, "utf8");
  } catch {
    ompConfig = "";
  }
  const omp = mergeOmpConfig(ompConfig, extension);
  if (omp.changed) {
    await writeText(ompConfigPath, omp.text);
    changed.push(ompConfigPath);
  }

  if (changed.length === 0) {
    log("pinar hooks already installed");
  } else {
    log("pinar hooks installed:");
    for (const path of changed) log(`  ${path}`);
  }
  return changed;
}
