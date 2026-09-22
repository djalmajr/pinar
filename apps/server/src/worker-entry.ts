import {
  cleanupOldRecords,
  reconcileBillingEntitlements,
  refundStaleAiReservations,
  sendStorageExpiryNotices,
  type CloudEnv,
} from "./server/cloud-api";
import { FREE_CLOUD_RETENTION_DAYS } from "./lib/retention";

type TanstackFetch = typeof import("./tanstack-server-entry")["default"]["fetch"];

let cachedTanstackFetch: TanstackFetch | null = null;

async function getTanstackFetch(): Promise<TanstackFetch> {
  if (cachedTanstackFetch) return cachedTanstackFetch;
  const { default: entry } = await import("./tanstack-server-entry");
  cachedTanstackFetch = entry.fetch;
  return cachedTanstackFetch;
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    cachedTanstackFetch = null;
  });
}

export default {
  async fetch(request: Request) {
    const fetch = await getTanstackFetch();
    return fetch(request);
  },
  async scheduled(_controller: ScheduledController, env: CloudEnv, context: ExecutionContext) {
    context.waitUntil(Promise.all([
      cleanupOldRecords(env, FREE_CLOUD_RETENTION_DAYS),
      reconcileBillingEntitlements(env),
      refundStaleAiReservations(env),
      sendStorageExpiryNotices(env),
    ]));
  },
};
