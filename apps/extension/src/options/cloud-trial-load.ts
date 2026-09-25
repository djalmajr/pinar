import { normalizeCloudTrial, type CloudTrial } from "../../../../extension/cloud-trial.js";

export interface TrialLoadClock {
  id: number;
}

export function beginTrialLoad(clock: TrialLoadClock): number {
  clock.id += 1;
  return clock.id;
}

export type TrialLoadDecision =
  | { type: "ignore" }
  | { type: "clear" }
  | { type: "apply"; trial: CloudTrial | null };

export function decideTrialLoad(input: {
  activeId: number;
  failed?: boolean;
  requestId: number;
  responseMode?: string;
  responseOk?: boolean;
  sessionKind: string | null;
  storageMode: "local" | "cloud";
  trial?: unknown;
}): TrialLoadDecision {
  if (input.requestId !== input.activeId) return { type: "ignore" };
  if (input.failed || input.storageMode !== "cloud" || input.sessionKind !== "account") {
    return { type: "clear" };
  }
  if (input.responseOk !== true || input.responseMode !== "cloud") return { type: "clear" };
  return { type: "apply", trial: normalizeCloudTrial(input.trial) };
}

export function decideAuthLoad<T>(input: {
  activeId: number;
  ok: boolean;
  requestId: number;
  session: T | null;
}): { type: "ignore" } | { type: "set"; session: T | null } {
  if (input.requestId !== input.activeId) return { type: "ignore" };
  if (!input.ok) return { type: "set", session: null };
  return { type: "set", session: input.session };
}
