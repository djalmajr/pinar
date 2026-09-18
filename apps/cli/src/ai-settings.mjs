import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensurePinarHome, pinarHome } from "./paths.mjs";

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stderr, stdout });
      else reject(Object.assign(new Error(stderr || `${command} exited with ${code}`), { code }));
    });
    child.stdin.end(typeof options.input === "string" ? options.input : undefined);
  });
}
const SETTINGS_FILE = "ai.json";
const SERVICE = "dev.pinar.ai";
const ACCOUNT = "local-server";
const MODES = new Set(["disabled", "local", "byok"]);

function settingsPath(root) {
  return join(root, SETTINGS_FILE);
}

function metadata(value) {
  const mode = MODES.has(value?.mode) ? value.mode : "disabled";
  return {
    endpoint: typeof value?.endpoint === "string" ? value.endpoint.trim() : "",
    mode,
    model: typeof value?.model === "string" ? value.model.trim() : "",
  };
}

function powershellEncoded(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

function psLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function createAiCredentialVault({ platform = process.platform, run = runCommand } = {}) {
  if (platform === "darwin") {
    return {
      async get() {
        try {
          const result = await run("security", ["find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w"]);
          return String(result.stdout || "").trim() || null;
        } catch {
          return null;
        }
      },
      async set(secret) {
        await run("security", ["add-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w", secret, "-U"]);
      },
      async clear() {
        try {
          await run("security", ["delete-generic-password", "-a", ACCOUNT, "-s", SERVICE]);
        } catch {
          // Deleting an absent credential is already the desired state.
        }
      },
    };
  }
  if (platform === "win32") {
    const invoke = async (script) => run("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", powershellEncoded(script),
    ]);
    const preamble = "[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime];$v=New-Object Windows.Security.Credentials.PasswordVault;";
    return {
      async get() {
        try {
          const result = await invoke(`${preamble}$c=$v.Retrieve(${psLiteral(SERVICE)},${psLiteral(ACCOUNT)});$c.RetrievePassword();[Console]::Out.Write($c.Password)`);
          return String(result.stdout || "").trim() || null;
        } catch {
          return null;
        }
      },
      async set(secret) {
        await invoke(`${preamble}try{$old=$v.Retrieve(${psLiteral(SERVICE)},${psLiteral(ACCOUNT)});$v.Remove($old)}catch{};$v.Add([Windows.Security.Credentials.PasswordCredential]::new(${psLiteral(SERVICE)},${psLiteral(ACCOUNT)},${psLiteral(secret)}))`);
      },
      async clear() {
        try {
          await invoke(`${preamble}$c=$v.Retrieve(${psLiteral(SERVICE)},${psLiteral(ACCOUNT)});$v.Remove($c)`);
        } catch {
          // Deleting an absent credential is already the desired state.
        }
      },
    };
  }
  return {
    async get() {
      try {
        const result = await run("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT]);
        return String(result.stdout || "").trim() || null;
      } catch {
        return null;
      }
    },
    async set(secret) {
      await run("secret-tool", ["store", "--label=Pinar AI", "service", SERVICE, "account", ACCOUNT], { input: secret });
    },
    async clear() {
      try {
        await run("secret-tool", ["clear", "service", SERVICE, "account", ACCOUNT]);
      } catch {
        // Deleting an absent credential is already the desired state.
      }
    },
  };
}

export async function readAiSettings(root = pinarHome(), vault = createAiCredentialVault()) {
  let stored = {};
  try {
    if (existsSync(settingsPath(root))) stored = JSON.parse(readFileSync(settingsPath(root), "utf8"));
  } catch {
    stored = {};
  }
  const result = metadata(stored);
  const apiKey = result.mode === "byok" ? await vault.get() : null;
  return { ...result, ...(apiKey ? { apiKey } : {}), hasApiKey: Boolean(apiKey) };
}

export async function writeAiSettings(value, root = pinarHome(), vault = createAiCredentialVault()) {
  const next = metadata(value);
  if (next.mode !== "disabled" && (!next.endpoint || !next.model)) {
    throw new Error("endpoint_and_model_required");
  }
  if (next.mode === "byok") {
    if (typeof value?.apiKey === "string" && value.apiKey) await vault.set(value.apiKey);
    else if (!(await vault.get())) throw new Error("api_key_required");
  } else {
    await vault.clear();
  }
  ensurePinarHome(root);
  writeFileSync(settingsPath(root), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return { ...next, hasApiKey: next.mode === "byok" };
}
