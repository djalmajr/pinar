import {
  cleanupOldRecords,
  indexPinSearch,
  reconcileBillingEntitlements,
  refundStaleAiReservations,
  sendStorageExpiryNotices,
} from "./server/cloud-api";
import { getEdgerCloudEnv, readEnv } from "./server/api.edger";
import { FREE_CLOUD_RETENTION_DAYS } from "./lib/retention";
import { timingSafeEqual } from "node:crypto";

type TanstackFetch = typeof import("./tanstack-server-entry")["default"]["fetch"];

let cachedTanstackFetch: TanstackFetch | null = null;

async function getTanstackFetch(): Promise<TanstackFetch> {
  if (cachedTanstackFetch) return cachedTanstackFetch;
  const { default: entry } = await import("./tanstack-server-entry");
  cachedTanstackFetch = entry.fetch;
  return cachedTanstackFetch;
}

const CRON_PATH = "/_internal/cron/daily";
// Every 5 minutes: the AI credit sweeper only, so a turn orphaned by a
// process that died gives its credits back within minutes (F4 contract §2).
const FREQUENT_CRON_PATH = "/_internal/cron/frequent";
const INTERNAL_HEADER = "x-edger-internal";
const ORIGIN_AUTH_HEADER = "x-pinar-origin-auth";

/**
 * Origin defense for the EdgeR path (EDG-27). Cloudflare injects
 * `x-pinar-origin-auth` on every request it proxies (Transform Rule on the
 * pinar.dev zone: "Modify Request Header" → "Set static" →
 * `x-pinar-origin-auth` = <secret>). The EdgeR entry also reaches the app
 * by paths that do not pass the Cloudflare IP allowlist (for example the
 * hostname route edger.djalmajr.dev/pinar/...), where a forged
 * `cf-ipcountry: BR` would price in BRL and a forged `cf-connecting-ip`
 * would rate-limit a foreign IP. With the secret set, a request whose
 * `x-pinar-origin-auth` is missing or wrong may have come around the proxy,
 * so it goes on without that header and without any `cf-*` header: the app
 * sees country null (USD price) and IP unknown. With the secret empty —
 * the default until the Transform Rule exists — nothing changes.
 */
function originAuthMatches(secret: string, header: string | null): boolean {
  if (header === null) return false;
  const secretBytes = new TextEncoder().encode(secret);
  const headerBytes = new TextEncoder().encode(header);
  // Equal sizes are checked first: timingSafeEqual throws on different
  // lengths, and a size mismatch is already a non-match.
  if (secretBytes.length !== headerBytes.length) return false;
  return timingSafeEqual(secretBytes, headerBytes);
}

/** Rebuilds the request without `x-pinar-origin-auth`, dropping every `cf-*` header when `trusted` is false. */
function withoutUntrustedOriginHeaders(request: Request, trusted: boolean): Request {
  // Clone, then delete: `new Request(request, { headers })` with an empty
  // Headers keeps the original headers in Bun, while the clone keeps the
  // method, body stream and signal in both Bun and Deno.
  const forwarded = new Request(request);
  for (const name of [...forwarded.headers.keys()]) {
    if (name === ORIGIN_AUTH_HEADER || (!trusted && name.startsWith("cf-"))) {
      forwarded.headers.delete(name);
    }
  }
  return forwarded;
}

type CronJob = { name: string; run: () => Promise<unknown> };

/**
 * Server entry for EdgeR (a self-hosted Deno runtime). The Cloudflare cron
 * becomes an internal POST to `/_internal/cron/daily` (the daily jobs) or
 * `/_internal/cron/frequent` (the frequent ones) carrying
 * `x-edger-internal: true`, which the EdgeR runtime strips from external
 * traffic, so both routes require it. Everything else goes to the TanStack
 * handler.
 */
export function createEdgerFetch(deps: {
  tanstackFetch: (request: Request) => Promise<Response>;
  jobs: CronJob[];
  frequentJobs?: CronJob[];
  log?: (line: string) => void;
  originSecret?: string;
}) {
  const log = deps.log ?? ((line: string) => console.log(line));
  const cronJobs = new Map<string, CronJob[]>([
    [CRON_PATH, deps.jobs],
    [FREQUENT_CRON_PATH, deps.frequentJobs ?? []],
  ]);
  return async (request: Request): Promise<Response> => {
    const jobs = cronJobs.get(new URL(request.url).pathname);
    if (jobs) {
      if (request.method !== "POST" || request.headers.get(INTERNAL_HEADER) !== "true") {
        // Same 404 as any unknown path: the route must not reveal itself.
        return new Response("Not found", { status: 404 });
      }
      // A job that throws before returning its promise (resolving the env,
      // for example) must not stop the others from starting.
      const results = await Promise.allSettled(jobs.map((job) => Promise.resolve().then(() => job.run())));
      const report = jobs.map((job, index) => ({
        job: job.name,
        ok: results[index].status === "fulfilled",
      }));
      const ok = report.every((entry) => entry.ok);
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          log(JSON.stringify({ message: "cron_job", job: jobs[index].name, ok: true }));
        } else {
          log(JSON.stringify({ message: "cron_job", job: jobs[index].name, ok: false, error: errorMessage(result.reason) }));
        }
      });
      return Response.json({ ok, jobs: report }, { status: ok ? 200 : 500 });
    }
    const secret = deps.originSecret;
    if (secret) {
      // Empty (or absent) secret: the defense is off and the request passes
      // through untouched. The cron route above is never touched by this.
      const trusted = originAuthMatches(secret, request.headers.get(ORIGIN_AUTH_HEADER));
      request = withoutUntrustedOriginHeaders(request, trusted);
    }
    return deps.tanstackFetch(request);
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error && reason.message.length > 0 ? reason.message : String(reason);
}

export default {
  fetch: createEdgerFetch({
    tanstackFetch: async (request) => (await getTanstackFetch())(request),
    // Read through the same env reader as the rest of the EdgeR worker; an
    // empty value counts as absent (defense off until the rule exists).
    originSecret: readEnv("CLOUDFLARE_ORIGIN_SECRET") || undefined,
    jobs: [
      { name: "cleanupOldRecords", run: () => cleanupOldRecords(getEdgerCloudEnv(), FREE_CLOUD_RETENTION_DAYS) },
      { name: "reconcileBillingEntitlements", run: () => reconcileBillingEntitlements(getEdgerCloudEnv()) },
      { name: "refundStaleAiReservations", run: () => refundStaleAiReservations(getEdgerCloudEnv()) },
      { name: "sendStorageExpiryNotices", run: () => sendStorageExpiryNotices(getEdgerCloudEnv()) },
      { name: "indexPinSearch", run: () => indexPinSearch(getEdgerCloudEnv()) },
    ],
    frequentJobs: [
      { name: "refundStaleAiReservations", run: () => refundStaleAiReservations(getEdgerCloudEnv()) },
    ],
  }),
};
