// F5/S1: the BYOK egress interface (F5 contract §1, decision A55).
//
// A55: the egress to the user's endpoint goes only through the EdgeR egress
// guard (EDG-38). That guard does not exist yet; S6 wires it up when it
// ships, and the EdgeR signals its presence by injecting EDGER_EGRESS_SOCKET
// into the worker — there is no CloudEnv variable for it. Until then,
// byokFetch ALWAYS refuses, with a ByokEgressUnavailableError: there is no
// fallback to a plain fetch, and nothing in S1 may reach the user's
// endpoint. The refusal is silent about the input (never the URL), so it can
// be surfaced or logged without leaking the endpoint. The rest of the Cloud
// is not affected.
//
// What S6 will use (EDG-38 §2): the per-worker Unix socket the EdgeR
// injects as EDGER_EGRESS_SOCKET, reached with a normal fetch through
// Deno.createHttpClient({ proxy: { transport: "unix", path: ... } }); the
// host of that call is the injected EDGER_EGRESS_HOST
// (edger-egress.invalid, a name that never resolves); and the real
// destination goes in the x-edger-egress-url header, which the guard
// replaces with the destination's Host. Without the socket the refusal
// stands.
//
// This function is the injectable egress of the BYOK layer: S2's capability
// tests and S3's routing receive it (or a fake in the tests) through the
// same ByokEgress signature (byokEgressFor below).

import type { CloudEnv } from "../cloud-api";

/** The BYOK egress is unavailable: the EdgeR guard does not exist yet (A55, S6). */
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
// until S6). S2's test route (byok/api.ts) and S3's routing (byok/route.ts)
// share the same injection, so one fake answers both.
let byokEgressForTests: ByokEgress | null = null;

export function setByokEgressForTests(egress: ByokEgress | null) {
  byokEgressForTests = egress;
}

export function byokEgressFor(env: CloudEnv): ByokEgress {
  return byokEgressForTests ?? ((url, init) => byokFetch(env, url, init));
}

/**
 * The S1 egress: it always refuses, until S6 routes the call through the
 * EdgeR guard (the EDGER_EGRESS_SOCKET Unix socket, the EDGER_EGRESS_HOST
 * host and the x-edger-egress-url header of EDG-38 §2). Nothing switches it
 * on: the refusal must stand until S6 replaces this function.
 */
export function byokFetch(env: CloudEnv, url: string, init?: RequestInit): Promise<Response> {
  void env;
  void url;
  void init;
  return Promise.reject(new ByokEgressUnavailableError());
}
