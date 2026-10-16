// Classic content script injected right before content.js (see
// INJECTED_CONTENT_SCRIPTS in background.js). The mapping is a pure function
// of the voice:transcribe error response, so voice-errors.test.js can evaluate
// this file in a node vm context without a browser.
(() => {
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
