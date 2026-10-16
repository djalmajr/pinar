import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  applyAgentAppFromEnv,
  findAppBundle,
  infoPlistPath,
  resolveBundle,
  setAgentApp,
} from "./macos-agent-app.mjs";

const MINIMAL_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>Pinar</string>
</dict>
</plist>
`;

type RunCall = {
  file: string;
  args: string[];
  options?: { stdio?: string };
};

function recordingRun(calls: RunCall[], failAdd = false) {
  return (file: string, args: string[], options?: { stdio?: string }) => {
    calls.push({ file, args, options });
    if (failAdd && args[1]?.startsWith("Add")) throw new Error("PlistBuddy: Could not add key");
  };
}

function makeBundle(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const app = join(root, "Pinar.app");
  mkdirSync(join(app, "Contents"), { recursive: true });
  writeFileSync(infoPlistPath(app), MINIMAL_PLIST);
  return { root, app };
}

describe("macos agent Info.plist", () => {
  test.if(
    process.platform === "darwin",
    "marks the bundle as an LSUIElement agent app",
    () => {
      const { root, app } = makeBundle("pinar-agent-");
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
      rmSync(root, { recursive: true, force: true });
    },
  );

  test.if(
    process.platform === "darwin",
    "applyAgentAppFromEnv patches the bundle Electrobun points at",
    () => {
      const { root, app } = makeBundle("pinar-agent-env-");
      expect(applyAgentAppFromEnv({ ELECTROBUN_BUILD_DIR: root }, ["bun"])).toBe(true);
      const printed = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :LSUIElement", infoPlistPath(app)], {
        encoding: "utf8",
      }).trim();
      expect(printed).toBe("true");
      expect(applyAgentAppFromEnv({}, ["bun"])).toBe(false);
      rmSync(root, { recursive: true, force: true });
    },
  );

  test("setAgentApp adds LSUIElement through PlistBuddy", () => {
    const { root, app } = makeBundle("pinar-agent-fake-");
    const calls: RunCall[] = [];
    try {
      setAgentApp(app, recordingRun(calls));
      expect(calls).toEqual([
        {
          file: "/usr/libexec/PlistBuddy",
          args: ["-c", "Add :LSUIElement bool true", infoPlistPath(app)],
          options: { stdio: "pipe" },
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("setAgentApp falls back to Set when Add fails", () => {
    const { root, app } = makeBundle("pinar-agent-fallback-");
    const calls: RunCall[] = [];
    try {
      setAgentApp(app, recordingRun(calls, true));
      expect(calls).toEqual([
        {
          file: "/usr/libexec/PlistBuddy",
          args: ["-c", "Add :LSUIElement bool true", infoPlistPath(app)],
          options: { stdio: "pipe" },
        },
        {
          file: "/usr/libexec/PlistBuddy",
          args: ["-c", "Set :LSUIElement true", infoPlistPath(app)],
          options: { stdio: "pipe" },
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("setAgentApp rejects a bundle without Info.plist without calling the executor", () => {
    const root = mkdtempSync(join(tmpdir(), "pinar-agent-missing-"));
    const app = join(root, "Pinar.app");
    mkdirSync(app, { recursive: true });
    const calls: RunCall[] = [];
    try {
      expect(() => setAgentApp(app, recordingRun(calls))).toThrow(`missing Info.plist in ${app}`);
      expect(calls).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("applyAgentAppFromEnv patches the bundle the build dir points at and declines without one", () => {
    const { root, app } = makeBundle("pinar-agent-env-fake-");
    const calls: RunCall[] = [];
    try {
      expect(applyAgentAppFromEnv({ ELECTROBUN_BUILD_DIR: root }, ["bun"], recordingRun(calls))).toBe(true);
      expect(calls).toEqual([
        {
          file: "/usr/libexec/PlistBuddy",
          args: ["-c", "Add :LSUIElement bool true", infoPlistPath(app)],
          options: { stdio: "pipe" },
        },
      ]);
      const none: RunCall[] = [];
      expect(applyAgentAppFromEnv({}, ["bun"], recordingRun(none))).toBe(false);
      expect(none).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("resolveBundle prefers the wrapper bundle path, then the build dir, then argv", () => {
    const { root, app } = makeBundle("pinar-agent-resolve-");
    const wrapper = join(root, "Wrapper.app");
    try {
      expect(
        resolveBundle({ ELECTROBUN_WRAPPER_BUNDLE_PATH: wrapper, ELECTROBUN_BUILD_DIR: root }, ["bun", "", app]),
      ).toBe(wrapper);
      expect(resolveBundle({ ELECTROBUN_BUILD_DIR: root }, ["bun", "", wrapper])).toBe(app);
      expect(resolveBundle({}, ["bun", "", wrapper])).toBe(wrapper);
      expect(resolveBundle({}, ["bun", "", "not-an-app"])).toBe(null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
