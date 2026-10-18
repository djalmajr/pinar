import type { ServerMessageKey } from "@/lib/i18n";
import { pinarRuntime, type PinarRuntime } from "@/lib/server-header";

export type AiRecovery = "byok" | "pricing" | "retry" | "settings" | "signIn" | null;

interface AiErrorPresentation {
  messageKey: ServerMessageKey;
  recovery: AiRecovery;
}

const LOCAL_CONFIGURATION_ERRORS = new Set([
  "ai_auth_failed",
  "ai_disabled",
  "ai_endpoint_unavailable",
  "ai_model_unavailable",
  "ai_scope_denied",
  "ai_unavailable",
]);

// The 12 causes of the common BYOK table (F5 contract §1 and §4;
// byok/cause.ts). One i18n key per cause (byok.cause.<cause>), shared by the
// settings subpanel, the assistant's error note and the reproduction.
export const BYOK_CAUSE_CODES = [
  "egress_unavailable",
  "endpoint_blocked",
  "endpoint_unreachable",
  "invalid_response",
  "key_rejected",
  "model_not_configured",
  "model_not_found",
  "rate_limited",
  "scope_denied",
  "service_disabled",
  "timeout",
  "unavailable",
] as const;

/**
 * The i18n key of a BYOK cause: one text per cause; a missing or unknown
 * cause falls back to the generic BYOK failure note (a stored thread keeps
 * only the byok_error code, never the cause — F5/S3).
 */
export function byokCauseMessageKey(cause: string | null | undefined): ServerMessageKey {
  return typeof cause === "string" && (BYOK_CAUSE_CODES as readonly string[]).includes(cause)
    ? `byok.cause.${cause}` as ServerMessageKey
    : "byok.errorGeneric";
}

export function aiErrorPresentation(
  status: number,
  code: string,
  runtime: PinarRuntime = pinarRuntime(),
  cause?: string,
): AiErrorPresentation {
  if (runtime === "local") {
    if (LOCAL_CONFIGURATION_ERRORS.has(code)) {
      return { messageKey: "viewer.aiConfigure", recovery: "settings" };
    }
    if (code === "ai_rate_limited") {
      return { messageKey: "viewer.aiRateLimited", recovery: "retry" };
    }
    return { messageKey: "viewer.aiUnavailable", recovery: "retry" };
  }

  // F5/S3b: the BYOK failure (429 when the cause is rate_limited, 502 the
  // rest): the cause text and the "try again / use Pinar credits" actions;
  // no silent fallback to the gateway (D2).
  if (code === "byok_error") {
    return { messageKey: byokCauseMessageKey(cause), recovery: "byok" };
  }
  if (status === 401) return { messageKey: "viewer.aiSignIn", recovery: "signIn" };
  if (code === "ai_requires_paid" || code === "insufficient_ai_credits") {
    return { messageKey: "viewer.aiNoCredits", recovery: "pricing" };
  }
  if (code === "ai_rate_limited") {
    return { messageKey: "viewer.aiRateLimited", recovery: "retry" };
  }
  if (code === "ai_refund_pending") {
    return { messageKey: "viewer.aiRefundPending", recovery: "retry" };
  }
  return { messageKey: "viewer.aiUnavailable", recovery: "retry" };
}
