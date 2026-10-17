// F5/S1: the BYOK egress interface (F5 contract §1, decision A55).
//
// A55: the egress to the user's endpoint goes only through the EdgeR egress
// guard — and that guard does not exist yet; S6 wires it up when the
// contract arrives, and the environment variable BYOK_EGRESS marks its
// presence. Until it does, byokFetch ALWAYS refuses, with a
// ByokEgressUnavailableError: there is no fallback to a plain fetch, and
// nothing in S1 may reach the user's endpoint. The refusal is silent about
// the input (never the URL), so it can be surfaced or logged without
// leaking the endpoint. The rest of the Cloud is not affected.
//
// This function is the injectable egress of the BYOK layer: S2's capability
// tests will receive it (or a fake in the tests) through the same
// ByokEgress signature.

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

/**
 * The S1 egress: it always refuses, with or without BYOK_EGRESS set. The
 * variable only marks that the guard will exist (S6); it is not the guard
 * itself, so the refusal must stand until S6 replaces this function.
 */
export function byokFetch(env: CloudEnv, url: string, init?: RequestInit): Promise<Response> {
  void env;
  void url;
  void init;
  return Promise.reject(new ByokEgressUnavailableError());
}
