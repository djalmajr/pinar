/**
 * Unit tests for `edger-dev.ts`. The proofs run against a fake fetch and
 * the environment checks resolve against `process.execPath` and fresh temp
 * dirs; the shutdown tests are the exception: they spawn small real
 * fixture processes (bun scripts that ignore SIGTERM) and stop them
 * through the production group escalation. Nothing reaches the network.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildStagingEnvFile,
  childGroups,
  edgerEnvError,
  groupAlive,
  parseDevArgs,
  retireGoneGroups,
  runProofs,
  stopChildGroups,
  writePrivateFile,
  type ProofFetch,
  type ProofResponse,
} from "./edger-dev";
import { parseEnvFile } from "./edger-install";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { force: true, recursive: true }));
  return dir;
}

// --- shutdown fixtures -----------------------------------------------------
//
// A fixture only counts as started once it has installed its SIGTERM
// handler and written the ready file: a signal sent during bun's startup
// window would hit the default action, not the handler.

const SIGTERM_IGNORING_SOURCE = [
  'import { writeFileSync } from "node:fs";',
  'process.on("SIGTERM", () => {',
  '  writeFileSync(process.env.TERM_MARKER ?? "/dev/null", "term");',
  "});",
  'writeFileSync(process.env.READY_FILE ?? "/dev/null", "ready");',
  "setInterval(() => {}, 1_000);",
  "",
].join("\n");

/**
 * The leader fixture: spawns the ignoring fixture in its own group (the
 * leader is a group leader, so no `detached` on the inner spawn), waits
 * for the descendant's ready file, prints the descendant's PID and exits.
 */
const LEADER_SOURCE = [
  'import { spawn } from "node:child_process";',
  'import { existsSync } from "node:fs";',
  "const descendant = spawn(process.execPath, [process.argv[2]], { stdio: \"ignore\", env: process.env });",
  "process.stdout.write(String(descendant.pid));",
  "const end = Date.now() + 5_000;",
  'while (!existsSync(process.env.READY_FILE ?? "") && Date.now() < end) {',
  "  await new Promise((resolve) => setTimeout(resolve, 20));",
  "}",
  "process.exit(0);",
  "",
].join("\n");

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (cond()) return true;
    if (Date.now() >= end) return cond();
    await sleepMs(25);
  }
}

function killQuiet(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

function killGroupQuiet(pgid: number | undefined): void {
  if (pgid === undefined) return;
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    // group already gone
  }
}

function jsonResponse(status: number, body: unknown, contentType = "application/json"): ProofResponse {
  const text = JSON.stringify(body);
  return {
    contentType,
    json: async () => body,
    status,
    text: async () => text,
  };
}

function textResponse(status: number, body: string, contentType = "text/plain"): ProofResponse {
  return {
    contentType,
    json: async () => {
      throw new Error("not JSON");
    },
    status,
    text: async () => body,
  };
}

// The dev loop writes 0600 env files and stops children by POSIX process group;
// Windows has neither, so those suites run on macOS and Linux only.
const isWindows = process.platform === "win32";

describe("parseDevArgs", () => {
  test("accepts the three flags, alone or combined, and skips --", () => {
    expect(parseDevArgs([])).toEqual({ build: true, once: false, platformProofs: false });
    expect(parseDevArgs(["--no-build"])).toEqual({ build: false, once: false, platformProofs: false });
    expect(parseDevArgs(["--once"])).toEqual({ build: true, once: true, platformProofs: false });
    expect(parseDevArgs(["--platform-proofs"])).toEqual({
      build: true,
      once: false,
      platformProofs: true,
    });
    expect(parseDevArgs(["--", "--no-build", "--once"])).toEqual({
      build: false,
      once: true,
      platformProofs: false,
    });
    expect(parseDevArgs(["--once", "--no-build", "--", "--platform-proofs"])).toEqual({
      build: false,
      once: true,
      platformProofs: true,
    });
  });

  test("rejects an unknown argument, listing the accepted flags", () => {
    expect(() => parseDevArgs(["--port", "1234"])).toThrow(
      /unknown argument: --port \(expected --no-build, --once or --platform-proofs\)/,
    );
    expect(() => parseDevArgs(["--no-build", "--bogus"])).toThrow(/unknown argument: --bogus/);
  });
});

const GUIDE_LINES = [
  "git -C <edger repo> archive <tag> | tar -x -C <dir>",
  "CARGO_TARGET_DIR=<dir>/target cargo build -p edger-orchestrator --bin edger",
  "EDGER_BIN=<dir>/target/debug/edger EDGER_SRC=<dir>",
];

describe("edgerEnvError", () => {
  test("reports a missing EDGER_BIN with the guide, before looking at EDGER_SRC", () => {
    const message = edgerEnvError({});
    expect(message).not.toBeNull();
    expect(message).toContain("EDGER_BIN");
    expect(message).not.toContain("EDGER_SRC must");
    for (const line of GUIDE_LINES) expect(message).toContain(line);
  });

  test("a set-but-invalid EDGER_BIN is rejected the same way", () => {
    const missing = edgerEnvError({ EDGER_BIN: "/nonexistent/edger-bin" });
    expect(missing).toContain("EDGER_BIN");
    for (const line of GUIDE_LINES) expect(missing).toContain(line);
  });

  test("reports a missing EDGER_SRC once EDGER_BIN resolves", () => {
    const message = edgerEnvError({ EDGER_BIN: process.execPath });
    expect(message).not.toBeNull();
    expect(message).toContain("EDGER_SRC must be a directory containing workers/core");
    for (const line of GUIDE_LINES) expect(message).toContain(line);
  });

  test("a source dir without workers/core is rejected", () => {
    const dir = tempDir("pinar-edger-dev-test-src-");
    const message = edgerEnvError({ EDGER_BIN: process.execPath, EDGER_SRC: dir });
    expect(message).toContain("EDGER_SRC");
  });

  test("accepts a valid pair", () => {
    const dir = tempDir("pinar-edger-dev-test-src-");
    mkdirSync(join(dir, "workers", "core"), { recursive: true });
    expect(edgerEnvError({ EDGER_BIN: process.execPath, EDGER_SRC: dir })).toBeNull();
  });
});

describe.skipIf(isWindows)("buildStagingEnvFile + writePrivateFile (POSIX file modes)", () => {
  test("the env file comes out at mode 0600 with exactly the expected keys", () => {
    const dir = tempDir("pinar-edger-dev-test-env-");
    const path = join(dir, "stg.env");
    writePrivateFile(path, buildStagingEnvFile("http://127.0.0.1:17999"));
    expect(statSync(path).mode & 0o777).toBe(0o600);

    const entries = parseEnvFile(readFileSync(path, "utf8"));
    expect([...entries.keys()].sort()).toEqual([
      "AUTH_PEPPER",
      "DATABASE_URL",
      "DEPLOYMENT_ENV",
      "EXTENSION_ORIGIN",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]);
    expect(entries.get("DATABASE_URL")).toBe("http://127.0.0.1:17999");
    // The installer's required identity (it refuses an env file without it).
    expect(entries.get("DEPLOYMENT_ENV")).toBe("staging");
    // The fictional values all contain `local` and never look real.
    expect(entries.get("AUTH_PEPPER")).toContain("local");
    expect(entries.get("EXTENSION_ORIGIN")).toBe(
      "chrome-extension://bobfbkbogoiemdcjchoakflgepmekdeh",
    );
    expect(entries.get("STRIPE_SECRET_KEY")).toBe("sk_test_local_not_configured");
    expect(entries.get("STRIPE_WEBHOOK_SECRET")).toBe("whsec_local_not_configured");
  });

  test("rewrite over an existing file keeps the private mode", () => {
    const dir = tempDir("pinar-edger-dev-test-env-");
    const path = join(dir, "stg.env");
    writePrivateFile(path, buildStagingEnvFile("http://127.0.0.1:1"));
    writePrivateFile(path, buildStagingEnvFile("http://127.0.0.1:2"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toContain("http://127.0.0.1:2");
  });
});

describe("runProofs", () => {
  const goodFetch: ProofFetch = async (url, init) => {
    // The unknown-host proof must come first: it reuses /api/health.
    if (init.headers["Host"] === "evil.example") return textResponse(404, "Not found");
    if (url.endsWith("/api/health")) return jsonResponse(200, { service: "pinar", hasDb: true });
    if (url.endsWith("/api/pricing")) return jsonResponse(200, { currency: "BRL" });
    if (url.endsWith("/_internal/cron/daily")) return textResponse(404, "Not found");
    return textResponse(200, "<!doctype html>", "text/html; charset=utf-8");
  };

  test("all five proofs pass with good responses", async () => {
    const outcome = await runProofs(18081, goodFetch);
    expect(outcome.allOk).toBe(true);
    expect(outcome.lines).toHaveLength(5);
    for (const line of outcome.lines) expect(line.startsWith("ok ")).toBe(true);
  });

  test("sends the Host and per-proof headers", async () => {
    const calls: Array<{ headers: Record<string, string>; method: string; url: string }> = [];
    const fetchImpl: ProofFetch = async (url, init) => {
      calls.push({ headers: init.headers, method: init.method, url });
      return goodFetch(url, init);
    };
    await runProofs(18082, fetchImpl);
    const find = (suffix: string, host: string) =>
      calls.find((call) => call.url.endsWith(suffix) && call.headers["Host"] === host);
    // Proof 1 and proof 5 both hit /api/health, with different hosts.
    expect(find("/api/health", "stg.pinar.dev")?.headers).toEqual({ Host: "stg.pinar.dev" });
    expect(find("/api/health", "evil.example")?.headers).toEqual({ Host: "evil.example" });
    // Proof 2: the app shell under the known host.
    expect(find("/", "stg.pinar.dev")?.headers).toEqual({ Host: "stg.pinar.dev" });
    // Proof 3: pricing with the Brazilian visitor hint.
    expect(find("/api/pricing", "stg.pinar.dev")?.headers).toEqual({
      Host: "stg.pinar.dev",
      "cf-ipcountry": "BR",
    });
    // Proof 4: a POST carrying the forged internal header.
    const cron = find("/_internal/cron/daily", "stg.pinar.dev");
    expect(cron?.method).toBe("POST");
    expect(cron?.headers).toEqual({ Host: "stg.pinar.dev", "x-edger-internal": "true" });
    for (const call of calls) expect(call.url).toContain("127.0.0.1:18082");
  });

  test("a bad response fails only its own proof, with the detail", async () => {
    const fetchImpl: ProofFetch = async (url, init) => {
      if (url.endsWith("/api/pricing")) return jsonResponse(200, { currency: "USD" });
      return goodFetch(url, init);
    };
    const outcome = await runProofs(18083, fetchImpl);
    expect(outcome.allOk).toBe(false);
    expect(outcome.lines.filter((line) => line.startsWith("ok "))).toHaveLength(4);
    const failed = outcome.lines.find((line) => line.startsWith("FAIL "));
    expect(failed).toBe(
      `FAIL GET /api/pricing (cf-ipcountry: BR) → currency BRL: currency is "USD"`,
    );
  });

  test("the health proof retries until the deadline, then fails with the last detail", async () => {
    let healthAttempts = 0;
    const fetchImpl: ProofFetch = async (url, init) => {
      // Only the known-host proof misbehaves; the unknown-host proof (which
      // reuses /api/health) keeps goodFetch's 404.
      if (url.endsWith("/api/health") && init.headers["Host"] === "stg.pinar.dev") {
        healthAttempts += 1;
        return jsonResponse(200, { service: "pinar", hasDb: false });
      }
      return goodFetch(url, init);
    };
    const outcome = await runProofs(18084, fetchImpl, {
      healthDeadlineMs: 250,
      pollMs: 40,
    });
    expect(healthAttempts).toBeGreaterThan(1);
    const health = outcome.lines.find((line) => line.includes("/api/health"));
    expect(health).toBe(
      `FAIL GET /api/health (Host: stg.pinar.dev) → 200, service pinar, hasDb: hasDb is false`,
    );
    // The other proofs still ran and passed.
    expect(outcome.lines.filter((line) => line.startsWith("ok "))).toHaveLength(4);
  });

  test("a connection error on a proof is a FAIL with the error message", async () => {
    const fetchImpl: ProofFetch = async (url, init) => {
      if (init.headers["Host"] === "evil.example") return textResponse(404, "Not found");
      if (url.endsWith("/api/health")) return jsonResponse(200, { service: "pinar", hasDb: true });
      if (url.endsWith("/")) throw new Error("connect ECONNREFUSED 127.0.0.1:18085");
      return goodFetch(url, init);
    };
    const outcome = await runProofs(18085, fetchImpl);
    expect(outcome.allOk).toBe(false);
    expect(outcome.lines.join("\n")).toContain("connect ECONNREFUSED 127.0.0.1:18085");
  });
});

describe.skipIf(isWindows)("shutdown of child groups (POSIX process groups)", () => {
  test("a group whose leader already exited receives TERM then KILL, and its descendant dies", async () => {
    const dir = tempDir("pinar-edger-shutdown-");
    cleanups.push(() => {
      childGroups.length = 0;
    });
    writeFileSync(join(dir, "ignoring.ts"), SIGTERM_IGNORING_SOURCE);
    writeFileSync(join(dir, "leader.ts"), LEADER_SOURCE);
    const readyFile = join(dir, "ready");
    const markerFile = join(dir, "term");
    const leader = spawn(process.execPath, [join(dir, "leader.ts"), join(dir, "ignoring.ts")], {
      detached: true,
      env: { ...process.env, READY_FILE: readyFile, TERM_MARKER: markerFile },
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pidText: string[] = [];
    leader.stdout.on("data", (chunk: Buffer) => pidText.push(chunk.toString()));
    try {
      expect(await waitFor(() => leader.exitCode !== null, 10_000), "the leader fixture exited").toBe(true);
      expect(leader.exitCode).toBe(0);
      const descendant = Number(pidText.join(""));
      expect(descendant, `the leader printed the descendant pid (got ${JSON.stringify(pidText.join(""))})`).toBeGreaterThan(0);
      // The premise of the bug: the leader is dead, but its group — with
      // the live descendant — still exists.
      expect(pidAlive(descendant)).toBe(true);
      expect(groupAlive(leader.pid!)).toBe(true);

      childGroups.push(leader.pid!);
      await stopChildGroups(300);

      // The descendant ignored the group's TERM (the marker) and only the
      // KILL after the (injected, 300 ms) wait could take it down.
      expect(await waitFor(() => !pidAlive(descendant), 3_000), "the descendant died").toBe(true);
      expect(readFileSync(markerFile, "utf8")).toBe("term");
      expect(groupAlive(leader.pid!)).toBe(false);
    } finally {
      killGroupQuiet(leader.pid);
      killQuiet(leader.pid);
    }
  });

  test("a child that ignores SIGTERM dies by SIGKILL after the wait", async () => {
    const dir = tempDir("pinar-edger-shutdown-");
    cleanups.push(() => {
      childGroups.length = 0;
    });
    writeFileSync(join(dir, "ignoring.ts"), SIGTERM_IGNORING_SOURCE);
    const readyFile = join(dir, "ready");
    const markerFile = join(dir, "term");
    const child = spawn(process.execPath, [join(dir, "ignoring.ts")], {
      detached: true,
      env: { ...process.env, READY_FILE: readyFile, TERM_MARKER: markerFile },
      stdio: "ignore",
    });
    try {
      expect(await waitFor(() => existsSync(readyFile), 10_000), "the fixture installed its SIGTERM handler").toBe(true);
      childGroups.push(child.pid!);
      await stopChildGroups(300);
      expect(await waitFor(() => !pidAlive(child.pid!), 3_000), "the child died").toBe(true);
      // TERM reached the child and was ignored: the death is the KILL that
      // ran after the (injected, 300 ms) wait, not the TERM.
      expect(readFileSync(markerFile, "utf8")).toBe("term");
      expect(groupAlive(child.pid!)).toBe(false);
    } finally {
      killQuiet(child.pid);
    }
  });

  test("a PGID that does not exist does not raise an error", async () => {
    cleanups.push(() => {
      childGroups.length = 0;
    });
    // A group whose only member already exited ...
    const gone = spawn("true", [], { detached: true, stdio: "ignore" });
    expect(await waitFor(() => gone.exitCode !== null, 10_000), "the fixture exited").toBe(true);
    childGroups.push(gone.pid!);
    // ... and a PGID that cannot exist on this platform.
    childGroups.push(2_100_000_000);
    await stopChildGroups(100); // must not throw
    // Both numbers were seen gone and are forgotten: a reused PGID is never
    // signalled later.
    expect(childGroups).toEqual([]);
  });

  test("retireGoneGroups forgets only the groups that no longer exist", async () => {
    const alive = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    const gone = spawn("true", [], { detached: true, stdio: "ignore" });
    cleanups.push(() => {
      childGroups.length = 0;
      try {
        process.kill(-alive.pid!, "SIGKILL");
      } catch {
        // already gone
      }
    });
    expect(await waitFor(() => gone.exitCode !== null, 10_000), "the fixture exited").toBe(true);
    childGroups.push(alive.pid!, gone.pid!);
    retireGoneGroups();
    expect(childGroups).toEqual([alive.pid!]);
  });
});
