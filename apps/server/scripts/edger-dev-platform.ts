/**
 * The `edger:dev --platform-proofs` additions (EDG-26 and EDG-27): pure
 * helpers for the platform artifact and the `cron dispatched` log lines,
 * plus the seven platform proof lines that run after the five existing
 * proofs. All I/O is injected by the caller (`edger-dev.ts` owns the
 * processes); nothing here touches the network on its own.
 *
 * The cron proof counts the stable info line emitted by the EdgeR
 * scheduler, in `tracing_subscriber::fmt` text form:
 *
 *   2026-10-15T03:00:00.123456Z  INFO edger_orchestrator::cron: cron dispatched worker=pinar-stg version=0.0.0-dev.1760497200 path=/_internal/cron/daily method=POST request_id=cron-1b2c status=200
 *
 * `parseCronDispatches` reads the fields as `key=value` pairs, in any
 * order, quoted or not, and ignores extra fields.
 *
 * Line boundaries (F1): a log line only counts once it is complete — the
 * last segment of a read without a trailing `\n` is ignored (on the
 * polling reads it counts on the next read, whole). The window is bounded
 * in **bytes** (`logSize` is `statSync().size`): `logTail` returns the
 * bytes of `[offset, size)`, the partial-head drop, the cut at the end
 * offset and the straddling line's terminator are found by scanning for
 * `0x0a`, and only the final bounded span is decoded as UTF-8 before
 * `parseCronDispatches` (which keeps receiving a string). A read that
 * starts in the middle of a line drops the tail of the line before it
 * (`dropPartialHead`), and a line straddling the end of a 9/10 window
 * gets `WINDOW_END_WAIT_MS` of 100 ms polls to finish before the window
 * is judged (a line that begins after the end never enters).
 *
 * Deadlines are revalidated after every wait: a success observed after the
 * deadline is a FAIL — in the window-end wait, in proof 8's presence poll
 * and in proof 10's promote synchronization.
 *
 * The promote (proof 10) is synchronized to the scheduler tick (F2): the
 * rc.18 scheduler awaits each dispatch before sleeping the next `@every`
 * interval (`crates/edger-orchestrator/src/cron.rs`, `run_job`), so a v1
 * line just seen means no v1 dispatch is in flight; the promote must
 * answer within `PROMOTE_SYNC_MAX_MS` (half of the 2 s interval) of it.
 */
import type { ProofFetch, ProofResponse } from "./edger-dev";

/**
 * The project tsconfig types `src` against node + workerd (no Bun types),
 * and `scripts` is outside its `include`. The script runs on Bun, so the
 * one Bun API it uses is declared module-locally: no Bun types leak into
 * the program, and the runtime global satisfies it.
 */
declare const Bun: {
  YAML: { parse: (text: string) => unknown; stringify: (value: unknown) => string };
};

/** The host the staging worker serves (the `WORKERS.staging` hosts). */
export const STAGING_HOST = "stg.pinar.dev";
/** The EdgeR worker name the staging install creates. */
export const STAGING_WORKER = "pinar-stg";
/** The cron schedule the platform proofs rewrite into the artifact copy. */
export const PLATFORM_CRON_SCHEDULE = "@every 2s";
/** How long the cron presence proof (8) may keep polling the log. */
export const CRON_PRESENCE_MS = 15_000;
/** The poll pause between cron presence attempts. */
export const CRON_PRESENCE_POLL_MS = 500;
/** The settle after installing v2 / promoting v2, before the window opens. */
export const CRON_SETTLE_MS = 3_000;
/** The observation window after the settle. */
export const CRON_WINDOW_MS = 10_000;
/** The path every platform cron job targets in the manifest. */
const CRON_JOB_PATH = "/_internal/cron/daily";
/** Proof 10: the poll pause while waiting for the v1 dispatch to synchronize the promote. */
export const PROMOTE_SYNC_POLL_MS = 100;
/** Proof 10: how long to wait for the v1 dispatch before giving up (F2). */
export const PROMOTE_SYNC_DEADLINE_MS = 15_000;
/**
 * The promote must answer within this of the seen v1 dispatch (F2). The
 * rc.18 scheduler awaits each dispatch before sleeping the next `@every`
 * interval (`cron.rs`, `run_job`), so half of the 2 s interval leaves no
 * room for an in-flight v1 dispatch to conclude inside the measured window.
 */
export const PROMOTE_SYNC_MAX_MS = 1_000;
/** A log line straddling the end of a 9/10 window gets this long to finish (F1). */
export const WINDOW_END_WAIT_MS = 2_000;
/** The poll pause while waiting for the straddling line to finish (F1). */
export const WINDOW_END_POLL_MS = 100;
const ANSI =
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]/g;

/** One parsed `cron dispatched` line. */
export interface CronDispatch {
  status: number;
  version: string;
}

/** `tracing_subscriber::fmt` text form with ANSI escapes removed. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/**
 * A read from an offset that starts in the middle of a line (the byte
 * before it in the file is not `0x0a`): everything up to the first `0x0a`
 * is the tail of the line before the window, and it never counts. When
 * there is no `0x0a` at all the read is kept: it is a straddling line,
 * which the caller's window-end wait completes (or fails). Bytes in, bytes
 * out: the UTF-8 decode happens only once the span is bounded.
 */
export function dropPartialHead(bytes: Uint8Array, startsAtLineBoundary: boolean): Uint8Array {
  if (startsAtLineBoundary) return bytes;
  const newline = indexOfNewline(bytes, 0);
  return newline === -1 ? bytes : bytes.subarray(newline + 1);
}

/** The first `0x0a` in `bytes` at or after `from`, or -1 (UTF-8 continuation bytes are never `0x0a`). */
function indexOfNewline(bytes: Uint8Array, from: number): number {
  for (let i = Math.max(0, from); i < bytes.length; i += 1) {
    if (bytes[i] === 0x0a) return i;
  }
  return -1;
}

const utf8 = new TextDecoder("utf-8");

/** Decodes a bounded span of the log (only after the byte boundary is set). */
function decodeUtf8(bytes: Uint8Array): string {
  return utf8.decode(bytes);
}

/**
 * `manifestText` with its single cron job's `schedule` set to `schedule`.
 * The template must declare exactly one cron job, with `path:
 * /_internal/cron/daily`; anything else is a setup error.
 */
export function patchCronSchedule(manifestText: string, schedule: string): string {
  const manifest = Bun.YAML.parse(manifestText) as { cron?: unknown };
  const jobs = Array.isArray(manifest.cron) ? manifest.cron : [];
  if (jobs.length !== 1) {
    throw new Error(`manifest has ${jobs.length} cron job(s); the platform proofs require exactly one`);
  }
  const job = jobs[0] as { path?: unknown };
  if (typeof job.path !== "string" || job.path !== CRON_JOB_PATH) {
    throw new Error(
      `the single cron job must have path ${CRON_JOB_PATH} (found ${JSON.stringify(job.path)})`,
    );
  }
  (job as { schedule: string }).schedule = schedule;
  return Bun.YAML.stringify(manifest);
}

/** `key=value` pairs of a log line; quoted values lose the quotes. */
function parseFields(line: string): Map<string, string> {
  const fields = new Map<string, string>();
  const pattern = /\b([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|([^\s"=]+))/g;
  for (const match of line.matchAll(pattern)) {
    fields.set(match[1] ?? "", match[2] !== undefined ? match[2] : match[3] ?? "");
  }
  return fields;
}

/**
 * The `cron dispatched` lines of `logText` that belong to `workerName`, in
 * log order. A line counts when, ANSI-free, it contains `cron dispatched`
 * and its fields carry a matching `worker`, a `request_id` that starts
 * with `cron-`, a `path` ending in `/_internal/cron/daily`, a `version`
 * and an integer `status`. Every other line — other workers, other paths,
 * a request id without the `cron-` prefix, the pipeline debug line — is
 * ignored, and so is a line missing the version or the status.
 *
 * Only complete lines count (F1): the last segment of a text that does not
 * end in `\n` is a line still being written and is ignored; a writer that
 * finishes it makes it count on the next read.
 */
export function parseCronDispatches(logText: string, workerName: string): CronDispatch[] {
  const lastNewline = logText.lastIndexOf("\n");
  if (lastNewline === -1) return [];
  const out: CronDispatch[] = [];
  for (const rawLine of logText.slice(0, lastNewline).split("\n")) {
    const line = stripAnsi(rawLine);
    if (!line.includes("cron dispatched")) continue;
    const fields = parseFields(line);
    if (fields.get("worker") !== workerName) continue;
    const requestId = fields.get("request_id");
    if (requestId === undefined || !requestId.startsWith("cron-")) continue;
    const path = fields.get("path");
    if (path === undefined || !path.endsWith(CRON_JOB_PATH)) continue;
    const version = fields.get("version");
    if (version === undefined || version === "") continue;
    const statusText = fields.get("status");
    const status = Number(statusText);
    if (statusText === undefined || !Number.isInteger(status)) continue;
    out.push({ status, version });
  }
  return out;
}

export interface CronWindowSpec {
  /** The `ok`/`FAIL` description (printed without the detail). */
  desc: string;
  /** The version the cron must dispatch. */
  expected: string;
  /** A version that must not be dispatched; `null` when there is none. */
  forbidden: string | null;
  /** Minimum dispatches to the expected version in the window. */
  min: number;
  /** Maximum dispatches to the expected version; `null` means no cap. */
  max: number | null;
  /** The worker name, for the empty-window detail. */
  worker: string;
  /** The human-readable observation window, for the details. */
  window: string;
}

/**
 * Evaluates a dispatch window: the `ok <desc>` / `FAIL <desc>: <detail>`
 * line. Any dispatch outside 2xx fails at once with its version and
 * status (a 404 here would mean the internal cron route is blocked).
 * Otherwise every 2xx dispatch must be the expected version and their
 * count must fall within `min`..`max` (a count above `max` means
 * duplication).
 */
export function evaluateCronWindow(
  dispatches: readonly CronDispatch[],
  spec: CronWindowSpec,
): string {
  const bad = dispatches.find((dispatch) => dispatch.status < 200 || dispatch.status >= 300);
  if (bad !== undefined) {
    return `FAIL ${spec.desc}: dispatch ${bad.version} returned ${bad.status}`;
  }
  const other = dispatches.find((dispatch) => dispatch.version !== spec.expected);
  if (other !== undefined) {
    const which =
      spec.forbidden !== null && other.version === spec.forbidden
        ? `forbidden ${other.version}`
        : `version ${other.version}`;
    return `FAIL ${spec.desc}: dispatch to ${which} instead of ${spec.expected}`;
  }
  const count = dispatches.length;
  if (count < spec.min) {
    if (count === 0) {
      return `FAIL ${spec.desc}: no "cron dispatched" line for ${spec.worker} in ${spec.window}`;
    }
    return `FAIL ${spec.desc}: only ${count} dispatch(es) to ${spec.expected}, need at least ${spec.min} in ${spec.window}`;
  }
  if (spec.max !== null && count > spec.max) {
    return `FAIL ${spec.desc}: ${count} dispatches to ${spec.expected} in ${spec.window} (max ${spec.max}); possible duplication`;
  }
  return `ok ${spec.desc}`;
}

/**
 * `null` when the health proof passes; otherwise the failing detail. The
 * same check the first of the five proofs runs: 200, `service: "pinar"`
 * and `hasDb: true`.
 */
export async function healthCheck(
  attempt: () => Promise<ProofResponse>,
): Promise<string | null> {
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

/**
 * The injected dependencies of the platform proofs: the fetch (only
 * 127.0.0.1 in the real run), the EdgeR log reads (`logSize` at a given
 * instant, `logTail` from an offset to now), the v2 installer step, the
 * root key reader and the sleeps. The real root key never reaches a line.
 */
export interface PlatformProofDeps {
  fetch: ProofFetch;
  port: number;
  /** The v1 version (staged + promoted before the five proofs). */
  version: string;
  /** The v2 version, staged with `--no-promote` in proof 9. */
  version2: string;
  /** The log size right before the v1 install (proof 8's window start). */
  firstInstallOffset: number;
  logSize: () => number;
  /**
   * The bytes of `[offset, size)` of the log (the window is bounded in
   * bytes). Never a decoded string: a read that starts inside a multibyte
   * character decodes lossily, and its offsets cannot be recovered.
   */
  logTail: (offset: number) => Uint8Array;
  /**
   * The byte right before `offset` in the log is `\n` (F1); `true` at
   * `offset <= 0`. The log is append-only, so the answer is immutable.
   */
  prevByteIsNewline: (offset: number) => boolean;
  /** Installs v2 through the installer (`--no-promote`); the exit code. */
  installSecond: () => Promise<number>;
  /** Reads the root key from the 0600 file the run wrote. */
  rootKey: () => string;
  sleepMs: (ms: number) => Promise<void>;
  /** The clock (F2's promote timing); defaults to `Date.now`. */
  nowMs?: () => number;
  /** Proof 8 deadline; defaults to 15 s. */
  deadlineMs?: number;
  /** Proof 8 poll pause; defaults to 500 ms. */
  pollMs?: number;
  /** Proof 10: how long to wait for the v1 dispatch; defaults to 15 s (F2). */
  promoteSyncDeadlineMs?: number;
  /** Proof 10 poll pause; defaults to 100 ms (F2). */
  promoteSyncPollMs?: number;
  /** The promote must answer within this of the seen line; defaults to 1000 ms (F2). */
  promoteSyncMaxMs?: number;
  /** F1: how long a line straddling a window end gets to finish; defaults to 2 s. */
  windowEndWaitMs?: number;
  /** F1: the poll pause while waiting for it to finish; defaults to 100 ms. */
  windowEndPollMs?: number;
}

export interface ProofOutcome {
  allOk: boolean;
  lines: string[];
}

/**
 * The text of a 9/10 window opened at `startOffset` (F1). The end offset E
 * is the size at the close of the window; a line enters the window when it
 * began within it and begins before E. Everything is bounded in bytes
 * (the offsets are `statSync().size`): the head drop, the cut at E and the
 * straddling line's `0x0a` are found in the bytes, and only the bounded
 * span is decoded as UTF-8. A line straddling E gets `windowEndWaitMs` of
 * polls to finish, and then it enters. The deadline is revalidated after
 * every wait, before a terminator is accepted. A line that begins at or
 * after E never enters. `null` when the straddling line does not finish in
 * time — the caller FAILs the window with `incomplete log line at window
 * end`.
 */
async function readWindowText(
  deps: PlatformProofDeps,
  startOffset: number,
): Promise<string | null> {
  const nowMs = deps.nowMs ?? Date.now;
  const endOffset = deps.logSize();
  const windowLen = endOffset - startOffset;
  const prevNewline = deps.prevByteIsNewline(startOffset);
  const dropHead = (raw: Uint8Array): Uint8Array =>
    dropPartialHead(raw, prevNewline);
  const initial = dropHead(deps.logTail(startOffset).subarray(0, windowLen));
  if (initial.length > 0 && initial[initial.length - 1] === 0x0a) return decodeUtf8(initial);
  // The last line began before E and had not finished by E: poll until it
  // does (it then enters) or give up. A line starting at or after E is cut
  // off at the straddling line's own terminator, found in the bytes.
  const deadline = nowMs() + (deps.windowEndWaitMs ?? WINDOW_END_WAIT_MS);
  const pollMs = deps.windowEndPollMs ?? WINDOW_END_POLL_MS;
  for (;;) {
    if (nowMs() >= deadline) return null;
    await deps.sleepMs(pollMs);
    // Revalidate the deadline before accepting a terminator: a line that
    // only finished after the wait is still too late.
    if (nowMs() >= deadline) return null;
    const fresh = deps.logTail(startOffset);
    const dropped = dropHead(fresh);
    const endRel = windowLen - (fresh.length - dropped.length);
    if (endRel <= 0) return "";
    const newline = indexOfNewline(dropped, endRel);
    if (newline !== -1) return decodeUtf8(dropped.subarray(0, newline + 1));
  }
}

/**
 * The seven platform proof lines, in order:
 * 6a/6b the name-based routes must answer exactly 404 (EDG-27);
 * 7 the host health check (the current one);
 * 8 a cron dispatch to the promoted v1 within 15 s (EDG-26), counting
 *   only complete lines and dropping a read's partial head (F1);
 * 9 the window after staging v2: only v1, between 3 and 6, none to v2;
 *   the window is [start, E) and a line straddling E gets 2 s to finish
 *   (F1);
 * 10 the promote synchronized to the scheduler tick (F2): a new complete
 *   2xx v1 dispatch must appear first (100 ms polls, 15 s), the promote
 *   must answer within 1.000 ms of it, and the window after the settle
 *   holds only v2, between 3 and 6, none to v1;
 * 7 the host health check again, after the v2 promote. Every line is
 * `ok <desc>` or `FAIL <desc>: <detail>`; the run never stops early, and
 * `allOk` is true only when every line passed.
 */
export async function runPlatformProofs(deps: PlatformProofDeps): Promise<ProofOutcome> {
  const lines: string[] = [];
  const hostHeader = `127.0.0.1:${deps.port}`;
  const get = (path: string, host: string, extra: Record<string, string> = {}) =>
    deps.fetch(`http://127.0.0.1:${deps.port}${path}`, {
      headers: { Host: host, ...extra },
      method: "GET",
    });

  // 6. A worker with hosts must not answer its name-based routes (EDG-27):
  // both the bare name and the pinned version answer the 404 of an
  // unknown worker. Exactly 404: any other status is a FAIL.
  const nameRoutes: Array<[string, string]> = [
    ["/pinar-stg/api/health", "/pinar-stg/api/health"],
    [`/pinar-stg@${deps.version}/api/health`, `/pinar-stg@${deps.version}/api/health`],
  ];
  for (const [path, route] of nameRoutes) {
    const desc = `GET ${route} (Host: ${hostHeader}) → 404`;
    let detail: string;
    try {
      const response = await get(path, hostHeader);
      detail = response.status === 404 ? "" : `status ${response.status}`;
    } catch (error) {
      detail = error instanceof Error ? error.message : "request failed";
    }
    if (detail === "") lines.push(`ok ${desc}`);
    else lines.push(`FAIL ${desc}: ${detail}`);
  }

  // 7. The host health check (the current one) still answers.
  const healthDesc = `GET /api/health (Host: ${STAGING_HOST}) → 200, service pinar, hasDb`;
  const healthDetail = await healthCheck(() => get("/api/health", STAGING_HOST));
  if (healthDetail === null) lines.push(`ok ${healthDesc}`);
  else lines.push(`FAIL ${healthDesc}: ${healthDetail}`);

  // 8. The cron dispatches to the promoted v1 within 15 s (EDG-26).
  // Poll the log from before the v1 install until a v1 dispatch appears;
  // a non-2xx v1 dispatch fails at once with its status. F1: only complete
  // lines count, the read is bounded in bytes and a read that starts
  // mid-line drops the tail of the line before it. The deadline is
  // revalidated after every wait: a line seen only after the 15 s is a FAIL.
  const cron8Desc = `cron dispatch to ${STAGING_WORKER}@${deps.version} within 15 s`;
  const nowMs = deps.nowMs ?? Date.now;
  const deadline = nowMs() + (deps.deadlineMs ?? CRON_PRESENCE_MS);
  const pollMs = deps.pollMs ?? CRON_PRESENCE_POLL_MS;
  let cron8: string | null = null;
  for (;;) {
    if (nowMs() >= deadline) {
      cron8 = `FAIL ${cron8Desc}: no "cron dispatched" line for ${STAGING_WORKER} in 15 s`;
      break;
    }
    const read = deps.logTail(deps.firstInstallOffset);
    const dispatches = parseCronDispatches(
      decodeUtf8(dropPartialHead(read, deps.prevByteIsNewline(deps.firstInstallOffset))),
      STAGING_WORKER,
    ).filter((dispatch) => dispatch.version === deps.version);
    if (dispatches.length > 0) {
      const first = dispatches[0];
      cron8 =
        first.status >= 200 && first.status < 300
          ? `ok ${cron8Desc}`
          : `FAIL ${cron8Desc}: dispatch ${first.version} returned ${first.status}`;
      break;
    }
    await deps.sleepMs(pollMs);
  }
  if (cron8 !== null) lines.push(cron8);

  // 9. The staged v2 receives no cron: after the settle the 10 s window
  // holds 3–6 dispatches, all to v1, none to v2. F1: the window is the
  // [start, E) line boundary; a line straddling E gets 2 s to finish.
  const cron9Desc = `cron window after staging ${deps.version2}: 3–6 dispatches to ${STAGING_WORKER}@${deps.version}, none to ${deps.version2}`;
  const installCode = await deps.installSecond();
  if (installCode !== 0) {
    lines.push(`FAIL ${cron9Desc}: install ${deps.version2} exited ${installCode}`);
  } else {
    await deps.sleepMs(CRON_SETTLE_MS);
    const windowStart = deps.logSize();
    await deps.sleepMs(CRON_WINDOW_MS);
    const window = await readWindowText(deps, windowStart);
    if (window === null) {
      lines.push(`FAIL ${cron9Desc}: incomplete log line at window end`);
    } else {
      lines.push(
        evaluateCronWindow(parseCronDispatches(window, STAGING_WORKER), {
          desc: cron9Desc,
          expected: deps.version,
          forbidden: deps.version2,
          min: 3,
          max: 6,
          worker: STAGING_WORKER,
          window: "the 10 s window",
        }),
      );
    }
  }
  // F2: everything before here already belongs to proof 9 (or earlier);
  // the v1 dispatch that synchronizes the promote must appear after it.
  const syncBase = deps.logSize();

  // 10. F2: the promote is synchronized to the scheduler tick. The rc.18
  // scheduler awaits each dispatch before sleeping the next `@every`
  // interval (`crates/edger-orchestrator/src/cron.rs`, `run_job`), so a v1
  // line just seen means no v1 dispatch is in flight: wait (100 ms polls,
  // 15 s) for a new complete 2xx v1 dispatch, promote right after it, and
  // the promote must answer within PROMOTE_SYNC_MAX_MS — half of the 2 s
  // interval — or an in-flight v1 dispatch may still conclude inside the
  // window below. Any v1 dispatch in the window still fails it: an EdgeR
  // dispatching to both versions must fail.
  const cron10Desc = `cron window after promoting ${deps.version2}: 3–6 dispatches to ${STAGING_WORKER}@${deps.version2}, none to ${deps.version}`;
  const syncDeadline = nowMs() + (deps.promoteSyncDeadlineMs ?? PROMOTE_SYNC_DEADLINE_MS);
  const syncPollMs = deps.promoteSyncPollMs ?? PROMOTE_SYNC_POLL_MS;
  let syncSeenAt: number | null = null;
  for (;;) {
    // Revalidated after every wait: a v1 line seen only after the 15 s is a
    // FAIL, not a synchronization point.
    if (nowMs() >= syncDeadline) break;
    const read = deps.logTail(syncBase);
    const v1 = parseCronDispatches(
      decodeUtf8(dropPartialHead(read, deps.prevByteIsNewline(syncBase))),
      STAGING_WORKER,
    ).find(
      (dispatch) =>
        dispatch.version === deps.version && dispatch.status >= 200 && dispatch.status < 300,
    );
    if (v1 !== undefined) {
      syncSeenAt = nowMs();
      break;
    }
    await deps.sleepMs(syncPollMs);
  }
  if (syncSeenAt === null) {
    lines.push(`FAIL ${cron10Desc}: no v1 dispatch to synchronize the promote`);
  } else {
    let promoteDetail: string | null = null;
    try {
      const response = await deps.fetch(
        `http://127.0.0.1:${deps.port}/api/admin/workers/${STAGING_WORKER}/promote?version=${encodeURIComponent(deps.version2)}`,
        {
          headers: { authorization: `Bearer ${deps.rootKey()}` },
          method: "POST",
        },
      );
      promoteDetail =
        response.status >= 200 && response.status < 300 ? null : `status ${response.status}`;
    } catch (error) {
      promoteDetail = error instanceof Error ? error.message : "request failed";
    }
    const promoteMs = nowMs() - syncSeenAt;
    if (promoteMs > (deps.promoteSyncMaxMs ?? PROMOTE_SYNC_MAX_MS)) {
      lines.push(
        `FAIL ${cron10Desc}: promote took ${promoteMs} ms after the v1 dispatch; the window may hold an in-flight v1 dispatch`,
      );
    } else if (promoteDetail !== null) {
      lines.push(`FAIL ${cron10Desc}: promote ${deps.version2}: ${promoteDetail}`);
    } else {
      await deps.sleepMs(CRON_SETTLE_MS);
      const windowStart = deps.logSize();
      await deps.sleepMs(CRON_WINDOW_MS);
      const window = await readWindowText(deps, windowStart);
      if (window === null) {
        lines.push(`FAIL ${cron10Desc}: incomplete log line at window end`);
      } else {
        lines.push(
          evaluateCronWindow(parseCronDispatches(window, STAGING_WORKER), {
            desc: cron10Desc,
            expected: deps.version2,
            forbidden: deps.version,
            min: 3,
            max: 6,
            worker: STAGING_WORKER,
            window: "the 10 s window",
          }),
        );
      }
    }
  }

  // 7 (again). The host health check after the v2 promote.
  const finalHealthDetail = await healthCheck(() => get("/api/health", STAGING_HOST));
  if (finalHealthDetail === null) lines.push(`ok ${healthDesc}`);
  else lines.push(`FAIL ${healthDesc}: ${finalHealthDetail}`);

  return { allOk: lines.every((line) => line.startsWith("ok ")), lines };
}
