import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Upstream pin mechanism (verified by `hutch self pin`): Hutch writes a single
// first-line marker `// @hutch cli=<version>` into hutch.config.ts. Inside that
// directory and its subdirectories `hutch --version` resolves to the pinned
// version, while outside it prints the global selection. The project pins
// Hutch to the version CI and the release build use so local builds converge.

export function readHutchCliPin(configText) {
  const match = /^\/\/\s*@hutch\s+cli=(\S+)\s*$/m.exec(configText ?? "");
  return match ? match[1] : null;
}

export function parseHutchVersionOutput(stdout) {
  const lines = (stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1];
  const tokens = last.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g);
  return tokens && tokens.length > 0 ? tokens[tokens.length - 1] : null;
}

export function assertHutchMatchesPin({ trayDir, spawnSync: spawn = spawnSync }) {
  const configPath = join(trayDir, "hutch.config.ts");
  const pin = readHutchCliPin(readFileSync(configPath, "utf8"));
  if (!pin) {
    throw new Error(`run-tray: ${configPath} has no "// @hutch cli=<version>" pin`);
  }
  let result;
  try {
    result = spawn("hutch", ["--version"], {
      cwd: trayDir,
      encoding: "utf8",
      shell: process.platform === "win32",
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`run-tray: cannot read the Hutch version in ${trayDir}: ${error.message}`);
  }
  if (result.error || result.status !== 0) {
    throw new Error(
      `run-tray: cannot read the Hutch version in ${trayDir}: hutch --version failed` +
        ` (exit status ${result.status ?? "n/a"}${result.error ? `, spawn error: ${result.error.message}` : ""};` +
        ` stderr: ${(result.stderr ?? "").trim() || "<empty>"})`,
    );
  }
  const version = parseHutchVersionOutput(result.stdout);
  if (!version) {
    throw new Error(
      `run-tray: cannot read the Hutch version in ${trayDir}: hutch --version produced no parsable version` +
        ` (stdout: ${JSON.stringify((result.stdout ?? "").trim() || "<empty>")})`,
    );
  }
  if (version !== pin) {
    throw new Error(
      `run-tray: Hutch ${version} does not match the project pin ${pin} in ${configPath}; install or select Hutch ${pin}`,
    );
  }
  return version;
}
