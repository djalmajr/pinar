import { statSync } from "node:fs";
import { posix, win32 } from "node:path";

// Explicit Hutch executable resolution (DJA-208). A bare "hutch" spawned with
// shell: true goes through cmd.exe, which searches the current directory
// before PATH; libuv's own search (shell: false) does the same on Windows. A
// hutch.cmd / hutch.bat / hutch.exe planted in the working directory would run
// instead of the installed Hutch. Resolve an absolute path from absolute PATH
// entries only, and spawn that path with shell: false.

/** The file name Hutch installs per platform (Windows: hutch.exe only). */
export function hutchExecutableName(platform = process.platform) {
  return platform === "win32" ? "hutch.exe" : "hutch";
}

function isRegularFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Return the absolute path of the first `hutch` executable found in an
 * absolute PATH entry. Empty and relative entries ("", ".", "bin") are
 * skipped, so the working directory is never searched implicitly. Windows
 * resolves `hutch.exe` only: a .cmd/.bat shim would need a shell. Throws when
 * none is found.
 */
export function resolveHutchExecutable({
  env = process.env,
  platform = process.platform,
  isFile = isRegularFile,
} = {}) {
  const pathValue = (platform === "win32" ? (env.Path ?? env.PATH ?? env.path) : env.PATH) ?? "";
  const paths = platform === "win32" ? win32 : posix;
  const name = hutchExecutableName(platform);
  for (const raw of pathValue.split(paths.delimiter)) {
    const entry = raw.trim().replace(/^"(.*)"$/, "$1");
    if (entry === "" || !paths.isAbsolute(entry)) continue;
    const candidate = paths.join(entry, name);
    if (isFile(candidate)) return candidate;
  }
  throw new Error(
    `hutch: no ${name} in an absolute PATH entry; install Hutch and put its bin directory on PATH (relative PATH entries and the working directory are not searched)`,
  );
}
