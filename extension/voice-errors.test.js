import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./voice-errors.js", import.meta.url)), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const { voiceErrorKey } = context.__pinarVoiceErrors;

const local = (extra) => ({ ok: false, storageMode: "local", ...extra });
const cloud = (extra) => ({ ok: false, storageMode: "cloud", ...extra });

describe("voice error message mapping", () => {
  test("maps every local provider code group to the message that points at Pinar Settings → AI", () => {
    assert.equal(voiceErrorKey(local({ code: "ai_scope_denied", status: 502 })), "overlay_voice_local_scope");
    assert.equal(voiceErrorKey(local({ code: "ai_auth_failed", status: 502 })), "overlay_voice_local_auth");
    assert.equal(voiceErrorKey(local({ code: "ai_model_unavailable", status: 502 })), "overlay_voice_local_model");
    assert.equal(voiceErrorKey(local({ code: "ai_endpoint_unavailable", status: 502 })), "overlay_voice_local_endpoint");
    assert.equal(voiceErrorKey(local({ code: "ai_timeout", status: 502 })), "overlay_voice_local_endpoint");
    assert.equal(voiceErrorKey(local({ code: "ai_unavailable", status: 502 })), "overlay_voice_local_endpoint");
  });

  test("never reads a local 401/403 as a Pinar Cloud account problem", () => {
    assert.equal(voiceErrorKey(local({ status: 401 })), "overlay_voice_failed");
    assert.equal(voiceErrorKey(local({ status: 403 })), "overlay_voice_failed");
    assert.equal(voiceErrorKey(local({ status: 401, code: "capability_denied" })), "overlay_voice_failed");
    // A local provider code still wins over the status, even on 401/403.
    assert.equal(voiceErrorKey(local({ code: "ai_scope_denied", status: 403 })), "overlay_voice_local_scope");
  });

  test("keeps the remaining rules in local mode", () => {
    assert.equal(voiceErrorKey(local({ code: "invalid_audio", status: 422 })), "overlay_voice_invalid");
    assert.equal(voiceErrorKey(local({ code: "unsupported_audio", status: 422 })), "overlay_voice_invalid");
    assert.equal(voiceErrorKey(local({ code: "invalid_audio_duration", status: 422 })), "overlay_voice_invalid");
    assert.equal(voiceErrorKey(local({ code: "network_error", status: 0 })), "overlay_voice_network");
    assert.equal(voiceErrorKey(local({ status: 402 })), "overlay_voice_credits");
    assert.equal(voiceErrorKey(local({ code: "ai_inference_failed", status: 502 })), "overlay_voice_refunded");
    assert.equal(voiceErrorKey(local({ code: "voice_transcription_failed", status: 500 })), "overlay_voice_failed");
  });

  test("leaves cloud mode untouched", () => {
    assert.equal(voiceErrorKey(cloud({ status: 401 })), "overlay_voice_auth");
    assert.equal(voiceErrorKey(cloud({ status: 403 })), "overlay_voice_auth");
    assert.equal(voiceErrorKey(cloud({ status: 402 })), "overlay_voice_credits");
    assert.equal(voiceErrorKey(cloud({ code: "insufficient_ai_credits", status: 200 })), "overlay_voice_credits");
    assert.equal(voiceErrorKey(cloud({ code: "invalid_audio", status: 422 })), "overlay_voice_invalid");
    assert.equal(voiceErrorKey(cloud({ code: "network_error", status: 0 })), "overlay_voice_network");
    assert.equal(voiceErrorKey(cloud({ code: "ai_inference_failed", status: 502 })), "overlay_voice_refunded");
    assert.equal(voiceErrorKey(cloud({ code: "ai_scope_denied", status: 502 })), "overlay_voice_failed");
  });

  test("treats a response without storageMode like the old cloud behaviour", () => {
    assert.equal(voiceErrorKey({ code: "network_error" }), "overlay_voice_network");
    assert.equal(voiceErrorKey({ status: 401 }), "overlay_voice_auth");
    assert.equal(voiceErrorKey({}), "overlay_voice_failed");
    assert.equal(voiceErrorKey(undefined), "overlay_voice_failed");
    assert.equal(voiceErrorKey(null), "overlay_voice_failed");
  });
});

describe("BYOK failure mapping (F5/S4b)", () => {
  const byok = (extra) => ({ code: "byok_error", ok: false, ...extra });

  test("groups the BYOK causes the Cloud classifies", () => {
    // the key
    assert.equal(voiceErrorKey(byok({ cause: "key_rejected", status: 502 })), "overlay_voice_byok_key");
    assert.equal(voiceErrorKey(byok({ cause: "scope_denied", status: 502 })), "overlay_voice_byok_key");
    // the model
    assert.equal(voiceErrorKey(byok({ cause: "model_not_found", status: 502 })), "overlay_voice_byok_model");
    assert.equal(voiceErrorKey(byok({ cause: "service_disabled", status: 502 })), "overlay_voice_byok_model");
    assert.equal(voiceErrorKey(byok({ cause: "model_not_configured", status: 502 })), "overlay_voice_byok_model");
    // the limit
    assert.equal(voiceErrorKey(byok({ cause: "rate_limited", status: 429 })), "overlay_voice_byok_rate");
    // the endpoint
    assert.equal(voiceErrorKey(byok({ cause: "timeout", status: 502 })), "overlay_voice_byok_endpoint");
    assert.equal(voiceErrorKey(byok({ cause: "unavailable", status: 502 })), "overlay_voice_byok_endpoint");
    assert.equal(voiceErrorKey(byok({ cause: "endpoint_unreachable", status: 502 })), "overlay_voice_byok_endpoint");
    assert.equal(voiceErrorKey(byok({ cause: "endpoint_blocked", status: 502 })), "overlay_voice_byok_endpoint");
    assert.equal(voiceErrorKey(byok({ cause: "egress_unavailable", status: 502 })), "overlay_voice_byok_endpoint");
    // the invalid answer
    assert.equal(voiceErrorKey(byok({ cause: "invalid_response", status: 502 })), "overlay_voice_byok_invalid");
  });

  test("falls back to the generic BYOK message for an unknown cause", () => {
    assert.equal(voiceErrorKey(byok({ cause: "provider_explosion", status: 502 })), "overlay_voice_byok_generic");
    assert.equal(voiceErrorKey(byok({ status: 502 })), "overlay_voice_byok_generic");
    assert.equal(voiceErrorKey(byok({ cause: null, status: 502 })), "overlay_voice_byok_generic");
    assert.equal(voiceErrorKey(byok({ cause: undefined, status: 429 })), "overlay_voice_byok_generic");
  });

  test("carries the retryAfter only when the limit answer has one", () => {
    assert.equal(voiceErrorKey(byok({ cause: "rate_limited", status: 429, retryAfter: 30 })), "overlay_voice_byok_rate_wait");
    assert.equal(voiceErrorKey(byok({ cause: "rate_limited", status: 429, retryAfter: 1 })), "overlay_voice_byok_rate_wait");
    assert.equal(voiceErrorKey(byok({ cause: "rate_limited", status: 429, retryAfter: 0 })), "overlay_voice_byok_rate");
    assert.equal(voiceErrorKey(byok({ cause: "rate_limited", status: 429, retryAfter: -5 })), "overlay_voice_byok_rate");
    assert.equal(voiceErrorKey(byok({ cause: "rate_limited", status: 429, retryAfter: "soon" })), "overlay_voice_byok_rate");
    assert.equal(voiceErrorKey(byok({ cause: "rate_limited", status: 429, retryAfter: null })), "overlay_voice_byok_rate");
    assert.equal(voiceErrorKey(byok({ cause: "rate_limited", status: 429, retryAfter: Number.NaN })), "overlay_voice_byok_rate");
  });

  test("never reads a BYOK failure as a local-mode or an old-Cloud problem", () => {
    const forbidden = new Set([
      "overlay_voice_local_scope",
      "overlay_voice_local_auth",
      "overlay_voice_local_model",
      "overlay_voice_local_endpoint",
      "overlay_voice_auth",
      "overlay_voice_credits",
      "overlay_voice_failed",
      "overlay_voice_network",
      "overlay_voice_refunded",
      "overlay_voice_invalid",
    ]);
    const causes = [
      "key_rejected", "scope_denied",
      "model_not_found", "service_disabled", "model_not_configured",
      "rate_limited",
      "timeout", "unavailable", "endpoint_unreachable", "endpoint_blocked", "egress_unavailable",
      "invalid_response",
      "unknown_future_cause",
      undefined,
    ];
    for (const cause of causes) {
      const key = voiceErrorKey(byok({ cause, status: 502 }));
      assert.ok(key.startsWith("overlay_voice_byok_"), `cause ${String(cause)}`);
      assert.ok(!forbidden.has(key), `cause ${String(cause)}`);
    }
    // even a local storageMode never turns the BYOK failure into a local key
    assert.equal(voiceErrorKey(local({ code: "byok_error", cause: "key_rejected", status: 502 })), "overlay_voice_byok_key");
    // and the 429/502 statuses alone never beat the cause mapping
    assert.match(voiceErrorKey(byok({ cause: "rate_limited", status: 429, retryAfter: 30 })), /^overlay_voice_byok_/);
    assert.match(voiceErrorKey(byok({ cause: "rate_limited", status: 429 })), /^overlay_voice_byok_/);
  });
});

describe("voice error mapping wiring", () => {
  test("the content injection list loads voice-errors.js right before content.js", async () => {
    const { CONTENT_INJECTION_FILES } = await import("./session.js");
    const contentIndex = CONTENT_INJECTION_FILES.indexOf("content.js");
    assert.equal(CONTENT_INJECTION_FILES[contentIndex - 1], "voice-errors.js");
  });

  test("content.js selects the message through the injected mapping", () => {
    const contentSource = readFileSync(fileURLToPath(new URL("./content.js", import.meta.url)), "utf8");
    assert.match(contentSource, /const \{ voiceErrorKey \} = globalThis\.__pinarVoiceErrors;/);
    assert.match(contentSource, /return t\(voiceErrorKey\(response\)\);/);
    // F5/S4b: the rate-limited BYOK message carries the endpoint's
    // Retry-After in seconds (the mapping picks the _wait key only then).
    assert.match(contentSource, /voiceErrorKey\(response\) === "overlay_voice_byok_rate_wait"\) return formatVoiceByokRate\(response\)/);
    assert.match(contentSource, /t\("overlay_voice_byok_rate_wait"\)[\s\S]*?\.replace\("\{seconds\}", String\(Math\.max\(1, Math\.round\(Number\(response\?\.retryAfter\) \|\| 0\)\)\)\)/);
  });

  test("the overlay offers the credits action only when the failure allows credits", () => {
    const contentSource = readFileSync(fileURLToPath(new URL("./content.js", import.meta.url)), "utf8");
    // The action is rendered hidden and is toggled from the stored failure.
    assert.match(contentSource, /class="voice-credit-retry" data-ref="voiceCreditRetry" hidden/);
    assert.match(contentSource, /ui\.voiceCreditRetry\.hidden = !\(pendingCreditRetry && !active && state\.draft\)/);
    // The stored failure keeps the same recording only when canUseCredits.
    assert.match(contentSource, /pendingCreditRetry = error\?\.canUseCredits === true\s*\? \{ audioDataUrl, durationSeconds \}\s*:\s*null/);
    // And the retry resends that payload with useCredits.
    assert.match(contentSource, /audioDataUrl: retry\.audioDataUrl/);
    assert.match(contentSource, /durationSeconds: retry\.durationSeconds/);
    assert.match(contentSource, /useCredits: true/);
    // Any other failure path (and a discarded recording) clears it.
    assert.match(contentSource, /pendingCreditRetry = null;/);
  });
});
