import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir as osHomedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function defaultRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

export function ensureScript(root, platform = process.platform) {
  return join(root, "hooks", platform === "win32" ? "ensure.cmd" : "ensure.sh");
}

export function ensureCommand(root, { json = false, platform = process.platform } = {}) {
  const quoted = `"${ensureScript(root, platform)}"`;
  if (!json) return quoted;
  if (platform === "win32") return `set PINAR_HOOK_JSON=1&& ${quoted}`;
  return `PINAR_HOOK_JSON=1 ${quoted}`;
}

export function ensureCommandWindows(root, { json = false } = {}) {
  return ensureCommand(root, { json, platform: "win32" });
}

export function isPinarEnsureCommand(command = "") {
  return (
    /hooks[/\\]ensure\.(sh|cmd)/.test(command) ||
    /[/\\]\.pinar[/\\](bin[/\\]pinar(?:\.cmd)?|hooks[/\\]ensure\.(sh|cmd))/.test(command)
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
      hook.command === command &&
      (extra.commandWindows === undefined || hook.commandWindows === extra.commandWindows);
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
  return {
    hooks: {
      SessionStart: [
        {
          hooks: [{ type: "command", command, timeout: 8 }],
        },
      ],
    },
  };
}

export function mergeOmpConfig(text, extensionPath) {
  const current = text ?? "";
  if (current.includes(extensionPath)) {
    return { text: current, changed: false };
  }
  if (/pinar\.(ts|js)/.test(current)) {
    const next = current.replace(/["'][^"'\n]*pinar\.(ts|js)["']/, JSON.stringify(extensionPath));
    if (next !== current) return { text: next, changed: true };
  }
  const line = `  - ${JSON.stringify(extensionPath)}\n`;
  if (/^extensions:\s*$/m.test(current)) {
    return { text: current.replace(/^extensions:\s*$/m, `extensions:\n${line.trimEnd()}`), changed: true };
  }
  if (/^extensions:\s*\n/m.test(current)) {
    return { text: current.replace(/^extensions:\s*\n/m, `extensions:\n${line}`), changed: true };
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
  await mkdir(dirname(to), { recursive: true });
  try {
    if (lstatSync(to).isSymbolicLink() && readlinkSync(to) === from) return false;
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
  const command = ensureCommand(root, { platform });
  const antigravityCommand = ensureCommand(root, { json: true, platform });
  const commandWindows = ensureCommandWindows(root);
  const extension = join(root, "hooks", "pinar.js");
  const changed = [];

  const claudePath = join(home, ".claude", "settings.json");
  const claude = mergeSettingsFile(await readJson(claudePath, {}), command);
  if (claude.changed) {
    await writeJson(claudePath, claude.doc);
    changed.push(claudePath);
  }

  const codexPath = join(home, ".codex", "hooks.json");
  const codexDoc = await readJson(codexPath, { hooks: {} });
  const codexHooks = upsertSessionStart(codexDoc.hooks ?? {}, command, { commandWindows });
  if (codexHooks.changed) {
    await writeJson(codexPath, { ...codexDoc, hooks: codexHooks.hooks });
    changed.push(codexPath);
  }

  const grokPath = join(home, ".grok", "hooks", "pinar.json");
  const grokWanted = grokDocument(command);
  const grokExisting = await readJson(grokPath, null);
  if (JSON.stringify(grokExisting) !== JSON.stringify(grokWanted)) {
    await writeJson(grokPath, grokWanted);
    changed.push(grokPath);
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
