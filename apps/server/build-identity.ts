import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * What a build says about itself. The version is the root package.json; the
 * build label is empty when HEAD sits exactly on tag v<version> and the short
 * commit otherwise, so a build that runs ahead of the last release says so
 * instead of wearing the released number as if it were that release.
 */
export function buildIdentity() {
  const version: string = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
  let build = "";
  try {
    const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const onTag = (() => { try { return git("describe", "--tags", "--exact-match", "HEAD") === `v${version}`; } catch { return false; } })();
    if (!onTag) build = git("rev-parse", "--short", "HEAD");
  } catch {
    /* no git (e.g. a source tarball): treat as released */
  }
  return {
    "import.meta.env.VITE_PINAR_BUILD": JSON.stringify(build),
    "import.meta.env.VITE_PINAR_VERSION": JSON.stringify(version),
  };
}
