import { spawnSync } from "node:child_process";
import { join } from "node:path";

const home = process.env.PINAR_E2E_HOME;
if (!home) throw new Error("PINAR_E2E_HOME must be set by playwright.cloud.config.ts");

const result = spawnSync("bun", [
  "run", "dev:cloud", "--", "--port", process.argv[2] ?? "17384",
  "--state-path", join(home, "cloud-state"),
], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
