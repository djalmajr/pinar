import type { ServerMessageKey } from "@/lib/i18n";
import { pinarRuntime, type PinarRuntime } from "@/lib/server-header";

export type AiRecovery = "pricing" | "retry" | "settings" | "signIn" | null;

interface AiErrorPresentation {
  messageKey: ServerMessageKey;
  recovery: AiRecovery;
}

const LOCAL_CONFIGURATION_ERRORS = new Set([
  "ai_auth_failed",
  "ai_disabled",
  "ai_endpoint_unavailable",
  "ai_model_unavailable",
  "ai_unavailable",
]);

export function aiErrorPresentation(
  status: number,
  code: string,
  runtime: PinarRuntime = pinarRuntime(),
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
