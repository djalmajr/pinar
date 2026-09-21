import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";
import { resolveVoiceAvailability } from "./voice-access.js";

const source = readFileSync(new URL("./voice.js", import.meta.url), "utf8");
const backgroundSource = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("./content.js", import.meta.url), "utf8");
const sessionSource = readFileSync(new URL("./session.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const {
  MAX_VOICE_SECONDS,
  appendVoiceWaveLevel,
  boundedVoiceDuration,
  formatVoiceComment,
  insertVoiceComment,
  preferredVoiceMimeType,
  voiceSignalLevel,
} = context.__pinarVoice;

describe("voice pin recording helpers", () => {
  // Mutation captured: treating an installation session as an account exposes a paid feature before sign-in.
  test("explains every voice entitlement state", () => {
    assert.deepEqual(resolveVoiceAvailability("local", { kind: "account", plan: "pro" }), {
      available: false,
      reason: "cloud_required",
    });
    assert.deepEqual(resolveVoiceAvailability("cloud", { kind: "installation", plan: "free" }), {
      available: false,
      reason: "sign_in_required",
    });
    assert.deepEqual(resolveVoiceAvailability("cloud", { kind: "account", plan: "free" }), {
      available: false,
      reason: "pro_required",
    });
    assert.deepEqual(resolveVoiceAvailability("cloud", { kind: "account", plan: "pro" }), {
      available: true,
      reason: null,
    });
  });

  test("caps billable recording duration at two minutes", () => {
    assert.equal(MAX_VOICE_SECONDS, 120);
    assert.equal(boundedVoiceDuration(1_000, 1_100), 1);
    assert.equal(boundedVoiceDuration(1_000, 91_001), 91);
    assert.equal(boundedVoiceDuration(1_000, 130_000), 120);
  });

  test("formats the structured comment for review before saving", () => {
    assert.equal(formatVoiceComment({
      acceptanceCriteria: [" Keep 8 px ", "Align the button"],
      comment: " Fix the spacing ",
    }, "Acceptance criteria"), "Fix the spacing\n\nAcceptance criteria:\n- Keep 8 px\n- Align the button");
  });

  // Mutation captured: replacing the field with the latest transcript erases the user's existing comment.
  test("inserts at the cursor and appends when a textarea selection is unavailable", () => {
    assert.deepEqual({ ...insertVoiceComment("Start end", "dictated", 6, 6) }, {
      cursor: 14,
      insertedEnd: 14,
      insertedStart: 6,
      value: "Start dictated end",
    });
    assert.deepEqual({ ...insertVoiceComment("Existing", "dictated", null, null) }, {
      cursor: 17,
      insertedEnd: 17,
      insertedStart: 9,
      value: "Existing dictated",
    });
  });

  test("chooses the first recording format supported by Chrome", () => {
    assert.equal(preferredVoiceMimeType({ isTypeSupported: (value) => value === "audio/webm" }), "audio/webm");
    assert.equal(preferredVoiceMimeType({ isTypeSupported: () => false }), "");
  });

  test("distinguishes silence from detected speech", () => {
    const silence = new Uint8Array(256).fill(128);
    const speech = new Uint8Array(256);
    speech.forEach((_, index) => { speech[index] = index % 2 ? 168 : 88; });

    assert.equal(voiceSignalLevel(silence), 0);
    assert.ok(voiceSignalLevel(speech) > 0.9);
  });

  // Mutation captured: retaining one extra sample makes the timeline exceed its rendered capacity.
  test("keeps a bounded waveform history instead of replacing the previous sample", () => {
    const first = appendVoiceWaveLevel([], 0.2, 3);
    const second = appendVoiceWaveLevel(first, 0.6, 3);
    const third = appendVoiceWaveLevel(second, 1.4, 3);
    const fourth = appendVoiceWaveLevel(third, -1, 3);

    assert.deepEqual(Array.from(first), [0.2]);
    assert.deepEqual(Array.from(fourth), [0.6, 1, 0]);
  });

  test("wires ephemeral recording to the cloud-only voice endpoint", () => {
    assert.ok(sessionSource.indexOf('"voice.js"') < sessionSource.indexOf('"content.js"'));
    assert.match(contentSource, /navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
    assert.match(contentSource, /type: "voice:transcribe"/);
    assert.match(contentSource, /sanitizeCapture\(\{[\s\S]*pins: \[\{ comment: structured \}\]/);
    assert.match(contentSource, /pins: \[\{ comment: transcript \}\]/);
    assert.match(contentSource, /voiceUseTranscript\.addEventListener/);
    assert.match(contentSource, /class="voice-session"/);
    assert.match(contentSource, /class="voice-wave"/);
    assert.match(contentSource, /data-ref="voiceCancel"/);
    assert.match(contentSource, /data-ref="voiceSend"/);
    assert.match(contentSource, /getByteTimeDomainData\(voiceWaveData\)/);
    assert.match(contentSource, /appendVoiceWaveLevel\(voiceWaveHistory/);
    assert.match(contentSource, /requestAnimationFrame\(sample\)/);
    assert.match(contentSource, /@keyframes pinar-voice-processing-wave/);
    assert.doesNotMatch(contentSource, /class="voice-processing-label"/);
    assert.match(contentSource, /insertVoiceComment\([\s\S]*ui\.input\.selectionStart/);
    assert.match(contentSource, /data-ref="voiceStop"/);
    assert.match(contentSource, /submittedVoiceRecorders\.add\(voiceRecorder\)/);
    assert.match(contentSource, /if \(submitAfterTranscription\)[\s\S]*saveDraft\(\)/);
    assert.doesNotMatch(contentSource, /setVoiceStatus\(t\("overlay_voice_ready"\)\)/);
    assert.match(contentSource, /response\?\.code === "ai_inference_failed"/);
    assert.match(contentSource, /ui\.voiceReview\.hidden = transcript === structured/);
    assert.match(backgroundSource, /settings\.storageMode !== "cloud"/);
    assert.match(backgroundSource, /voicePostProcessing: false/);
    assert.match(backgroundSource, /voicePostProcessing: preferences\.voicePostProcessing/);
    assert.match(backgroundSource, /"\/api\/ai\/voice-pin"/);
    assert.doesNotMatch(backgroundSource, /chrome\.storage\.[a-z]+\.set\([^)]*audioDataUrl/);
  });

  test("keeps every voice action compact and gives stop a full-size icon", () => {
    assert.match(contentSource, /\.voice-session-button \{[\s\S]*?height: 32px;[\s\S]*?padding: 0;[\s\S]*?width: 32px;/);
    assert.match(contentSource, /\.voice-session-button svg \{ height: 17px; width: 17px; \}/);
    assert.match(contentSource, /data-ref="voiceStop"[\s\S]*?<rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor"/);
  });
});
