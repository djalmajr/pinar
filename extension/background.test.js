import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const backgroundSource = readFileSync(fileURLToPath(new URL("./background.js", import.meta.url)), "utf8");
const transcribeFn = backgroundSource.slice(
  backgroundSource.indexOf("async function transcribeVoiceComment("),
  backgroundSource.indexOf("async function responseBody("),
);
const transcribeHandler = backgroundSource.slice(
  backgroundSource.indexOf('if (message.type === "voice:transcribe") {'),
  backgroundSource.indexOf('if (message.type === "review:preview") {'),
);

describe("voice:transcribe BYOK error handling (F5/S4b)", () => {
  test("keeps the BYOK cause, retryAfter and canUseCredits on the thrown error", () => {
    // The fields are attached only under the byok_error guard.
    assert.match(transcribeFn, /if \(error\.code === "byok_error"\) \{/);
    assert.ok(transcribeFn.indexOf('if (error.code === "byok_error")') < transcribeFn.indexOf("error.canUseCredits"), "canUseCredits kept only under the byok_error guard");
    assert.match(transcribeFn, /error\.canUseCredits = body\.canUseCredits === true/);
    assert.match(transcribeFn, /if \(typeof body\.cause === "string"\) error\.cause = body\.cause/);
    assert.match(transcribeFn, /const retryAfter = Number\(body\.retryAfter\)/);
    assert.match(transcribeFn, /if \(Number\.isFinite\(retryAfter\) && retryAfter > 0\) error\.retryAfter = retryAfter/);
    // The old error shape (code, status, message) is untouched.
    assert.match(transcribeFn, /error\.code = typeof body\.code === "string" \? body\.code : "voice_transcription_failed"/);
    assert.match(transcribeFn, /error\.status = response\.status/);
  });

  test("sends useCredits=true only on the requested send", () => {
    assert.match(transcribeFn, /if \(message\.useCredits === true\) form\.set\("useCredits", "true"\);/);
    // Exactly one form.set of the field in the whole function: the guarded
    // one. Every send without the option carries the old fields only.
    assert.equal(transcribeFn.match(/form\.set\("useCredits"/g).length, 1);
    assert.ok(transcribeFn.indexOf('message.useCredits === true') < transcribeFn.indexOf('form.set("useCredits", "true")'), "the field is set only under the option guard");
    // The voice-pin calls keep their old shape (the body carries the field).
    assert.match(transcribeFn, /remoteFetch\(cloudEndpoint\(settings\), "\/api\/ai\/voice-pin", \{ body: form, method: "POST" \}\)/);
    assert.match(transcribeFn, /localFetch\(base, "\/api\/ai\/voice-pin", \{ body: form, method: "POST" \}\)/);
  });

  test("forwards the BYOK fields to the overlay only when present", () => {
    assert.match(transcribeHandler, /const retryAfter = Number\(error\?\.retryAfter\)/);
    assert.match(transcribeHandler, /\.\.\.\(typeof error\?\.cause === "string" \? \{ cause: error\.cause \} : \{\}\)/);
    assert.match(transcribeHandler, /\.\.\.\(error\?\.canUseCredits === true \? \{ canUseCredits: true \} : \{\}\)/);
    assert.match(transcribeHandler, /\.\.\.\(Number\.isFinite\(retryAfter\) && retryAfter > 0 \? \{ retryAfter \} : \{\}\)/);
    // The old fields stay.
    assert.match(transcribeHandler, /code: typeof error\?\.code === "string" \? error\.code : "network_error"/);
    assert.match(transcribeHandler, /storageMode: settings\.storageMode/);
  });
});
