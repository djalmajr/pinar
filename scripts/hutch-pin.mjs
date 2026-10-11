import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveHutchExecutable } from "./hutch-exe.mjs";

// Upstream pin mechanism (verified by `hutch self pin` / `hutch cottontail pin`):
// Hutch writes a single first-line marker `// @hutch cli=<version>` into
// hutch.config.ts and appends a `cottontail=<version>` key when a build-time
// Cottontail pin exists (`// @hutch cli=0.25.0 cottontail=0.7.2-canary.6`).
// Inside that directory and its subdirectories `hutch --version` resolves to
// the pinned version, while outside it prints the global selection. The
// project pins Hutch and the build-time Cottontail to the versions CI and the
// release build use so local builds converge.
//
// DJA-208: hutch is spawned as the explicit absolute executable resolved from
// absolute PATH entries only, never as a bare "hutch" through a shell (a
// shell, and libuv's own search, look in the working directory before PATH,
// where a planted hutch.cmd / hutch.exe would run instead).

function readHutchPinValue(configText, key) {
  const re = new RegExp(`^//\\s*@hutch\\s+[^\\n]*?\\b${key}=(\\S+)`, "m");
  const match = re.exec(configText ?? "");
  return match ? match[1] : null;
}

export function readHutchCliPin(configText) {
  return readHutchPinValue(configText, "cli");
}

export function readHutchCottontailPin(configText) {
  return readHutchPinValue(configText, "cottontail");
}

export function parseHutchVersionOutput(stdout) {
  const lines = (stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1];
  const tokens = last.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g);
  return tokens && tokens.length > 0 ? tokens[tokens.length - 1] : null;
}

function runHutchChecked({ spawn, executable, args, command, what, trayDir }) {
  let result;
  try {
    result = spawn(executable, args, {
      cwd: trayDir,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`run-tray: cannot read ${what} in ${trayDir}: ${command} spawn failed: ${error.message}`);
  }
  if (result.error || result.status !== 0) {
    throw new Error(
      `run-tray: cannot read ${what} in ${trayDir}: ${command} failed` +
        ` (exit status ${result.status ?? "n/a"}${result.error ? `, spawn error: ${result.error.message}` : ""};` +
        ` stderr: ${(result.stderr ?? "").trim() || "<empty>"})`,
    );
  }
  const version = parseHutchVersionOutput(result.stdout);
  if (!version) {
    throw new Error(
      `run-tray: cannot read ${what} in ${trayDir}: ${command} produced no parsable version` +
        ` (stdout: ${JSON.stringify((result.stdout ?? "").trim() || "<empty>")})`,
    );
  }
  return version;
}

export function assertHutchMatchesPin({
  trayDir,
  spawnSync: spawn = spawnSync,
  resolve = () => resolveHutchExecutable(),
} = {}) {
  const configPath = join(trayDir, "hutch.config.ts");
  const configText = readFileSync(configPath, "utf8");
  const pin = readHutchCliPin(configText);
  if (!pin) {
    throw new Error(`run-tray: ${configPath} has no "// @hutch cli=<version>" pin`);
  }
  let executable;
  try {
    executable = resolve();
  } catch (error) {
    throw new Error(`run-tray: cannot resolve the Hutch executable: ${error.message}`);
  }
  const version = runHutchChecked({
    spawn,
    executable,
    args: ["--version"],
    command: "hutch --version",
    what: "the Hutch version",
    trayDir,
  });
  if (version !== pin) {
    throw new Error(
      `run-tray: Hutch ${version} does not match the project pin ${pin} in ${configPath}; install or select Hutch ${pin}`,
    );
  }
  const cottontailPin = readHutchCottontailPin(configText);
  if (cottontailPin) {
    const cottontailVersion = runHutchChecked({
      spawn,
      executable,
      args: ["cottontail", "version", cottontailPin],
      command: `hutch cottontail version ${cottontailPin}`,
      what: "the Hutch Cottontail version",
      trayDir,
    });
    if (cottontailVersion !== cottontailPin) {
      throw new Error(
        `run-tray: Hutch cottontail ${cottontailVersion} does not match the project pin ${cottontailPin} in ${configPath}; install or select Hutch cottontail ${cottontailPin}`,
      );
    }
  }
  return version;
}
