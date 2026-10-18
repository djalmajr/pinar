// F5/S1: the BYOK egress interface (F5 contract §1, decision A55).
//
// A55: the egress to the user's endpoint goes only through the EdgeR egress
// guard (EDG-38). The EdgeR signals the guard by injecting it into the
// worker's env: the per-worker Unix socket (EDGER_EGRESS_SOCKET) and the
// fake host (EDGER_EGRESS_HOST, a name that never resolves), which
// edgerCloudEnv turns into the optional BYOK_EGRESS field of the CloudEnv
// (the fetch bound to the client created once for the socket). With the
// field, byokFetch calls http://<host>/ through it, with the destination in
// the x-edger-egress-url header (EDG-38 §2). Without it — the production of
// today, until the EdgeR ships the guard — byokFetch refuses, with a
// ByokEgressUnavailableError: there is no fallback to a plain fetch, not on
// error, and nothing in this layer may reach the user's endpoint. The
// refusal and the errors stay silent about the input (never the URL, the
// key or the socket path), so they can be surfaced or logged without
// leaking. The guard's answer (or the destination's, past the guard) is
// returned untouched, streaming as it came.
//
// This function is the injectable egress of the BYOK layer: S2's capability
// tests and S3's routing receive it (or a fake in the tests) through the
// same ByokEgress signature (byokEgressFor below).

import type { CloudEnv } from "../cloud-api";

/** The BYOK egress is unavailable: the EdgeR has not injected the guard (A55, EDG-38). */
export class ByokEgressUnavailableError extends Error {
  constructor() {
    super("byok egress is unavailable until the EdgeR guard exists");
    this.name = "ByokEgressUnavailableError";
  }
}

/** The BYOK layer's egress: the signature S2's tests inject a fake into. */
export type ByokEgress = (url: string, init?: RequestInit) => Promise<Response>;

// The egress the BYOK layer actually calls: the injected fake in the tests
// (setByokEgressForTests, S2), or byokFetch bound to the env (the refusal
// while the EdgeR has not injected the guard). S2's test route
// (byok/api.ts) and S3's routing (byok/route.ts) share the same injection,
// so one fake answers both.
let byokEgressForTests: ByokEgress | null = null;

export function setByokEgressForTests(egress: ByokEgress | null) {
  byokEgressForTests = egress;
}

export function byokEgressFor(env: CloudEnv): ByokEgress {
  return byokEgressForTests ?? ((url, init) => byokFetch(env, url, init));
}

/**
 * The BYOK egress (F5/S6a, EDG-38 §2): with the guard the EdgeR injected
 * (env.BYOK_EGRESS), the call goes to http://<host>/ through the field's
 * fetch, already bound to the guard's client — the method, the headers
 * (Authorization included) and the body ride the init, and the destination
 * is set in x-edger-egress-url, replacing any value the caller sent. The
 * answer comes back untouched, streaming as it came. Without the field the
 * refusal stands. There is no path to a direct fetch of the destination,
 * not on error, and the refusal names no URL, key or socket.
 */
export function byokFetch(env: CloudEnv, url: string, init?: RequestInit): Promise<Response> {
  const guard = env.BYOK_EGRESS;
  if (guard === undefined) {
    return Promise.reject(new ByokEgressUnavailableError());
  }
  const headers = new Headers(init?.headers);
  headers.set("x-edger-egress-url", url);
  return guard.fetch(`http://${guard.host}/`, {
    ...init,
    headers,
  });
}
