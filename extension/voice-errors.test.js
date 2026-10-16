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
  });
});
