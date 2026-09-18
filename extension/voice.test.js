import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./voice.js", import.meta.url), "utf8");
const backgroundSource = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("./content.js", import.meta.url), "utf8");
const sessionSource = readFileSync(new URL("./session.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const {
  MAX_VOICE_SECONDS,
  boundedVoiceDuration,
  formatVoiceComment,
  preferredVoiceMimeType,
  voiceSignalLevel,
  voiceWaveHeights,
} = context.__pinarVoice;

describe("voice pin recording helpers", () => {
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

  test("chooses the first recording format supported by Chrome", () => {
    assert.equal(preferredVoiceMimeType({ isTypeSupported: (value) => value === "audio/webm" }), "audio/webm");
    assert.equal(preferredVoiceMimeType({ isTypeSupported: () => false }), "");
  });

  test("keeps the waveform still in silence and scales it with detected speech", () => {
    const silence = new Uint8Array(256).fill(128);
    const speech = new Uint8Array(256);
    speech.forEach((_, index) => { speech[index] = index % 2 ? 168 : 88; });

    assert.equal(voiceSignalLevel(silence), 0);
    assert.ok(voiceSignalLevel(speech) > 0.9);
    assert.deepEqual(Array.from(voiceWaveHeights(0, 10)), [3, 3, 3, 3, 3]);
    assert.ok(Math.max(...voiceWaveHeights(voiceSignalLevel(speech), 10)) > 10);
  });

  test("wires ephemeral recording to the cloud-only voice endpoint", () => {
    assert.ok(sessionSource.indexOf('"voice.js"') < sessionSource.indexOf('"content.js"'));
    assert.match(contentSource, /navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
    assert.match(contentSource, /type: "voice:transcribe"/);
    assert.match(contentSource, /sanitizeCapture\(\{[\s\S]*pins: \[\{ comment: structured \}\]/);
    assert.match(contentSource, /pins: \[\{ comment: transcript \}\]/);
    assert.match(contentSource, /voiceUseTranscript\.addEventListener/);
    assert.match(contentSource, /class="voice-wave"/);
    assert.match(contentSource, /getByteTimeDomainData\(voiceWaveData\)/);
    assert.match(contentSource, /requestAnimationFrame\(sample\)/);
    assert.doesNotMatch(contentSource, /@keyframes pinar-voice-wave/);
    assert.match(contentSource, /class="voice-processing-indicator"/);
    assert.match(contentSource, /data-ref="voiceStop"/);
    assert.match(contentSource, /\.voice-btn\.is-recording \{ background: \$\{MARK\}; color: #fff; \}/);
    assert.match(contentSource, /response\?\.code === "ai_inference_failed"/);
    assert.match(contentSource, /ui\.voiceReview\.hidden = transcript === structured/);
    assert.match(backgroundSource, /settings\.storageMode !== "cloud"/);
    assert.match(backgroundSource, /voicePostProcessing: false/);
    assert.match(backgroundSource, /voicePostProcessing: preferences\.voicePostProcessing/);
    assert.match(backgroundSource, /"\/api\/ai\/voice-pin"/);
    assert.doesNotMatch(backgroundSource, /chrome\.storage\.[a-z]+\.set\([^)]*audioDataUrl/);
  });
});
