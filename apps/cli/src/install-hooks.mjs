import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir as osHomedir } from "node:os";
import { basename, dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

export function bundledHelperDir(execPath = process.execPath) {
  if (basename(execPath).toLowerCase() !== "pinar.exe") return null;
  const helperDir = dirname(execPath);
  return existsSync(join(helperDir, "ensure.mjs")) ? helperDir : null;
}

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

// Same as isPinarEnsureCommand, but the /usr/bin/open -ga form only counts when
// the -ga target is Pinar (quoted or bare) or a path ending in Pinar.app.
const OPEN_GA_TARGET = /"?\/usr\/bin\/open"?\s+-ga\s+("[^"\n]*"|'[^'\n]*'|\S+)/;

export function isPinarOwnedCommand(command = "") {
  const open = OPEN_GA_TARGET.exec(command);
  if (open) {
    const target = open[1].replace(/^["']|["']$/g, "");
    return target === "Pinar" || /(^|[/\\])Pinar\.app$/.test(target);
  }
  return (
    /hooks[/\\]ensure\.mjs/.test(command) ||
    /hooks[/\\]ensure-run\.mjs/.test(command) ||
    /hooks[/\\]ensure\.(sh|cmd)/.test(command) ||
    /[/\\]\.pinar[/\\](bin[/\\]pinar(?:\.cmd)?|hooks[/\\]ensure(?:\.mjs|\.(sh|cmd)))/.test(command)
  );
}

function isPinarHook(hook) {
  return isPinarOwnedCommand(hook?.command) || isPinarOwnedCommand(hook?.commandWindows);
}

export function upsertSessionStart(hooks, command, extra = {}) {
  const source = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
  let changed = false;
  let groupIndex = -1;
  let hookIndex = -1;
  const events = source.map((group) => ({ ...group, hooks: (group?.hooks ?? []).slice() }));
  const existingGroup = events.findIndex((group) => (group?.hooks ?? []).some(isPinarHook));
  if (existingGroup >= 0) {
    groupIndex = existingGroup;
    hookIndex = events[existingGroup].hooks.findIndex(isPinarHook);
    const hook = events[existingGroup].hooks[hookIndex];
    const same =
      hook.command === command && (extra.commandWindows === undefined || hook.commandWindows === extra.commandWindows);
    if (!same) {
      const nextHook = { ...hook, command, timeout: hook.timeout ?? 8 };
      if (extra.commandWindows) nextHook.commandWindows = extra.commandWindows;
      events[existingGroup].hooks[hookIndex] = nextHook;
      changed = true;
    }
  } else {
    const handler = { type: "command", command, timeout: 8 };
    if (extra.commandWindows) handler.commandWindows = extra.commandWindows;
    const group = { ...extra };
    delete group.commandWindows;
    events.push({ ...group, hooks: [handler] });
    groupIndex = events.length - 1;
    hookIndex = 0;
    changed = true;
  }
  const nextEvents = [];
  for (const [i, group] of events.entries()) {
    const originalHadHooks = i < source.length ? Array.isArray(source[i]?.hooks) : true;
    const kept = (group?.hooks ?? []).filter((hook, j) => {
      if (i === groupIndex && j === hookIndex) return true;
      if (isPinarHook(hook)) {
        changed = true;
        return false;
      }
      return true;
    });
    if (!originalHadHooks) {
      const rest = { ...group };
      delete rest.hooks;
      nextEvents.push(rest);
      continue;
    }
    if (kept.length > 0 || source[i].hooks.length === 0) nextEvents.push({ ...group, hooks: kept });
  }
  return { hooks: { ...hooks, SessionStart: nextEvents }, changed };
}

export function mergeSettingsFile(doc, command, extra = {}) {
  const current = doc && typeof doc === "object" ? doc : {};
  const { hooks, changed } = upsertSessionStart(current.hooks ?? {}, command, extra);
  if (!changed) return { doc: current, changed: false };
  return { doc: { ...current, hooks }, changed: true };
}

export function mergeAntigravity(doc, command) {
  const current = doc && typeof doc === "object" ? doc : {};
  // compare the parsed command (raw backslashes): JSON.stringify would escape
  // Windows paths and defeat isPinarEnsureCommand's regexes
  const existing = current.pinar?.PreInvocation?.[0]?.command;
  if (isPinarEnsureCommand(existing) && existing === command) {
    return { doc: current, changed: false };
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
  const source = Array.isArray(hooks.sessionStart) ? hooks.sessionStart.slice() : [];
  let changed = false;
  let index = source.findIndex(isPinarHook);
  if (index >= 0) {
    const existing = source[index];
    if (existing.command !== command) {
      source[index] = { ...existing, command, timeout: existing.timeout ?? 8 };
      changed = true;
    }
  } else {
    source.push({ command, timeout: 8 });
    index = source.length - 1;
    changed = true;
  }
  const sessionStart = source.filter((hook, i) => {
    if (i === index) return true;
    if (isPinarHook(hook)) {
      changed = true;
      return false;
    }
    return true;
  });
  return {
    doc: { ...current, version: current.version || 1, hooks: { ...hooks, sessionStart } },
    changed,
  };
}

function ompItemValue(raw) {
  const text = raw.trim().replace(/^-\s+/, "");
  const first = text[0];
  if (first === '\"') {
    let value = "";
    let i = 1;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\') {
        const next = text[i + 1];
        if (next === '\"' || next === '\\') {
          value += next;
          i += 2;
          continue;
        }
        value += ch;
        i += 1;
        continue;
      }
      if (ch === '\"') break;
      value += ch;
      i += 1;
    }
    return value;
  }
  if (first === "'") {
    let value = "";
    let i = 1;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "'") {
        if (text[i + 1] === "'") {
          value += "'";
          i += 2;
          continue;
        }
        break;
      }
      value += ch;
      i += 1;
    }
    return value;
  }
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "#" && i > 0 && (text[i - 1] === " " || text[i - 1] === "\t")) {
      return text.slice(0, i).trim();
    }
  }
  return text.trim();
}

function isPinarExtensionValue(raw) {
  return /[/\\]pinar\.(js|ts)$/.test(ompItemValue(raw));
}

export function mergeOmpConfig(text, extensionPath) {
  const current = text ?? "";
  const encoded = JSON.stringify(extensionPath);
  const crlf = current.includes("\r\n") ? "\r" : "";
  const lines = current.split("\n");
  const isItemLine = (line) => /^\s*-\s/.test(line);
  const index = lines.findIndex((line) => /^extensions:\s*(?:#.*)?$/.test(line));
  if (index === -1) {
    const suffix = current.endsWith("\n") || current.length === 0 ? "" : "\n";
    return { text: `${current}${suffix}extensions:${crlf}\n  - ${encoded}${crlf}\n`, changed: true };
  }
  // the block runs until the next line that starts unindented and is not blank/comment
  let end = index + 1;
  while (end < lines.length && !/^[^\s#]/.test(lines[end])) end += 1;
  const kept = lines.slice(index + 1, end).filter((line) => !isItemLine(line) || !isPinarExtensionValue(line));
  const next = [...lines.slice(0, index), lines[index], `  - ${encoded}${crlf}`, ...kept, ...lines.slice(end)].join("\n");
  return { text: next, changed: next !== current };
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

async function writeIfChanged(path, value) {
  try {
    const current = await readFile(path);
    if (Buffer.compare(current, Buffer.from(value)) === 0) return false;
  } catch {
    // missing
  }
  await writeText(path, value);
  return true;
}

async function materializeBundledHelper(helperDir, pinarHomeDir, execPath) {
  for (const name of ["ensure.mjs", "pinar.js"]) {
    let content;
    try {
      content = await readFile(join(helperDir, name));
    } catch {
      continue;
    }
    await writeIfChanged(join(pinarHomeDir, "hooks", name), content);
  }
  if (!existsSync(join(pinarHomeDir, "bin", "pinar.exe"))) {
    const command = `@echo off\r\n"${execPath}" %*\r\nexit /b %ERRORLEVEL%\r\n`;
    await writeIfChanged(join(pinarHomeDir, "bin", "pinar.cmd"), command);
  }
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
  execPath = process.execPath,
  log = console.error,
} = {}) {
  const pinarHomeDir = process.env.PINAR_HOME ?? join(home, ".pinar");
  if (platform === "win32" && !process.env.PINAR_SOURCE) {
    const helperDir = bundledHelperDir(execPath);
    if (helperDir != null) {
      await materializeBundledHelper(helperDir, pinarHomeDir, execPath);
      root = pinarHomeDir;
    }
  }
  const command = ensureCommand(root, { home, platform });
  const antigravityCommand = ensureCommand(root, {
    home,
    json: true,
    platform,
  });
  const commandWindows = ensureCommandWindows(root);
  const extension = hookExtensionPath(root, execPath);
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
