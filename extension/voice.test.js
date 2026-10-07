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
  test("explains every voice entitlement state", () => {
    // Local mode is gated on the local AI configuration status reported by the background.
    assert.deepEqual(resolveVoiceAvailability("local", { kind: "local" }, { configured: true }), {
      available: true,
      reason: null,
    });
    assert.deepEqual(resolveVoiceAvailability("local", { kind: "local" }, { configured: false }), {
      available: false,
      reason: "local_ai_required",
    });
    // An unknown local AI status (server off or unreachable) is not "not configured".
    assert.deepEqual(resolveVoiceAvailability("local", { kind: "local" }, null), {
      available: false,
      reason: "unavailable",
    });
    // The cloud rules keep their previous behavior, with or without a local AI status.
    assert.deepEqual(resolveVoiceAvailability("cloud", { kind: "account", plan: "pro" }, { configured: true }), {
      available: true,
      reason: null,
    });
    assert.deepEqual(resolveVoiceAvailability("cloud", { kind: "installation", plan: "free" }), {
      available: false,
      reason: "pro_required",
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

  test("wires ephemeral recording to the mode-routed voice endpoint", () => {
    assert.ok(sessionSource.indexOf('"voice.js"') < sessionSource.indexOf('"content.js"'));
    assert.match(contentSource, /navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
    assert.match(contentSource, /type: "voice:transcribe"/);
    assert.match(contentSource, /type: "voice:copy-transcript"/);
    assert.match(contentSource, /voice:copy-transcript"[\s\S]*?\.catch\(\(\) => null\)/);
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
    // The voice endpoint is routed by storage mode instead of refusing local mode.
    assert.doesNotMatch(backgroundSource, /Voice comments require the Pinar cloud server/);
    assert.match(backgroundSource, /localAi = settings\.storageMode === "local" \? await localAiAvailability\(\) : undefined/);
    assert.match(backgroundSource, /resolveVoiceAvailability\(settings\.storageMode, session, localAi\)/);
    assert.match(backgroundSource, /let response = await localFetch\(base, "\/api\/ai\/status"\)/);
    assert.match(backgroundSource, /if \(response\.status === 404\) response = await localFetch\(base, "\/api\/ai\/settings"\)/);
    assert.match(backgroundSource, /body\.mode !== "disabled"[\s\S]*?typeof body\.transcriptionModel === "string"[\s\S]*?body\.transcriptionModel\.trim\(\) !== ""/);
    assert.match(backgroundSource, /localFetch\(base, "\/api\/ai\/voice-pin", \{ body: form, method: "POST" \}\)/);
    assert.match(contentSource, /local_ai_required: "overlay_voice_local_ai_required"/);
    assert.match(backgroundSource, /voicePostProcessing: false/);
    assert.match(backgroundSource, /voicePostProcessing: preferences\.voicePostProcessing/);
    assert.match(backgroundSource, /remoteFetch\(cloudEndpoint\(settings\), "\/api\/ai\/voice-pin", \{ body: form, method: "POST" \}\)/);
    assert.match(backgroundSource, /message\.type === "voice:copy-transcript"[\s\S]*?writeClipboardPlain\(transcript\)/);
    assert.doesNotMatch(backgroundSource, /chrome\.storage\.[a-z]+\.set\([^)]*audioDataUrl/);
  });

  // Mutation captured: answering a cached positive check from the network re-opens the
  // credential vault on every overlay open.
  test("answers a positive local availability from memory until the server proves it down", () => {
    const availabilityFn = backgroundSource.slice(
      backgroundSource.indexOf("async function localAiAvailability()"),
      backgroundSource.indexOf("async function fetchSavedViewerMarkdown"),
    );
    // The light status route never reads the vault; the settings route is a one-shot 404 fallback.
    assert.match(availabilityFn, /let response = await localFetch\(base, "\/api\/ai\/status"\)/);
    assert.match(availabilityFn, /if \(response\.status === 404\) response = await localFetch\(base, "\/api\/ai\/settings"\)/);
    // voiceReady decides; the previous rule applies to the same body when it is absent.
    assert.match(availabilityFn, /typeof body\.voiceReady === "boolean"[\s\S]*?body\.voiceReady[\s\S]*?body\.mode !== "disabled"/);
    // A positive answer is cached and then answered without touching the server.
    assert.match(availabilityFn, /if \(localAiPositivelyConfigured\) return \{ configured: true \};/);
    assert.match(availabilityFn, /if \(configured\) localAiPositivelyConfigured = true;/);
    // A negative or unknown answer never reaches the positive cache.
    assert.doesNotMatch(availabilityFn, /localAiPositivelyConfigured = false/);
    // The local check stays local: no cloud fetch in the availability path.
    assert.doesNotMatch(availabilityFn, /remoteFetch|cloudEndpoint/);
  });

  test("drops the positive local availability cache on a down-AI failure or a mode change", () => {
    const transcribeFn = backgroundSource.slice(
      backgroundSource.indexOf("async function transcribeVoiceComment("),
      backgroundSource.indexOf("async function responseBody("),
    );
    // Only the down-AI codes and the missing helper drop the cache, and only in local mode.
    assert.match(backgroundSource, /const LOCAL_AI_DOWN_CODES = new Set\(\["ai_endpoint_unavailable", "ai_timeout", "ai_unavailable"\]\)/);
    assert.match(transcribeFn, /settings\.storageMode === "local"[\s\S]*?error\?\.message === "helper_unavailable" \|\| LOCAL_AI_DOWN_CODES\.has\(error\?\.code\)/);
    assert.match(transcribeFn, /localAiPositivelyConfigured = false/);
    // Changing the storage mode drops the cache where settings are saved.
    assert.match(backgroundSource, /if \(areaName === "sync" && changes\.storageMode\) \{[\s\S]*?localAiPositivelyConfigured = false;/);
  });

  // Mutation captured: re-showing "checking" on every refresh flickers the microphone on each open.
  test("shows the checking state only while the page has no known voice state", () => {
    const refreshFn = contentSource.slice(
      contentSource.indexOf("async function refreshVoiceAvailability()"),
      contentSource.indexOf("function blobDataUrl"),
    );
    assert.match(refreshFn, /if \(voiceAvailabilityReason === "checking"\) \{\s*voiceAvailable = false;\s*renderVoiceControls\(\);\s*\}/);
    // The unconditional "checking" assignment that preceded the request must stay gone.
    assert.doesNotMatch(refreshFn, /voiceAvailabilityReason = "checking"/);
    // The fresh answer still wins when it arrives.
    assert.match(refreshFn, /voiceAvailabilityReason = voiceAvailable[\s\S]*?Object\.hasOwn\(VOICE_AVAILABILITY_MESSAGE_KEYS, response\?\.reason\)/);
  });

  test("keeps every voice action compact and gives stop a full-size icon", () => {
    assert.match(contentSource, /\.voice-session-button \{[\s\S]*?height: 32px;[\s\S]*?padding: 0;[\s\S]*?width: 32px;/);
    assert.match(contentSource, /\.voice-session-button svg \{ height: 17px; width: 17px; \}/);
    assert.match(contentSource, /data-ref="voiceStop"[\s\S]*?<rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor"/);
  });
});
