import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDeps, syncCottontailRuntime } from "./cottontail-runtime-sync.mjs";

const trayRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// The Cottontail 0.7.x runtime sync logic lives in ./cottontail-runtime-sync.mjs
// so it can be exercised by tests in isolation. This hook only reports the sync
// outcome and performs the platform-specific post-build steps (macOS agent-app
// patch; Windows installer copy to artifacts/). A thrown error is not caught so
// the post-build hook exits nonzero and fails the build.

if (process.platform === "darwin") {
  const buildDir = process.env.ELECTROBUN_BUILD_DIR ?? join(trayRoot, "build", "stable-macos-" + (process.arch === "arm64" ? "arm64" : "x64"));
  console.log(`post-build: cottontail runtime sync: ${syncCottontailRuntime(buildDir, defaultDeps)}`);
  await import("./macos-agent-app.mjs");
}

if (process.platform === "win32") {
  const buildDir = process.env.ELECTROBUN_BUILD_DIR ?? join(trayRoot, "build", "stable-win-x64");
  console.log(`post-build: cottontail runtime sync: ${syncCottontailRuntime(buildDir, defaultDeps)}`);
  const setup = join(trayRoot, "build", "stable-win-x64", "Pinar-Setup.exe");
  if (existsSync(setup)) {
    const artifacts = join(trayRoot, "artifacts");
    mkdirSync(artifacts, { recursive: true });
    copyFileSync(setup, join(artifacts, "win-x64-Pinar-Setup.exe"));
  }
}
