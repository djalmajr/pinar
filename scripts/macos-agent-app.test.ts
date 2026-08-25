import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { applyAgentAppFromEnv, findAppBundle, infoPlistPath, setAgentApp } from "./macos-agent-app.mjs";

const MINIMAL_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>Pinar</string>
</dict>
</plist>
`;

describe("macos agent Info.plist", () => {
  test("marks the bundle as an LSUIElement agent app", () => {
    const root = mkdtempSync(join(tmpdir(), "pinar-agent-"));
    const app = join(root, "Pinar.app");
    mkdirSync(join(app, "Contents"), { recursive: true });
    writeFileSync(infoPlistPath(app), MINIMAL_PLIST);
    expect(findAppBundle(root)).toBe(app);
    setAgentApp(app);
    const printed = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :LSUIElement", infoPlistPath(app)], {
      encoding: "utf8",
    }).trim();
    expect(printed).toBe("true");
    setAgentApp(app);
    const again = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :LSUIElement", infoPlistPath(app)], {
      encoding: "utf8",
    }).trim();
    expect(again).toBe("true");
  });

  test("applyAgentAppFromEnv patches the bundle Electrobun points at", () => {
    const root = mkdtempSync(join(tmpdir(), "pinar-agent-env-"));
    const app = join(root, "Pinar.app");
    mkdirSync(join(app, "Contents"), { recursive: true });
    writeFileSync(infoPlistPath(app), MINIMAL_PLIST);
    expect(applyAgentAppFromEnv({ ELECTROBUN_BUILD_DIR: root }, ["bun"])).toBe(true);
    const printed = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :LSUIElement", infoPlistPath(app)], {
      encoding: "utf8",
    }).trim();
    expect(printed).toBe("true");
    expect(applyAgentAppFromEnv({}, ["bun"])).toBe(false);
  });
});
