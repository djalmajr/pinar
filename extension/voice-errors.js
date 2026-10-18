// Classic content script injected right before content.js (see
// INJECTED_CONTENT_SCRIPTS in background.js). The mapping is a pure function
// of the voice:transcribe error response, so voice-errors.test.js can evaluate
// this file in a node vm context without a browser.
(() => {
  // F5/S4b: the Cloud's BYOK failure is classified by cause — the user's own
  // AI endpoint failed and Pinar Cloud never is blamed. The groups follow the
  // cause table the Cloud shares with the S4 settings UI.
  const BYOK_KEY_CAUSES = new Set(["key_rejected", "scope_denied"]);
  const BYOK_MODEL_CAUSES = new Set(["model_not_found", "service_disabled", "model_not_configured"]);
  const BYOK_ENDPOINT_CAUSES = new Set(["timeout", "unavailable", "endpoint_unreachable", "endpoint_blocked", "egress_unavailable"]);

  function byokVoiceKey(cause, retryAfterSeconds) {
    if (BYOK_KEY_CAUSES.has(cause)) return "overlay_voice_byok_key";
    if (BYOK_MODEL_CAUSES.has(cause)) return "overlay_voice_byok_model";
    if (cause === "rate_limited") {
      return Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? "overlay_voice_byok_rate_wait"
        : "overlay_voice_byok_rate";
    }
    if (BYOK_ENDPOINT_CAUSES.has(cause)) return "overlay_voice_byok_endpoint";
    if (cause === "invalid_response") return "overlay_voice_byok_invalid";
    return "overlay_voice_byok_generic";
  }

  // A local-mode provider error names the real problem and points to Pinar
  // Settings → AI; nothing in local mode may read as a Pinar Cloud issue.
  function voiceErrorKey(response) {
    if (response?.storageMode === "local") {
      switch (response?.code) {
        case "ai_scope_denied":
          return "overlay_voice_local_scope";
        case "ai_auth_failed":
          return "overlay_voice_local_auth";
        case "ai_model_unavailable":
          return "overlay_voice_local_model";
        case "ai_endpoint_unavailable":
        case "ai_timeout":
        case "ai_unavailable":
          return "overlay_voice_local_endpoint";
      }
      // A local 401/403 is a provider or capability problem, not a Cloud
      // account one, so it falls through to the generic failure message.
      if (response?.status === 401 || response?.status === 403) return "overlay_voice_failed";
    }
    // The BYOK failure is decided by its cause, not by the 429/502 status:
    // it never reads as a local-mode problem or an old-Cloud message.
    if (response?.code === "byok_error") return byokVoiceKey(response?.cause, Number(response?.retryAfter));
    if (response?.status === 401 || response?.status === 403) return "overlay_voice_auth";
    if (response?.status === 402 || response?.code === "insufficient_ai_credits") return "overlay_voice_credits";
    if (response?.code === "invalid_audio" || response?.code === "invalid_audio_duration" || response?.code === "unsupported_audio") {
      return "overlay_voice_invalid";
    }
    if (response?.code === "ai_inference_failed") return "overlay_voice_refunded";
    if (response?.code === "network_error") return "overlay_voice_network";
    return "overlay_voice_failed";
  }

  globalThis.__pinarVoiceErrors = {
    voiceErrorKey,
  };
})();
