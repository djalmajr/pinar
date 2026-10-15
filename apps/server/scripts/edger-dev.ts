/**
 * Local Pinar-on-EdgeR repro: build the artifact, start a local `sqld`,
 * apply the migrations, serve the checkout on a real EdgeR with a root key,
 * install the staging worker through the `edger:install` installer (staged +
 * promote) and prove everything through `Host: stg.pinar.dev`. The
 * orchestrator's manual end-to-end test, scripted: it is the standard way to
 * reproduce the deploy locally before staging.
 *
 * Every helper process (sqld, EdgeR and the installer) is a supervised
 * subprocess in its own process group; on any exit — a signal, a failed
 * proof or an early child death — each group that still exists receives
 * SIGTERM, then SIGKILL after the escalation window, before the temp dir is
 * removed. A dead leader never orphans its group's descendants.
 *
 *   bun run edger:dev -- [--no-build] [--once]
 *
 * Required: `EDGER_BIN` (the executable EdgeR binary), `EDGER_SRC` (a
 * directory with `workers/core`) and `sqld` + `deno` on the PATH. Everything
 * else lives in a private (0700) temp dir under `os.tmpdir()`: the database,
 * the root key, the workers/overlay dirs and the logs. Nothing is written to
 * the repository besides the `dist/` build output. The root key and the env
 * file are written at mode 0600 and never printed.
 *
 * Exit codes: 0 success; 1 a guard, proof or runtime failure; 2 invalid
 * usage or a missing environment (`EDGER_BIN`, `EDGER_SRC`, `sqld`, `deno`).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { defaultMigrationsDir, migrateLibsql } from "./migrate-libsql";

const serverDir = fileURLToPath(new URL("..", import.meta.url));
/** The host the staging worker serves (the `WORKERS.staging` hosts). */
const STAGING_HOST = "stg.pinar.dev";
/** A host the EdgeR has no worker for: it must answer 404. */
const UNKNOWN_HOST = "evil.example";
/** The guide printed when `EDGER_BIN`/`EDGER_SRC` cannot be resolved. */
const EDGER_GUIDE = [
  "git -C <edger repo> archive <tag> | tar -x -C <dir>",
  "CARGO_TARGET_DIR=<dir>/target cargo build -p edger-orchestrator --bin edger",
  "EDGER_BIN=<dir>/target/debug/edger EDGER_SRC=<dir>",
].join("\n");
/** Cap on the response body kept for a proof detail. */
const BODY_CAP = 4096;
/** How long the sqld `/health` wait and the EdgeR `/health` wait may run. */
const SQLD_HEALTH_MS = 30_000;
const EDGER_HEALTH_MS = 60_000;
/** The first request after a promote may hit the bundle cache mid-build. */
const HEALTH_PROOF_MS = 60_000;
const HEALTH_PROOF_POLL_MS = 2_000;
/** SIGTERM escalation window before SIGKILL on shutdown. */
const SHUTDOWN_MS = 10_000;

export interface DevOptions {
  build: boolean;
  once: boolean;
}

class UsageError extends Error {}

/** `--no-build` and `--once` are the only accepted arguments. */
export function parseDevArgs(argv: readonly string[]): DevOptions {
  const options: DevOptions = { build: true, once: false };
  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg === "--no-build") {
      options.build = false;
      continue;
    }
    if (arg === "--once") {
      options.once = true;
      continue;
    }
    throw new UsageError(`unknown argument: ${arg} (expected --no-build or --once)`);
  }
  return options;
}

/**
 * `null` when both `EDGER_BIN` and `EDGER_SRC` resolve; otherwise the
 * message that teaches how to obtain them without touching the EdgeR
 * repository.
 */
export function edgerEnvError(env: Readonly<Record<string, string | undefined>>): string | null {
  const bin = env["EDGER_BIN"]?.trim();
  if (bin === undefined || bin === "" || !isExecutableFile(bin)) {
    return `EDGER_BIN must be the executable EdgeR binary. Build it outside the EdgeR repository:\n${EDGER_GUIDE}`;
  }
  const src = env["EDGER_SRC"]?.trim();
  if (src === undefined || src === "" || !hasWorkersCore(src)) {
    return `EDGER_SRC must be a directory containing workers/core. Extract it outside the EdgeR repository:\n${EDGER_GUIDE}`;
  }
  return null;
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function hasWorkersCore(dir: string): boolean {
  try {
    return statSync(join(dir, "workers", "core")).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The staging env file: the real local `DATABASE_URL`, the installer's
 * required identity (`DEPLOYMENT_ENV=staging`), and fictional values (all
 * containing `local`) for the required staging secrets. All keys are known
 * to the manifest and none shadows a wrangler var.
 */
export function buildStagingEnvFile(databaseUrl: string): string {
  return [
    "# pinar edger-dev: fictional local values for the staging worker",
    `DATABASE_URL=${databaseUrl}`,
    "DEPLOYMENT_ENV=staging",
    "AUTH_PEPPER=auth_pepper_local_not_configured",
    "EXTENSION_ORIGIN=chrome-extension://bobfbkbogoiemdcjchoakflgepmekdeh",
    "STRIPE_SECRET_KEY=sk_test_local_not_configured",
    "STRIPE_WEBHOOK_SECRET=whsec_local_not_configured",
    "",
  ].join("\n");
}

/**
 * Replace `path` with `contents` created at mode 0600. `writeFile` does not
 * change the mode of a file that already exists, so unlink first and create
 * with `wx` so the new inode is born private; then verify the mode.
 */
export function writePrivateFile(path: string, contents: string): void {
  rmSync(path, { force: true });
  writeFileSync(path, contents, { mode: 0o600, flag: "wx" });
  const mode = statSync(path).mode & 0o777;
  if (mode !== 0o600) throw new Error(`${path} mode is ${mode.toString(8)}, expected 600`);
}

/** Open a socket on port 0, read the port the OS assigned and close it. */
function takeFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => reject(error));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error("could not allocate a local port"));
      }
    });
  });
}

export interface ProofResponse {
  status: number;
  contentType: string | null;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface ProofInit {
  method: "GET" | "POST";
  headers: Record<string, string>;
}

/** A minimal fetch the proofs run against; injected so tests can fake it. */
export type ProofFetch = (url: string, init: ProofInit) => Promise<ProofResponse>;

export interface ProofOptions {
  /** How long the health proof retries (the first request may be cached). */
  healthDeadlineMs?: number;
  /** The pause between health proof attempts. */
  pollMs?: number;
}

export interface ProofOutcome {
  allOk: boolean;
  lines: string[];
}

/**
 * The five proofs, all through `Host: stg.pinar.dev` (except the last, which
 * uses a host the EdgeR does not know). Each one returns an `ok <desc>` or
 * `FAIL <desc>: <detail>` line; `allOk` is true only when every one passed.
 * The health proof retries until `healthDeadlineMs`.
 */
export async function runProofs(
  port: number,
  fetchImpl: ProofFetch,
  options: ProofOptions = {},
): Promise<ProofOutcome> {
  const healthDeadlineMs = options.healthDeadlineMs ?? HEALTH_PROOF_MS;
  const pollMs = options.pollMs ?? HEALTH_PROOF_POLL_MS;
  const lines: string[] = [];
  const get = (path: string, host: string, extra: Record<string, string> = {}) =>
    fetchImpl(`http://127.0.0.1:${port}${path}`, {
      headers: { Host: host, ...extra },
      method: "GET",
    });
  // 1. /api/health: 200, service "pinar" and hasDb true. Retry: the first
  // request right after the promote may hit the bundle cache mid-build.
  const healthDesc = `GET /api/health (Host: ${STAGING_HOST}) → 200, service pinar, hasDb`;
  const deadline = Date.now() + healthDeadlineMs;
  let healthDetail: string | null = "no response";
  for (;;) {
    healthDetail = await healthCheck(() => get("/api/health", STAGING_HOST));
    if (healthDetail === null || Date.now() >= deadline) break;
    await sleep(pollMs);
  }
  if (healthDetail === null) lines.push(`ok ${healthDesc}`);
  else lines.push(`FAIL ${healthDesc}: ${healthDetail}`);

  // 2. / renders the app shell.
  const homeDesc = `GET / (Host: ${STAGING_HOST}) → 200 text/html`;
  const homeDetail = await (async () => {
    let response: ProofResponse;
    try {
      response = await get("/", STAGING_HOST);
    } catch (error) {
      return error instanceof Error ? error.message : "request failed";
    }
    if (response.status !== 200) return `status ${response.status}`;
    const type = response.contentType ?? "";
    if (!type.includes("text/html")) return `content-type is ${JSON.stringify(type || "(none)")}`;
    return null;
  })();
  if (homeDetail === null) lines.push(`ok ${homeDesc}`);
  else lines.push(`FAIL ${homeDesc}: ${homeDetail}`);

  // 3. /api/pricing reports BRL for a Brazilian visitor.
  const pricingDesc = `GET /api/pricing (cf-ipcountry: BR) → currency BRL`;
  const pricingDetail = await (async () => {
    let response: ProofResponse;
    try {
      response = await get("/api/pricing", STAGING_HOST, { "cf-ipcountry": "BR" });
    } catch (error) {
      return error instanceof Error ? error.message : "request failed";
    }
    if (response.status !== 200) return `status ${response.status}`;
    let body: { currency?: unknown };
    try {
      body = (await response.json()) as { currency?: unknown };
    } catch {
      return "body is not JSON";
    }
    if (body.currency !== "BRL") return `currency is ${JSON.stringify(body.currency)}`;
    return null;
  })();
  if (pricingDetail === null) lines.push(`ok ${pricingDesc}`);
  else lines.push(`FAIL ${pricingDesc}: ${pricingDetail}`);

  // 4. A forged internal header does not reach the worker: the EdgeR strips
  // it, so the entry answers its plain 404 instead of running the jobs.
  const cronDesc = `POST /_internal/cron/daily with forged x-edger-internal → 404 "Not found"`;
  const cronDetail = await (async () => {
    let response: ProofResponse;
    try {
      response = await fetchImpl(`http://127.0.0.1:${port}/_internal/cron/daily`, {
        headers: { Host: STAGING_HOST, "x-edger-internal": "true" },
        method: "POST",
      });
    } catch (error) {
      return error instanceof Error ? error.message : "request failed";
    }
    if (response.status !== 404) return `status ${response.status}`;
    const body = await response.text();
    if (body !== "Not found") return `body is ${JSON.stringify(body.slice(0, 80))}`;
    return null;
  })();
  if (cronDetail === null) lines.push(`ok ${cronDesc}`);
  else lines.push(`FAIL ${cronDesc}: ${cronDetail}`);

  // 5. An unknown host has no worker: an app route that answers 200 under
  // stg.pinar.dev answers the EdgeR's 404 here. The proof uses /api/health
  // (not /), because on an ownerless Host the EdgeR's own `/` is the cPanel
  // front door and 307-redirects to `cpanel/` — that is the runtime, not the
  // Pinar worker, so it cannot prove host isolation.
  const unknownHostDesc = `GET /api/health (Host: ${UNKNOWN_HOST}) → 404`;
  const unknownHostDetail = await (async () => {
    let response: ProofResponse;
    try {
      response = await get("/api/health", UNKNOWN_HOST);
    } catch (error) {
      return error instanceof Error ? error.message : "request failed";
    }
    if (response.status !== 404) return `status ${response.status}`;
    return null;
  })();
  if (unknownHostDetail === null) lines.push(`ok ${unknownHostDesc}`);
  else lines.push(`FAIL ${unknownHostDesc}: ${unknownHostDetail}`);

  return { allOk: lines.every((line) => line.startsWith("ok ")), lines };
}

/** `null` when the health proof passes; otherwise the failing detail. */
async function healthCheck(attempt: () => Promise<ProofResponse>): Promise<string | null> {
  let response: ProofResponse;
  try {
    response = await attempt();
  } catch (error) {
    return error instanceof Error ? error.message : "request failed";
  }
  if (response.status !== 200) return `status ${response.status}`;
  let body: { hasDb?: unknown; service?: unknown };
  try {
    body = (await response.json()) as { hasDb?: unknown; service?: unknown };
  } catch {
    return "body is not JSON";
  }
  if (body.service !== "pinar") return `service is ${JSON.stringify(body.service)}`;
  if (body.hasDb !== true) return `hasDb is ${JSON.stringify(body.hasDb)}`;
  return null;
}

/** The real `ProofFetch`: `127.0.0.1` only, body capped, no credentials. */
function httpProofFetch(url: string, init: ProofInit): Promise<ProofResponse> {
  const target = new URL(url);
  if (target.hostname !== "127.0.0.1") {
    return Promise.reject(new Error("edger-dev proofs only reach 127.0.0.1"));
  }
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        headers: init.headers,
        hostname: target.hostname,
        method: init.method,
        path: `${target.pathname}${target.search}`,
        port: target.port === "" ? undefined : Number(target.port),
        timeout: 30_000,
      },
      (response: IncomingMessage) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          if (size >= BODY_CAP) return;
          const part = chunk.subarray(0, BODY_CAP - size);
          chunks.push(part);
          size += part.length;
        });
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            contentType: response.headers["content-type"] ?? null,
            json: async () => JSON.parse(body),
            status: response.statusCode ?? 0,
            text: async () => body,
          });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveOnPath(name: string): string | null {
  const pathEnv = process.env.PATH;
  if (!pathEnv) return null;
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

// --- runtime state ---------------------------------------------------------

/**
 * The PGIDs of the process groups this run created. Each child is spawned
 * `detached` (a new group leader), so its PGID is its own PID. Shutdown
 * signals the groups themselves — never the leader's state — because a
 * group outlives its leader: the descendants (the deno processes EdgeR
 * spawns) stay in it. Test seam: the shutdown tests register real fixture
 * groups here.
 */
export const childGroups: number[] = [];
let shuttingDown = false;
let tmpRoot = "";
let devOptions: DevOptions = { build: true, once: false };

function childExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/**
 * `true` when the group `pgid` still exists: `kill(0)` on the group
 * succeeds while any member is alive and throws `ESRCH` when the group is
 * gone (even if the leader already exited).
 */
export function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    // The group vanished between the check and the signal: forget the
    // number now, like retireGoneGroups would, so it is never signalled
    // again.
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      const index = childGroups.indexOf(pgid);
      if (index !== -1) childGroups.splice(index, 1);
    }
  }
}

/**
 * Stop every group this run created: SIGTERM each group that still exists
 * (independent of whether its leader is alive), wait up to `graceMs`, then
 * SIGKILL whatever remains. `graceMs` is injectable so the tests do not
 * wait the production 10 s window.
 */
export async function stopChildGroups(graceMs: number = SHUTDOWN_MS): Promise<void> {
  retireGoneGroups();
  for (const pgid of [...childGroups]) signalGroup(pgid, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    retireGoneGroups();
    if (childGroups.length === 0) return;
    await sleep(100);
  }
  retireGoneGroups();
  for (const pgid of [...childGroups]) signalGroup(pgid, "SIGKILL");
}

/**
 * Forget every group that no longer exists. A number seen gone is never
 * signalled again: the OS may hand it to an unrelated group later.
 */
export function retireGoneGroups(): void {
  for (let index = childGroups.length - 1; index >= 0; index -= 1) {
    if (!groupAlive(childGroups[index])) childGroups.splice(index, 1);
  }
}

function lastLogLines(path: string, count: number): string {
  try {
    const lines = readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line !== "");
    return lines.slice(-count).join("\n") || "(empty log)";
  } catch {
    return "(no log)";
  }
}

async function shutdown(code: number, graceMs: number = SHUTDOWN_MS): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await stopChildGroups(graceMs);
  if (tmpRoot !== "") {
    try {
      rmSync(tmpRoot, { force: true, recursive: true });
    } catch {
      // best effort on the way out
    }
  }
  process.exit(code);
}

function registerSignals(): void {
  const handle = (signal: NodeJS.Signals) => {
    const signalCode = signal === "SIGTERM" ? 143 : signal === "SIGHUP" ? 129 : 130;
    // Every signal, in --once and in persistent mode, and including one that
    // lands while the installer runs, goes through the same escalation:
    // TERM the groups, wait, KILL the rest, remove the temp dir, exit with
    // the signal's conventional code (129/130/143).
    void shutdown(signalCode);
  };
  process.on("SIGINT", () => handle("SIGINT"));
  process.on("SIGTERM", () => handle("SIGTERM"));
  // A closed terminal must not leave sqld and EdgeR running.
  process.on("SIGHUP", () => handle("SIGHUP"));
}

interface StartProcessOptions {
  /**
   * The child's exit is the normal end of a step, not an early failure:
   * the caller awaits the exit code and decides. The early-exit handler is
   * skipped for such children.
   */
  expectExit?: boolean;
}

function startProcess(
  label: string,
  bin: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  logPath: string | null,
  options: StartProcessOptions = {},
): ChildProcess {
  // `null` routes the output to this process' stdout/stderr (the installer
  // redacts its own secrets); a path keeps a log inside the temp dir.
  const out = logPath === null ? "inherit" : openSync(logPath, "a");
  const child = spawn(bin, args, {
    cwd,
    detached: true,
    env,
    stdio: ["ignore", out, out],
  });
  if (child.pid !== undefined) {
    // The child is a group leader (detached): the group covers everything
    // it spawns, and the group is what shutdown tracks.
    childGroups.push(child.pid);
    console.log(`edger-dev: ${label} pid ${child.pid}`);
  }
  child.once("error", (error) => {
    console.error(`edger-dev: ${label} failed to start: ${error.message}`);
    void shutdown(1);
  });
  if (!options.expectExit) {
    child.once("exit", (code, signal) => {
      if (shuttingDown) return;
      const how = signal ?? code ?? "unknown";
      console.error(`edger-dev: ${label} exited early (${how}); last 20 lines of ${logPath}:`);
      console.error(lastLogLines(logPath ?? "", 20));
      void shutdown(1);
    });
  }
  child.once("exit", () => {
    if (typeof out === "string") return; // inherited stdio: nothing to close
    try {
      closeSync(out);
    } catch {
      // already closed
    }
  });
  return child;
}

/** The exit code of a child whose exit is a step, not a crash: non-zero on a signal. */
function waitForExitCode(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve(signal !== null ? 1 : code ?? 1));
  });
}

async function waitHttp(
  label: string,
  child: ChildProcess,
  port: number,
  path: string,
  deadlineMs: number,
): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  let last = "no response";
  while (Date.now() < deadline) {
    if (child.pid !== undefined && childExited(child)) {
      throw new Error(`${label} exited before it was ready`);
    }
    try {
      const response = await httpProofFetch(`http://127.0.0.1:${port}${path}`, {
        headers: {},
        method: "GET",
      });
      if (response.status === 200) return;
      last = `status ${response.status}`;
      await sleep(response.status === 500 || response.status === 503 ? 2_000 : 400);
    } catch (error) {
      last = error instanceof Error ? error.message : "request failed";
      await sleep(400);
    }
    if (Date.now() >= deadline) break;
  }
  throw new Error(`${label} was not ready within ${deadlineMs}ms (${last})`);
}

async function main(): Promise<void> {
  devOptions = parseDevArgs(process.argv.slice(2));
  const envError = edgerEnvError(process.env);
  if (envError !== null) {
    console.error(envError);
    process.exit(2);
  }
  const edgerBin = process.env.EDGER_BIN?.trim() ?? "";
  const edgerSrc = process.env.EDGER_SRC?.trim() ?? "";
  const sqldBin = resolveOnPath("sqld");
  if (sqldBin === null) {
    console.error("sqld is not on PATH");
    process.exit(2);
  }
  if (resolveOnPath("deno") === null) {
    console.error("deno is not on PATH");
    process.exit(2);
  }
  registerSignals();

  // --- private temp dir ----------------------------------------------------
  // mkdtempSync applies the umask, so chmod immediately after: the same
  // pattern as the installer's createInstallPackage.
  tmpRoot = mkdtempSync(join(tmpdir(), "pinar-edger-dev-"));
  chmodSync(tmpRoot, 0o700);
  if ((statSync(tmpRoot).mode & 0o777) !== 0o700) {
    throw new Error(`temp dir ${tmpRoot} is not mode 0700`);
  }

  // --- the artifact --------------------------------------------------------
  if (devOptions.build) {
    console.log("edger-dev: bun run build:edger");
    const built = spawnSync(process.execPath, ["run", "--no-env-file", "build:edger"], {
      cwd: serverDir,
      env: process.env,
      stdio: "inherit",
    });
    if (built.error) throw new Error(`bun run build:edger failed: ${built.error.message}`);
    if (built.status !== 0) throw new Error(`bun run build:edger failed (exit ${built.status})`);
  }
  const distDir = join(serverDir, "dist", "edger");
  for (const required of [
    join(distDir, "manifest.yaml"),
    join(distDir, "server", "server.js"),
    join(distDir, "client"),
  ]) {
    if (!existsSync(required)) {
      throw new Error(`dist/edger is incomplete (missing ${required}); run without --no-build`);
    }
  }

  // --- root key and env file (0600, never printed) --------------------------
  const rootKeyPath = join(tmpRoot, "root-key");
  writePrivateFile(rootKeyPath, randomBytes(24).toString("hex"));
  const envFile = join(tmpRoot, "stg.env");
  const sqldPort = await takeFreePort();
  const edgerPort = await takeFreePort();
  const sqldUrl = `http://127.0.0.1:${sqldPort}`;
  writePrivateFile(envFile, buildStagingEnvFile(sqldUrl));

  // --- sqld + migrations -----------------------------------------------------
  const sqldChild = startProcess(
    "sqld",
    sqldBin,
    [
      "--db-path",
      join(tmpRoot, "db.sqld"),
      "--http-listen-addr",
      `127.0.0.1:${sqldPort}`,
      "--no-welcome",
    ],
    tmpRoot,
    process.env,
    join(tmpRoot, "sqld.log"),
  );
  await waitHttp("sqld /health", sqldChild, sqldPort, "/health", SQLD_HEALTH_MS);
  console.log(`edger-dev: sqld /health 200 on 127.0.0.1:${sqldPort}`);

  const client = createClient({ url: sqldUrl });
  try {
    const result = await migrateLibsql(client, defaultMigrationsDir(), {
      log: (line) => console.log(`edger-dev: migrate: ${line}`),
    });
    console.log(
      `edger-dev: migrations ${result.applied.length} applied, ${result.alreadyApplied.length} already applied`,
    );
  } finally {
    await client.close();
  }

  // --- EdgeR -----------------------------------------------------------------
  mkdirSync(join(tmpRoot, "workers"), { recursive: true });
  mkdirSync(join(tmpRoot, "overlay"), { recursive: true });
  const edgerChild = startProcess(
    "EdgeR",
    edgerBin,
    [],
    edgerSrc,
    {
      ...process.env,
      EDGER_API_KEYS_DB: join(tmpRoot, "keys.db"),
      EDGER_BIND: "127.0.0.1",
      EDGER_CORE_WORKER_DIR: join(edgerSrc, "workers", "core"),
      EDGER_CORE_WORKER_OVERLAY_DIR: join(tmpRoot, "overlay"),
      EDGER_CRON_ENABLED: "true",
      EDGER_ROOT_KEY_FILE: rootKeyPath,
      PORT: String(edgerPort),
      RUNTIME_WORKER_DIRS: join(tmpRoot, "workers"),
    },
    join(tmpRoot, "edger.log"),
  );
  await waitHttp("EdgeR /health", edgerChild, edgerPort, "/health", EDGER_HEALTH_MS);
  console.log(`edger-dev: EdgeR /health 200 on 127.0.0.1:${edgerPort}`);

  // --- install (staged + promote) through the installer as a subprocess ---
  // A supervised subprocess, like sqld and EdgeR: a signal reaches its
  // group like any other child, and the TERM→wait→KILL escalation applies
  // to it. Its output goes straight to stdout/stderr — the installer
  // redacts its own secrets.
  const version = `0.0.0-dev.${Math.floor(Date.now() / 1000)}`;
  const installChild = startProcess(
    "install",
    process.execPath,
    [
      "scripts/edger-install.ts",
      "--api-key-file",
      rootKeyPath,
      "--env",
      "staging",
      "--env-file",
      envFile,
      "--no-build",
      "--url",
      `http://127.0.0.1:${edgerPort}`,
      "--version",
      version,
    ],
    serverDir,
    process.env,
    null,
    { expectExit: true },
  );
  const installCode = await waitForExitCode(installChild);
  // The installer's group is usually gone now: forget it at once.
  retireGoneGroups();
  if (installCode !== 0) throw new Error(`edger:install exited ${installCode}`);

  // --- proofs -----------------------------------------------------------------
  const outcome = await runProofs(edgerPort, httpProofFetch);
  for (const line of outcome.lines) console.log(line);
  if (!outcome.allOk) throw new Error("a proof failed");

  if (devOptions.once) {
    await shutdown(0);
    return;
  }
  console.log(
    `pinar-stg on http://127.0.0.1:${edgerPort} (send Host: ${STAGING_HOST}); Ctrl-C stops sqld and EdgeR`,
  );
  await new Promise<void>(() => {
    // Foreground until SIGINT/SIGTERM; the detached children do not keep
    // this process alive by themselves.
  });
}

function isDirectRun(): boolean {
  const meta = import.meta as ImportMeta & { main?: boolean };
  if (meta.main === true) return true;
  const invoked = process.argv[1];
  if (!invoked) return false;
  return fileURLToPath(import.meta.url) === invoked;
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "edger-dev failed");
    void shutdown(1);
  });
}
