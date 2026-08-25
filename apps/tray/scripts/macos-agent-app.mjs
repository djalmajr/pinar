import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function infoPlistPath(bundle) {
  return join(bundle, "Contents", "Info.plist");
}

export function setAgentApp(bundle) {
  const plist = infoPlistPath(bundle);
  if (!existsSync(plist)) throw new Error(`missing Info.plist in ${bundle}`);
  try {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", "Add :LSUIElement bool true", plist], {
      stdio: "pipe",
    });
  } catch {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", "Set :LSUIElement true", plist], {
      stdio: "pipe",
    });
  }
}

export function findAppBundle(directory) {
  if (!directory || !existsSync(directory)) return null;
  const match = readdirSync(directory).find((name) => name.endsWith(".app"));
  return match ? join(directory, match) : null;
}

export function resolveBundle(env = process.env, argv = process.argv) {
  if (env.ELECTROBUN_WRAPPER_BUNDLE_PATH) return env.ELECTROBUN_WRAPPER_BUNDLE_PATH;
  const fromEnv = findAppBundle(env.ELECTROBUN_BUILD_DIR);
  if (fromEnv) return fromEnv;
  const arg = argv[2];
  return arg?.endsWith(".app") ? arg : null;
}

export function applyAgentAppFromEnv(env = process.env, argv = process.argv) {
  const bundle = resolveBundle(env, argv);
  if (!bundle) return false;
  setAgentApp(bundle);
  console.error(`macos-agent-app: LSUIElement=true in ${bundle}`);
  return true;
}

if (applyAgentAppFromEnv()) {
  // Electrobun imports this file as a module; import.meta.main is false.
} else if (import.meta.main) {
  console.error("macos-agent-app: no .app bundle path");
  process.exit(1);
}
