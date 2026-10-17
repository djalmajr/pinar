/**
 * Unit tests for `edger-dev-platform.ts`: the pure helpers (ANSI, manifest
 * cron patch, `cron dispatched` parser, window evaluator, partial-line
 * handling) and the seven platform proofs driven by a fake fetch and a
 * fake log file (real offsets, a fake clock). Nothing reaches the network.
 * The parser fixtures are built in the documented `tracing_subscriber::fmt`
 * format; the rc.18 pipeline debug line (the discarded `cron-probe`
 * capture) appears only as a synthetic negative case.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProofFetch, ProofResponse } from "./edger-dev";
import {
  CRON_SETTLE_MS,
  CRON_WINDOW_MS,
  dropPartialHead,
  evaluateCronWindow,
  patchCronSchedule,
  parseCronDispatches,
  runPlatformProofs,
  stripAnsi,
  type CronDispatch,
  type CronWindowSpec,
  type PlatformProofDeps,
} from "./edger-dev-platform";

// Module-local shim: the tests run on Bun, where the global exists; the
// project tsconfig does not load Bun types for `scripts`.
declare const Bun: {
  YAML: { parse: (text: string) => unknown };
};

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REAL_MANIFEST = readFileSync(join(SERVER_DIR, "edger", "manifest.yaml"), "utf8");

const V1 = "0.0.0-dev.1760497200";
const V2 = "0.0.0-dev.1760497200.2";
const V3 = "0.0.0-dev.999";
const UUID = "1b2c3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e";
const BASE = "2026-10-15T03:00:00.123456Z  INFO edger_orchestrator::cron: cron dispatched";

/** A `cron dispatched` line with the documented field order. */
function cronLine(
  worker = "pinar-stg",
  version = V1,
  status = 200,
  path = "/_internal/cron/daily",
  requestId = `cron-${UUID}`,
): string {
  return `${BASE} worker=${worker} version=${version} path=${path} method=POST request_id=${requestId} status=${status}`;
}

function jsonResponse(status: number, body: unknown): ProofResponse {
  return {
    contentType: "application/json",
    json: async () => body,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe("stripAnsi", () => {
  test("leaves plain text untouched", () => {
    expect(stripAnsi(`${BASE} worker=pinar-stg`)).toBe(`${BASE} worker=pinar-stg`);
  });

  test("removes SGR sequences", () => {
    expect(stripAnsi("\x1b[2m2026\x1b[0m  \x1b[32mINFO\x1b[0m cron dispatched")).toBe(
      "2026  INFO cron dispatched",
    );
  });

  test("removes CSI and cursor sequences generally", () => {
    expect(stripAnsi("\x1b[1;35mworker=pinar-stg\x1b[0m \x1b[?25h")).toBe("worker=pinar-stg ");
  });
});

describe("dropPartialHead", () => {
  test("a read at a line boundary is untouched", () => {
    const bytes = Buffer.from("a\nb\n");
    expect(Buffer.from(dropPartialHead(bytes, true)).equals(bytes)).toBe(true);
    expect(dropPartialHead(new Uint8Array(0), true).length).toBe(0);
  });

  test("a read mid-line drops the tail of the line before it", () => {
    const dropped = dropPartialHead(
      Buffer.from("tail of the previous line\nfirst\nsecond"),
      false,
    );
    expect(Buffer.from(dropped).toString("utf8")).toBe("first\nsecond");
  });

  test("a mid-line read with no newline is kept (a straddling line)", () => {
    const bytes = Buffer.from("still being written");
    expect(Buffer.from(dropPartialHead(bytes, false)).equals(bytes)).toBe(true);
  });

  test("a multibyte tail is dropped by bytes, not by decoded units", () => {
    // The read starts inside `conexão` (a multibyte character in the head
    // fragment); the drop must land on the first 0x0a in the bytes.
    const full = Buffer.from("erro: conexão inválida\nfirst line\n");
    const cut = Buffer.byteLength("erro: cone");
    expect(Buffer.from(dropPartialHead(full.subarray(cut), false)).toString("utf8")).toBe(
      "first line\n",
    );
  });
});

describe("patchCronSchedule", () => {
  test("rewrites the daily job's schedule and keeps the others", () => {
    const text = patchCronSchedule(REAL_MANIFEST, "@every 2s");
    const manifest = Bun.YAML.parse(text) as {
      cron: Array<{ method?: string; path: string; schedule: string }>;
      env: Record<string, string>;
      name: string;
      version: string;
    };
    expect(manifest.cron).toEqual([
      { schedule: "@every 2s", path: "/_internal/cron/daily", method: "POST" },
      { schedule: "*/5 * * * *", path: "/_internal/cron/frequent", method: "POST" },
    ]);
    expect(manifest.name).toBe("pinar");
    expect(manifest.version).toBe("0.0.0");
    // The env keys survive the round trip.
    expect(manifest.env.DATABASE_URL).toBe("");
    expect(Object.keys(manifest.env).length).toBeGreaterThanOrEqual(30);
  });

  test("touches only the daily job, wherever it is in the list", () => {
    const text = `name: pinar
version: "0.0.0"
cron:
  - schedule: "*/5 * * * *"
    path: /_internal/cron/frequent
    method: POST
  - schedule: "0 3 * * *"
    path: /_internal/cron/daily
    method: POST
`;
    const manifest = Bun.YAML.parse(patchCronSchedule(text, "@every 2s")) as { cron: unknown[] };
    expect(manifest.cron).toEqual([
      { schedule: "*/5 * * * *", path: "/_internal/cron/frequent", method: "POST" },
      { schedule: "@every 2s", path: "/_internal/cron/daily", method: "POST" },
    ]);
  });

  test("rejects a manifest with zero cron jobs", () => {
    expect(() =>
      patchCronSchedule("name: pinar\nversion: \"0.0.0\"\nenv:\n  A: \"\"\n", "@every 2s"),
    ).toThrow("manifest has 0 cron job(s) with path /_internal/cron/daily; the platform proofs require exactly one");
  });

  test("rejects a manifest without the daily job", () => {
    const text = `name: pinar
version: "0.0.0"
cron:
  - schedule: "*/5 * * * *"
    path: /_internal/cron/frequent
  - schedule: "0 3 * * *"
    path: /_internal/cron/other
`;
    expect(() => patchCronSchedule(text, "@every 2s")).toThrow(
      "manifest has 0 cron job(s) with path /_internal/cron/daily; the platform proofs require exactly one",
    );
  });

  test("rejects a manifest with two daily jobs", () => {
    const text = `name: pinar
version: "0.0.0"
cron:
  - schedule: "0 3 * * *"
    path: /_internal/cron/daily
  - schedule: "0 4 * * *"
    path: /_internal/cron/daily
`;
    expect(() => patchCronSchedule(text, "@every 2s")).toThrow(
      "manifest has 2 cron job(s) with path /_internal/cron/daily; the platform proofs require exactly one",
    );
  });
});

describe("parseCronDispatches", () => {
  test("counts a complete documented line", () => {
    expect(parseCronDispatches(`${cronLine()}\n`, "pinar-stg")).toEqual([
      { status: 200, version: V1 },
    ]);
  });

  test("accepts the fields in another order", () => {
    const line = `2026-10-15T03:00:00.123456Z  INFO edger_orchestrator::cron: cron dispatched status=200 path=/_internal/cron/daily request_id=cron-${UUID} method=POST version=${V1} worker=pinar-stg`;
    expect(parseCronDispatches(`${line}\n`, "pinar-stg")).toEqual([{ status: 200, version: V1 }]);
  });

  test("accepts quoted values", () => {
    const line = `${BASE} worker="pinar-stg" version="${V1}" path="/_internal/cron/daily" method=POST request_id="cron-${UUID}" status=200`;
    expect(parseCronDispatches(`${line}\n`, "pinar-stg")).toEqual([{ status: 200, version: V1 }]);
  });

  test("accepts an ANSI-colored line", () => {
    const line = `\x1b[2m${BASE}\x1b[0m \x1b[36mworker=pinar-stg version=${V1} path=/_internal/cron/daily method=POST request_id=cron-${UUID} status=200\x1b[0m`;
    expect(parseCronDispatches(`${line}\n`, "pinar-stg")).toEqual([{ status: 200, version: V1 }]);
  });

  test("accepts the versioned path form", () => {
    const line = cronLine("pinar-stg", V1, 200, `/pinar-stg/_internal/cron/daily`);
    expect(parseCronDispatches(`${line}\n`, "pinar-stg")).toEqual([{ status: 200, version: V1 }]);
  });

  test("ignores another worker", () => {
    expect(parseCronDispatches(`${cronLine("pinar")}\n`, "pinar-stg")).toEqual([]);
    // And the other way around.
    expect(parseCronDispatches(`${cronLine("pinar-stg")}\n`, "pinar")).toEqual([]);
  });

  test("ignores another path", () => {
    expect(
      parseCronDispatches(`${cronLine("pinar-stg", V1, 200, "/_internal/cron/other")}\n`, "pinar-stg"),
    ).toEqual([]);
    expect(
      parseCronDispatches(`${cronLine("pinar-stg", V1, 200, "/_internal/cron/daily/extra")}\n`, "pinar-stg"),
    ).toEqual([]);
  });

  test("ignores a request id without the cron- prefix", () => {
    expect(
      parseCronDispatches(`${cronLine("pinar-stg", V1, 200, "/_internal/cron/daily", `req-${UUID}`)}\n`, "pinar-stg"),
    ).toEqual([]);
    expect(
      parseCronDispatches(`${cronLine("pinar-stg", V1, 200, "/_internal/cron/daily", "cronx")}\n`, "pinar-stg"),
    ).toEqual([]);
  });

  test("keeps non-2xx dispatches with their status", () => {
    expect(parseCronDispatches(`${cronLine("pinar-stg", V1, 404)}\n`, "pinar-stg")).toEqual([
      { status: 404, version: V1 },
    ]);
    expect(parseCronDispatches(`${cronLine("pinar-stg", V1, 500)}\n`, "pinar-stg")).toEqual([
      { status: 500, version: V1 },
    ]);
  });

  test("ignores the rc.18 pipeline debug line even with a cron- request id", () => {
    const line = `2026-10-15T02:59:59.000000Z DEBUG edger_orchestrator::pipeline{request_id=cron-probe, path=/pinar-stg@${V1}/_internal/cron/daily, method=POST}: http request pipeline`;
    expect(parseCronDispatches(`${line}\n`, "pinar-stg")).toEqual([]);
  });

  test("ignores a line missing the version or the status", () => {
    const noVersion = `${BASE} worker=pinar-stg path=/_internal/cron/daily method=POST request_id=cron-${UUID} status=200`;
    const noStatus = `${BASE} worker=pinar-stg version=${V1} path=/_internal/cron/daily method=POST request_id=cron-${UUID}`;
    expect(parseCronDispatches(`${noVersion}\n${noStatus}\n`, "pinar-stg")).toEqual([]);
  });

  test("keeps the log order and ignores extra fields", () => {
    const text = [
      cronLine("pinar-stg", V1, 200),
      `2026-10-15T03:00:02.000000Z  INFO edger_orchestrator::pool: worker spawned name=pinar-stg`,
      cronLine("pinar-stg", V2, 200, "/_internal/cron/daily", `cron-${UUID}`),
      cronLine("pinar", V1, 500),
    ].join("\n") + "\n";
    expect(parseCronDispatches(text, "pinar-stg")).toEqual([
      { status: 200, version: V1 },
      { status: 200, version: V2 },
    ]);
  });

  // F1: only complete lines count.

  test("a partial last line never counts, not even a partial status", () => {
    const complete = cronLine("pinar-stg", V1, 200);
    const cut = complete.slice(0, complete.lastIndexOf("status=200") + "status=20".length);
    expect(cut.endsWith("status=20")).toBe(true);
    expect(parseCronDispatches(cut, "pinar-stg")).toEqual([]);
  });

  test("the same line completed with its 200 and a newline counts with status 200", () => {
    const complete = cronLine("pinar-stg", V1, 200);
    const cut = complete.slice(0, complete.lastIndexOf("status=200") + "status=20".length);
    expect(parseCronDispatches(`${cut}0\n`, "pinar-stg")).toEqual([
      { status: 200, version: V1 },
    ]);
  });

  test("a single unterminated line counts for nothing", () => {
    expect(parseCronDispatches(cronLine(), "pinar-stg")).toEqual([]);
  });

  test("a completed line right at the end of the text counts", () => {
    expect(parseCronDispatches(`${cronLine()}\n`, "pinar-stg")).toHaveLength(1);
  });
});

describe("evaluateCronWindow", () => {
  const spec: CronWindowSpec = {
    desc: "window",
    expected: V1,
    forbidden: V2,
    min: 3,
    max: 6,
    worker: "pinar-stg",
    window: "the 10 s window",
  };
  const dispatches = (versions: string[], status = 200): CronDispatch[] =>
    versions.map((version) => ({ status, version }));

  test("an empty window fails saying there was no cron dispatched line", () => {
    expect(evaluateCronWindow([], spec)).toBe(
      'FAIL window: no "cron dispatched" line for pinar-stg in the 10 s window',
    );
  });

  test("only the expected version within the limits passes", () => {
    expect(evaluateCronWindow(dispatches([V1, V1, V1]), spec)).toBe("ok window");
    expect(evaluateCronWindow(dispatches([V1, V1, V1, V1, V1]), spec)).toBe("ok window");
    expect(evaluateCronWindow(dispatches([V1, V1, V1, V1, V1, V1]), spec)).toBe("ok window");
  });

  test("only the expected version below the minimum fails with the count", () => {
    expect(evaluateCronWindow(dispatches([V1, V1]), spec)).toBe(
      `FAIL window: only 2 dispatch(es) to ${V1}, need at least 3 in the 10 s window`,
    );
  });

  test("only the expected version above the maximum fails as duplication", () => {
    expect(evaluateCronWindow(dispatches(Array.from({ length: 10 }, () => V1)), spec)).toBe(
      `FAIL window: 10 dispatches to ${V1} in the 10 s window (max 6); possible duplication`,
    );
  });

  test("a mix with the forbidden version fails naming it", () => {
    expect(evaluateCronWindow(dispatches([V1, V1, V1, V2]), spec)).toBe(
      `FAIL window: dispatch to forbidden ${V2} instead of ${V1}`,
    );
  });

  test("a mix with another version fails naming the version", () => {
    expect(evaluateCronWindow(dispatches([V1, V1, V1, V3]), { ...spec, forbidden: null })).toBe(
      `FAIL window: dispatch to version ${V3} instead of ${V1}`,
    );
  });

  test("any non-2xx dispatch fails with its version and status", () => {
    expect(evaluateCronWindow([{ status: 404, version: V1 }], spec)).toBe(
      `FAIL window: dispatch ${V1} returned 404`,
    );
    expect(evaluateCronWindow(dispatches([V1, V1, V1], 500), spec)).toBe(
      `FAIL window: dispatch ${V1} returned 500`,
    );
    // A non-2xx on the forbidden version also fails by status.
    expect(evaluateCronWindow([{ status: 404, version: V2 }], spec)).toBe(
      `FAIL window: dispatch ${V2} returned 404`,
    );
  });

  test("a null maximum has no cap", () => {
    const presence: CronWindowSpec = { ...spec, forbidden: null, max: null, min: 1, window: "15 s" };
    expect(evaluateCronWindow(dispatches([V1]), presence)).toBe("ok window");
    expect(evaluateCronWindow(dispatches(Array.from({ length: 10 }, () => V1)), presence)).toBe(
      "ok window",
    );
    expect(evaluateCronWindow([], presence)).toBe(
      'FAIL window: no "cron dispatched" line for pinar-stg in 15 s',
    );
  });
});

// --- runPlatformProofs -----------------------------------------------------

interface Call {
  headers: Record<string, string>;
  method: string;
  url: string;
}

interface PlatformFakesOverrides {
  health?: (index: number) => ProofResponse;
  named?: ProofResponse;
  /** The promote response status (200 by default). */
  promoteStatus?: number;
  installCode?: number;
  /** Lines present before the proofs run (the v1 dispatches proof 8 sees). */
  initialLines?: string[];
  /**
   * F1: a line the writer starts before proof 9's window opens and
   * finishes inside it: `prefix` (no `\n`) is appended at the end of the
   * settle, `suffix` at the start of the 10 s window. Bytes split a
   * multibyte character across the window start.
   */
  headStraddle?: { prefix: string | Uint8Array; suffix: string | Uint8Array };
  /** Lines the writer appends at the start of proof 9's 10 s window. */
  stagedLines?: string[];
  /**
   * F1: a line the writer leaves straddling proof 9's end (appended
   * without `\n` when the window closes).
   */
  straddlePrefix?: string;
  /** F1: the rest of the straddling line; it finishes on the next poll. */
  straddleSuffix?: string;
  /** Lines the writer appends at the start of proof 10's 10 s window. */
  promotedLines?: string[];
  /** F2: a new v1 dispatch appears during proof 10's sync poll (default true). */
  syncLine?: boolean;
  /** F2: the promote advances the fake clock by this many ms (default 50). */
  promoteSlowMs?: number;
  /** F2: the sync deadline for the fake clock (default 15 s). */
  promoteSyncDeadlineMs?: number;
  /** Proof 8's read offset (default 0). */
  firstInstallOffset?: number;
  deadlineMs?: number;
  pollMs?: number;
  /** Lines written only after the straddling line finishes (after E). */
  afterStraddle?: string[];
  /**
   * Deadline revalidation: the first proof 8 poll resumes after the
   * deadline, and the v1 line finishes at that instant.
   */
  latePresence?: boolean;
  /**
   * Deadline revalidation: the first window-end poll resumes past the 2 s
   * deadline, and the straddling line finishes at that instant.
   */
  lateWindowEnd?: boolean;
  /**
   * Deadline revalidation: the first sync poll resumes after the sync
   * deadline, and the v1 line finishes at that instant.
   */
  lateSync?: boolean;
}

interface FakeRun {
  calls: Call[];
  deps: PlatformProofDeps;
  /** The log content before the proofs run (for offset math). */
  initialText: string;
}

/**
 * The standard fakes: a real log **file in bytes** (offsets and the
 * byte-before check in bytes, `Buffer` throughout — the same unit as the
 * real I/O), with a writer that appends bytes at the right moments, a fake
 * clock (every sleep advances it), the name-based routes 404, the host
 * health passing, the v2 installer succeeding and the promote succeeding.
 */
function platformFakes(overrides: PlatformFakesOverrides = {}): FakeRun {
  const calls: Call[] = [];
  const initialText = (overrides.initialLines ?? [cronLine("pinar-stg", V1, 200)])
    .map((line) => `${line}\n`)
    .join("");
  let log = Buffer.from(initialText, "utf8");
  const append = (text: string | Uint8Array): void => {
    log = Buffer.concat([log, typeof text === "string" ? Buffer.from(text, "utf8") : text]);
  };
  let now = 0;
  let logSizeCalls = 0;
  let windowsSeen = 0;
  let headStraddleWritten = false;
  let straddleCompleted = false;
  let syncLineWritten = false;
  let latePresenceFired = false;
  let lateWindowEndFired = false;
  const healthIndex = { count: 0 };
  const fetch: ProofFetch = async (url, init) => {
    calls.push({ headers: init.headers, method: init.method, url });
    if (url.includes("/api/admin/workers/pinar-stg/promote?version=")) {
      now += overrides.promoteSlowMs ?? 50;
      return jsonResponse(overrides.promoteStatus ?? 200, {
        name: "pinar-stg",
        status: "promoted",
      });
    }
    if (init.headers["Host"] === `127.0.0.1:18100`) return overrides.named ?? jsonResponse(404, {});
    if (url.endsWith("/api/health")) {
      healthIndex.count += 1;
      return overrides.health?.(healthIndex.count) ?? jsonResponse(200, { hasDb: true, service: "pinar" });
    }
    return jsonResponse(200, {});
  };
  const deps: PlatformProofDeps = {
    deadlineMs: overrides.deadlineMs ?? 300,
    fetch,
    firstInstallOffset: overrides.firstInstallOffset ?? 0,
    installSecond: async () => overrides.installCode ?? 0,
    logSize: () => {
      logSizeCalls += 1;
      return log.length;
    },
    logTail: (offset: number) => log.subarray(offset),
    nowMs: () => now,
    prevByteIsNewline: (offset: number) => offset <= 0 || log[offset - 1] === 0x0a,
    pollMs: overrides.pollMs ?? 20,
    port: 18100,
    promoteSyncDeadlineMs: overrides.promoteSyncDeadlineMs,
    rootKey: () => "the-root-key-0001112223334445556667",
    sleepMs: async (ms: number) => {
      now += ms;
      if (ms === CRON_SETTLE_MS && windowsSeen === 0 && overrides.headStraddle !== undefined) {
        // The writer is mid-line when the window opens.
        append(overrides.headStraddle.prefix);
        headStraddleWritten = true;
      }
      if (ms === CRON_WINDOW_MS) {
        windowsSeen += 1;
        if (windowsSeen === 1) {
          if (headStraddleWritten && overrides.headStraddle !== undefined) {
            append(overrides.headStraddle.suffix);
            append("\n");
          }
          append((overrides.stagedLines ?? []).map((line) => `${line}\n`).join(""));
          if (overrides.straddlePrefix !== undefined) append(overrides.straddlePrefix);
        } else {
          append((overrides.promotedLines ?? []).map((line) => `${line}\n`).join(""));
        }
      }
      if (ms === 100) {
        // F1: the straddling line finishes on the next read (or never);
        // anything written after it began after E.
        if (
          overrides.straddlePrefix !== undefined &&
          overrides.straddleSuffix !== undefined &&
          windowsSeen >= 1 &&
          !straddleCompleted
        ) {
          if (overrides.lateWindowEnd && !lateWindowEndFired) {
            // The poll resumes 2.1 s in, past the 2 s deadline; the line
            // finishes at that instant.
            now += 2_001;
            lateWindowEndFired = true;
          }
          append(`${overrides.straddleSuffix}\n`);
          straddleCompleted = true;
          if (overrides.afterStraddle !== undefined) {
            append(overrides.afterStraddle.map((line) => `${line}\n`).join(""));
          }
        }
        // F2: logSize call #3 is the sync base; a new v1 dispatch appears
        // while proof 10 waits to synchronize the promote.
        if (overrides.syncLine !== false && logSizeCalls >= 3 && !syncLineWritten) {
          if (overrides.lateSync) {
            // The poll resumes past the sync deadline; the line finishes at
            // that instant.
            now += (overrides.promoteSyncDeadlineMs ?? 15_000) + 1;
          }
          append(`${cronLine("pinar-stg", V1, 200, "/_internal/cron/daily", "cron-sync")}\n`);
          syncLineWritten = true;
        }
      }
      // Proof 8's poll: a v1 line that appears only after the deadline.
      if (ms === (overrides.pollMs ?? 20) && overrides.latePresence && !latePresenceFired) {
        now += (overrides.deadlineMs ?? 300) + 1;
        append(`${cronLine("pinar-stg", V1, 200)}\n`);
        latePresenceFired = true;
      }
    },
    version: V1,
    version2: V2,
  };
  return { calls, deps, initialText };
}

const lineAt = (lines: string[], index: number): string => lines[index] ?? "";

describe("runPlatformProofs", () => {
  test("all seven lines pass when the platform behaves", async () => {
    const run = platformFakes({
      stagedLines: Array.from({ length: 5 }, () => cronLine("pinar-stg", V1, 200)),
      promotedLines: Array.from({ length: 5 }, () => cronLine("pinar-stg", V2, 200)),
    });
    const outcome = await runPlatformProofs(run.deps);
    expect(outcome.allOk).toBe(true);
    expect(outcome.lines).toHaveLength(7);
    for (const line of outcome.lines) expect(line.startsWith("ok ")).toBe(true);
    expect(outcome.lines[0]).toBe(`ok GET /pinar-stg/api/health (Host: 127.0.0.1:18100) → 404`);
    expect(outcome.lines[1]).toBe(
      `ok GET /pinar-stg@${V1}/api/health (Host: 127.0.0.1:18100) → 404`,
    );
    expect(outcome.lines[2]).toBe(
      "ok GET /api/health (Host: stg.pinar.dev) → 200, service pinar, hasDb",
    );
    expect(outcome.lines[3]).toBe(`ok cron dispatch to pinar-stg@${V1} within 15 s`);
    expect(outcome.lines[4]).toBe(
      `ok cron window after staging ${V2}: 3–6 dispatches to pinar-stg@${V1}, none to ${V2}`,
    );
    expect(outcome.lines[5]).toBe(
      `ok cron window after promoting ${V2}: 3–6 dispatches to pinar-stg@${V2}, none to ${V1}`,
    );
    expect(outcome.lines[6]).toBe(
      "ok GET /api/health (Host: stg.pinar.dev) → 200, service pinar, hasDb",
    );
    // The name-based routes were asked with the loopback host.
    const named = run.calls.filter((call) => call.headers["Host"] === "127.0.0.1:18100");
    expect(named.map((call) => call.url)).toEqual([
      "http://127.0.0.1:18100/pinar-stg/api/health",
      `http://127.0.0.1:18100/pinar-stg@${V1}/api/health`,
    ]);
    // The promote went to 127.0.0.1 with the bearer key, and the key never
    // reaches a line.
    const promote = run.calls.find(
      (call) => call.method === "POST" && call.url.includes("/promote?version="),
    );
    expect(promote?.url).toBe(
      `http://127.0.0.1:18100/api/admin/workers/pinar-stg/promote?version=${V2}`,
    );
    expect(promote?.headers["authorization"]).toBe("Bearer the-root-key-0001112223334445556667");
    for (const line of outcome.lines) {
      expect(line.includes("the-root-key-0001112223334445556667")).toBe(false);
    }
  });

  test("a name-based route that answers 200 fails with the status, both routes", async () => {
    const run = platformFakes({ named: jsonResponse(200, { hasDb: true, service: "pinar" }) });
    const outcome = await runPlatformProofs(run.deps);
    expect(outcome.allOk).toBe(false);
    expect(lineAt(outcome.lines, 0)).toBe(
      `FAIL GET /pinar-stg/api/health (Host: 127.0.0.1:18100) → 404: status 200`,
    );
    expect(lineAt(outcome.lines, 1)).toBe(
      `FAIL GET /pinar-stg@${V1}/api/health (Host: 127.0.0.1:18100) → 404: status 200`,
    );
  });

  test("a non-404 4xx on the name-based routes still fails: exactly 404 is required", async () => {
    const run = platformFakes({ named: jsonResponse(403, {}) });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 0)).toBe(
      `FAIL GET /pinar-stg/api/health (Host: 127.0.0.1:18100) → 404: status 403`,
    );
    expect(lineAt(outcome.lines, 1)).toBe(
      `FAIL GET /pinar-stg@${V1}/api/health (Host: 127.0.0.1:18100) → 404: status 403`,
    );
  });

  test("a v2-only cron dispatch does not satisfy the v1 presence proof", async () => {
    const run = platformFakes({ initialLines: [cronLine("pinar-stg", V2, 200)] });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 3)).toBe(
      `FAIL cron dispatch to pinar-stg@${V1} within 15 s: no "cron dispatched" line for pinar-stg in 15 s`,
    );
  });

  test("the rc.18 shape: the five ok plus 6/8/9/10 failing for the missing cron line", async () => {
    const run = platformFakes({
      named: jsonResponse(200, { hasDb: true, service: "pinar" }),
      // No `cron dispatched` line at any point.
      initialLines: [],
      syncLine: false,
    });
    const outcome = await runPlatformProofs(run.deps);
    expect(outcome.allOk).toBe(false);
    expect(outcome.lines).toHaveLength(7);
    expect(lineAt(outcome.lines, 0)).toBe(
      `FAIL GET /pinar-stg/api/health (Host: 127.0.0.1:18100) → 404: status 200`,
    );
    expect(lineAt(outcome.lines, 1)).toBe(
      `FAIL GET /pinar-stg@${V1}/api/health (Host: 127.0.0.1:18100) → 404: status 200`,
    );
    expect(lineAt(outcome.lines, 2).startsWith("ok ")).toBe(true);
    expect(lineAt(outcome.lines, 3)).toBe(
      `FAIL cron dispatch to pinar-stg@${V1} within 15 s: no "cron dispatched" line for pinar-stg in 15 s`,
    );
    expect(lineAt(outcome.lines, 4)).toBe(
      `FAIL cron window after staging ${V2}: 3–6 dispatches to pinar-stg@${V1}, none to ${V2}: no "cron dispatched" line for pinar-stg in the 10 s window`,
    );
    expect(lineAt(outcome.lines, 5)).toBe(
      `FAIL cron window after promoting ${V2}: 3–6 dispatches to pinar-stg@${V2}, none to ${V1}: no v1 dispatch to synchronize the promote`,
    );
    expect(lineAt(outcome.lines, 6).startsWith("ok ")).toBe(true);
    // Without a v1 dispatch to synchronize on, the promote never runs.
    expect(run.calls.some((call) => call.url.includes("/promote?version="))).toBe(false);
  });

  test("a non-2xx cron dispatch fails the presence proof with its status", async () => {
    const run = platformFakes({ initialLines: [cronLine("pinar-stg", V1, 500)] });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 3)).toBe(
      `FAIL cron dispatch to pinar-stg@${V1} within 15 s: dispatch ${V1} returned 500`,
    );
  });

  test("a failed v2 install fails the window proof with the exit code", async () => {
    const run = platformFakes({ installCode: 1 });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 4)).toBe(
      `FAIL cron window after staging ${V2}: 3–6 dispatches to pinar-stg@${V1}, none to ${V2}: install ${V2} exited 1`,
    );
    // Proof 10 still runs: with no window it never sees a v1 dispatch.
    expect(lineAt(outcome.lines, 5)).toBe(
      `FAIL cron window after promoting ${V2}: 3–6 dispatches to pinar-stg@${V2}, none to ${V1}: no v1 dispatch to synchronize the promote`,
    );
  });

  test("a window mixing in the forbidden version fails naming it", async () => {
    // Proof 9's window: v1 only except one v2.
    const run = platformFakes({
      stagedLines: [
        cronLine("pinar-stg", V1, 200),
        cronLine("pinar-stg", V1, 200),
        cronLine("pinar-stg", V1, 200),
        cronLine("pinar-stg", V2, 200),
      ],
    });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 4)).toBe(
      `FAIL cron window after staging ${V2}: 3–6 dispatches to pinar-stg@${V1}, none to ${V2}: dispatch to forbidden ${V2} instead of ${V1}`,
    );
  });

  test("a window with 10 dispatches fails as duplication", async () => {
    const many = platformFakes({
      stagedLines: Array.from({ length: 5 }, () => cronLine("pinar-stg", V1, 200)),
      promotedLines: Array.from({ length: 10 }, () => cronLine("pinar-stg", V2, 200)),
    });
    const manyOutcome = await runPlatformProofs(many.deps);
    expect(lineAt(manyOutcome.lines, 4)).toBe(
      `ok cron window after staging ${V2}: 3–6 dispatches to pinar-stg@${V1}, none to ${V2}`,
    );
    expect(lineAt(manyOutcome.lines, 5)).toBe(
      `FAIL cron window after promoting ${V2}: 3–6 dispatches to pinar-stg@${V2}, none to ${V1}: 10 dispatches to ${V2} in the 10 s window (max 6); possible duplication`,
    );
  });

  test("a window with too few dispatches fails with the count", async () => {
    const few = platformFakes({
      stagedLines: [cronLine("pinar-stg", V1, 200), cronLine("pinar-stg", V1, 200)],
    });
    const fewOutcome = await runPlatformProofs(few.deps);
    expect(lineAt(fewOutcome.lines, 4)).toBe(
      `FAIL cron window after staging ${V2}: 3–6 dispatches to pinar-stg@${V1}, none to ${V2}: only 2 dispatch(es) to ${V1}, need at least 3 in the 10 s window`,
    );
  });

  test("a failed promote fails proof 10 with the status and no body", async () => {
    const run = platformFakes({ promoteStatus: 400 });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 5)).toBe(
      `FAIL cron window after promoting ${V2}: 3–6 dispatches to pinar-stg@${V2}, none to ${V1}: promote ${V2}: status 400`,
    );
  });

  test("the final health proof runs after the promote and can fail", async () => {
    const run = platformFakes({
      health: (index) =>
        index === 1
          ? jsonResponse(200, { hasDb: true, service: "pinar" })
          : jsonResponse(200, { hasDb: false, service: "pinar" }),
    });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 2).startsWith("ok ")).toBe(true);
    expect(lineAt(outcome.lines, 6)).toBe(
      "FAIL GET /api/health (Host: stg.pinar.dev) → 200, service pinar, hasDb: hasDb is false",
    );
    expect(outcome.allOk).toBe(false);
  });

  test("a fetch error on a proof is a FAIL with the error message", async () => {
    const run = platformFakes({});
    const originalFetch = run.deps.fetch;
    run.deps.fetch = async (url, init) => {
      if (url.endsWith("/api/health") && init.headers["Host"] === "stg.pinar.dev") {
        throw new Error("connect ECONNREFUSED 127.0.0.1:18100");
      }
      return originalFetch(url, init);
    };
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 2)).toBe(
      "FAIL GET /api/health (Host: stg.pinar.dev) → 200, service pinar, hasDb: connect ECONNREFUSED 127.0.0.1:18100",
    );
    expect(lineAt(outcome.lines, 6)).toBe(
      "FAIL GET /api/health (Host: stg.pinar.dev) → 200, service pinar, hasDb: connect ECONNREFUSED 127.0.0.1:18100",
    );
  });

  // F1: line boundaries.

  test("a line straddling the window end is included when it finishes: a forbidden one fails, never ok", async () => {
    const straddling = cronLine("pinar-stg", V2, 200);
    const run = platformFakes({
      stagedLines: Array.from({ length: 5 }, () => cronLine("pinar-stg", V1, 200)),
      // The v2 line is still being written when the window closes.
      straddlePrefix: straddling.slice(0, -1),
      straddleSuffix: straddling.slice(-1),
    });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 4)).toBe(
      `FAIL cron window after staging ${V2}: 3–6 dispatches to pinar-stg@${V1}, none to ${V2}: dispatch to forbidden ${V2} instead of ${V1}`,
    );
  });

  test("a straddling line that finishes as the expected version counts in the window", async () => {
    const straddling = cronLine("pinar-stg", V1, 200);
    const run = platformFakes({
      stagedLines: [cronLine("pinar-stg", V1, 200), cronLine("pinar-stg", V1, 200)],
      straddlePrefix: straddling.slice(0, -1),
      straddleSuffix: straddling.slice(-1),
    });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 4)).toBe(
      `ok cron window after staging ${V2}: 3–6 dispatches to pinar-stg@${V1}, none to ${V2}`,
    );
  });

  test("a straddling line that never finishes fails the window with the incomplete detail", async () => {
    const straddling = cronLine("pinar-stg", V1, 200);
    const run = platformFakes({
      stagedLines: Array.from({ length: 5 }, () => cronLine("pinar-stg", V1, 200)),
      straddlePrefix: straddling.slice(0, -1),
    });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 4)).toBe(
      `FAIL cron window after staging ${V2}: 3–6 dispatches to pinar-stg@${V1}, none to ${V2}: incomplete log line at window end`,
    );
  });

  test("a line still being written before the window start never counts", async () => {
    // The writer starts a v2 line during the settle; its tail (the part
    // after the window start) is parseable as a v2 dispatch if the head
    // drop is off.
    const straddling = cronLine("pinar-stg", V2, 200);
    const cut = straddling.indexOf("cron dispatched");
    const run = platformFakes({
      stagedLines: Array.from({ length: 5 }, () => cronLine("pinar-stg", V1, 200)),
      headStraddle: { prefix: straddling.slice(0, cut), suffix: straddling.slice(cut) },
    });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 4)).toBe(
      `ok cron window after staging ${V2}: 3–6 dispatches to pinar-stg@${V1}, none to ${V2}`,
    );
  });

  test("a read that starts mid-line does not count the previous line's tail", async () => {
    const lineA = cronLine("pinar-stg", V1, 200);
    const lineB = cronLine("pinar-stg", V1, 200);
    const run = platformFakes({
      initialLines: [lineA, lineB],
      // Five bytes into line B: its tail is complete and parseable inside
      // the read, but it belongs to the line before the window start.
      firstInstallOffset: `${lineA}\n`.length + 5,
    });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 3)).toBe(
      `FAIL cron dispatch to pinar-stg@${V1} within 15 s: no "cron dispatched" line for pinar-stg in 15 s`,
    );
  });

  // F2: the promote synchronized to the scheduler tick.

  test("no v1 dispatch to synchronize on fails proof 10 and skips the promote", async () => {
    const run = platformFakes({
      stagedLines: Array.from({ length: 5 }, () => cronLine("pinar-stg", V1, 200)),
      syncLine: false,
    });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 5)).toBe(
      `FAIL cron window after promoting ${V2}: 3–6 dispatches to pinar-stg@${V2}, none to ${V1}: no v1 dispatch to synchronize the promote`,
    );
    expect(run.calls.some((call) => call.url.includes("/promote?version="))).toBe(false);
  });

  test("a promote slower than 1.000 ms after the v1 dispatch fails naming the duration", async () => {
    const run = platformFakes({ promoteSlowMs: 1500 });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 5)).toBe(
      `FAIL cron window after promoting ${V2}: 3–6 dispatches to pinar-stg@${V2}, none to ${V1}: promote took 1500 ms after the v1 dispatch; the window may hold an in-flight v1 dispatch`,
    );
  });

  test("a v1 dispatch inside the post-promote window still fails: dispatching to both versions must fail", async () => {
    const run = platformFakes({
      promotedLines: [
        ...Array.from({ length: 5 }, () => cronLine("pinar-stg", V2, 200)),
        cronLine("pinar-stg", V1, 200),
      ],
    });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 5)).toBe(
      `FAIL cron window after promoting ${V2}: 3–6 dispatches to pinar-stg@${V2}, none to ${V1}: dispatch to forbidden ${V1} instead of ${V2}`,
    );
  });

  // Bytes: the window is bounded in bytes and decoded only at the end.

  test("a window with multibyte text before E never includes a line written after E", async () => {
    const straddling = cronLine("pinar-stg", V1, 200);
    const run = platformFakes({
      stagedLines: [
        cronLine("pinar-stg", V1, 200),
        cronLine("pinar-stg", V1, 200),
        cronLine("pinar-stg", V1, 200),
        "INFO erro: conexão inválida",
      ],
      straddlePrefix: straddling.slice(0, -1),
      straddleSuffix: straddling.slice(-1),
      afterStraddle: [cronLine("pinar-stg", V2, 200)],
    });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 4)).toBe(
      `ok cron window after staging ${V2}: 3–6 dispatches to pinar-stg@${V1}, none to ${V2}`,
    );
  });

  test("a straddling ignored line with multibyte on both sides of E keeps the window bounded", async () => {
    const run = platformFakes({
      stagedLines: [
        cronLine("pinar-stg", V1, 200),
        cronLine("pinar-stg", V1, 200),
        cronLine("pinar-stg", V1, 200),
      ],
      // The writer is mid-way through an ignored multibyte line at E:
      // `conexão` before E, `inválida` after.
      straddlePrefix: "INFO erro: conexão ",
      straddleSuffix: "inválida",
      afterStraddle: [cronLine("pinar-stg", V2, 200)],
    });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 4)).toBe(
      `ok cron window after staging ${V2}: 3–6 dispatches to pinar-stg@${V1}, none to ${V2}`,
    );
  });

  test("a multibyte partial head before the window start never counts", async () => {
    const straddling = `2026-10-15T03:00:00.123456Z  INFO erro: conexão inválida cron dispatched worker=pinar-stg version=${V2} path=/_internal/cron/daily method=POST request_id=cron-x status=200`;
    const cut = straddling.indexOf("cron dispatched");
    const run = platformFakes({
      stagedLines: Array.from({ length: 5 }, () => cronLine("pinar-stg", V1, 200)),
      headStraddle: { prefix: straddling.slice(0, cut), suffix: straddling.slice(cut) },
    });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 4)).toBe(
      `ok cron window after staging ${V2}: 3–6 dispatches to pinar-stg@${V1}, none to ${V2}`,
    );
  });

  test("a window that starts inside a multibyte character still bounds E in bytes", async () => {
    // The window opens on the second byte of `ã`: the head drop and the cut
    // at E stay in bytes, so a v2 line that began one byte before E and
    // finishes after it still enters the window and fails it. A lossy
    // decode of that head (U+FFFD is 3 bytes) would shift E back past the
    // line's start and hide it.
    const ignored = Buffer.from("INFO erro: conexão inválida", "utf8");
    const split = ignored.indexOf(0xc3) + 1;
    const straddling = cronLine("pinar-stg", V2, 200);
    const run = platformFakes({
      headStraddle: { prefix: ignored.subarray(0, split), suffix: ignored.subarray(split) },
      stagedLines: Array.from({ length: 3 }, () => cronLine("pinar-stg", V1, 200)),
      straddlePrefix: straddling.slice(0, 1),
      straddleSuffix: straddling.slice(1),
    });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 4)).toBe(
      `FAIL cron window after staging ${V2}: 3–6 dispatches to pinar-stg@${V1}, none to ${V2}: dispatch to forbidden ${V2} instead of ${V1}`,
    );
  });

  // Deadlines are revalidated after every wait.

  test("a window end that completes just after the 2 s deadline still fails", async () => {
    const straddling = cronLine("pinar-stg", V1, 200);
    const run = platformFakes({
      stagedLines: Array.from({ length: 5 }, () => cronLine("pinar-stg", V1, 200)),
      straddlePrefix: straddling.slice(0, -1),
      straddleSuffix: straddling.slice(-1),
      lateWindowEnd: true,
    });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 4)).toBe(
      `FAIL cron window after staging ${V2}: 3–6 dispatches to pinar-stg@${V1}, none to ${V2}: incomplete log line at window end`,
    );
  });

  test("a v1 dispatch that appears just after the proof 8 deadline still fails", async () => {
    const run = platformFakes({ initialLines: [], latePresence: true });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 3)).toBe(
      `FAIL cron dispatch to pinar-stg@${V1} within 15 s: no "cron dispatched" line for pinar-stg in 15 s`,
    );
  });

  test("a v1 dispatch that appears just after the sync deadline still fails", async () => {
    const run = platformFakes({ promoteSyncDeadlineMs: 300, lateSync: true });
    const outcome = await runPlatformProofs(run.deps);
    expect(lineAt(outcome.lines, 5)).toBe(
      `FAIL cron window after promoting ${V2}: 3–6 dispatches to pinar-stg@${V2}, none to ${V1}: no v1 dispatch to synchronize the promote`,
    );
  });
});
