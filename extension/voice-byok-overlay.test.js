import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { translations } from "./i18n.js";

// F5/S4b review (round 1, findings 1 and 2): the overlay voice lifecycle is
// exercised headless — the production slices of content.js (the voice
// section and saveDraft) run in a node vm with fixture DOM, FileReader,
// MediaRecorder and the background transport. The same-recording payload
// kept for the "use Pinar credits" retry must be released when the
// recording is replaced or the draft is saved, and the composer must be
// blocked before the first await of the encoding (a keyboard save during
// the FileReader read must not ship a text-only draft).

const root = fileURLToPath(new URL("./", import.meta.url));
const source = readFileSync(fileURLToPath(new URL("./content.js", import.meta.url)), "utf8");
const success = { ok: true, result: { acceptanceCriteria: [], comment: "New voice", transcript: "New voice" } };
const byok = { code: "byok_error", cause: "timeout", canUseCredits: true, ok: false, status: 502 };

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function harness(contentSource = source) {
  const calls = [], copies = [], readers = [];
  let answer = async () => byok;
  let microphone = async () => ({ getTracks: () => [{ stop() {} }] });
  class Node {
    constructor() {
      this.children = [];
      this.dataset = {};
      this.disabled = false;
      this.hidden = true;
      this.selectionEnd = 0;
      this.selectionStart = 0;
      this.textContent = "";
      this.value = "";
      this.classList = { toggle() {} };
    }
    setAttribute() {}
    focus() {}
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    // A hostile-input sink guard: no overlay copy may reach an HTML setter.
    set innerHTML(value) { throw new Error("Untrusted HTML sink: " + value); }
  }
  const ui = new Proxy({}, { get: (target, key) => target[key] ??= new Node() });
  const state = { draft: { comment: "", color: "red" }, pins: [], batch: { nextNumber: 1 } };
  class Recorder {
    constructor() { this.listeners = {}; this.mimeType = "audio/webm"; this.state = "inactive"; }
    static isTypeSupported() { return true; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; }
  }
  class Reader {
    constructor() { this.listeners = {}; readers.push(this); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    readAsDataURL() {}
    finish(value = "data:audio/webm;base64,QQ==") { this.result = value; this.listeners.load(); }
  }
  const c = vm.createContext({
    Blob,
    FileReader: Reader,
    MediaRecorder: Recorder,
    Uint8Array,
    performance: { now: () => 5000 },
    navigator: { mediaDevices: { getUserMedia: () => microphone() } },
    setInterval: () => 1,
    setTimeout: () => 1,
    clearInterval() {},
    clearTimeout() {},
    cancelAnimationFrame() {},
    requestAnimationFrame: (fn) => 0,
    state,
    ui,
    crypto: { randomUUID: () => `id-${Math.random()}` },
    location: { href: "https://fixture.invalid/" },
    t: (key) => translations.en[key] ?? key,
    VOICE_AVAILABILITY_MESSAGE_KEYS: { checking: "overlay_voice_checking", unavailable: "overlay_voice_unavailable" },
    formatVoiceDuration: String,
    formatVoiceRecordingLabel: String,
    sanitizeCapture: (value) => value,
    activeScan: () => ({ fields: [] }),
    pageContext: () => ({}),
    fitInput() {},
    resetPinsAfterNavigation() {},
    nextPinNumber: () => 1,
    pinColor: () => "red",
    renderChrome() {},
    syncPins: async () => true,
    updateOutline() {},
    renderMarkers() {},
    pendingReviewSync: null,
    chrome: { runtime: { sendMessage: async (message) => {
      if (message.type === "voice:availability") return { available: true, ok: true };
      if (message.type === "voice:copy-transcript") { copies.push(message.text); return { ok: true }; }
      calls.push(message);
      return answer(message);
    } } },
  });
  vm.runInContext(readFileSync(fileURLToPath(new URL("./voice.js", import.meta.url)), "utf8"), c);
  vm.runInContext(readFileSync(fileURLToPath(new URL("./voice-errors.js", import.meta.url)), "utf8"), c);
  vm.runInContext(readFileSync(fileURLToPath(new URL("./keyboard.js", import.meta.url)), "utf8"), c);
  const voice = contentSource.slice(contentSource.indexOf("let voiceAvailable ="), contentSource.indexOf("function claimComposerFocus()"));
  const rate = contentSource.slice(contentSource.indexOf("const formatVoiceByokRate ="), contentSource.indexOf("const VOICE_AVAILABILITY_MESSAGE_KEYS ="));
  const save = contentSource.slice(contentSource.indexOf("function saveDraft()"), contentSource.indexOf("function deleteDraft()"));
  vm.runInContext(rate + voice + save + `
    const { MAX_VOICE_SECONDS, appendVoiceWaveLevel, boundedVoiceDuration, formatVoiceComment, insertVoiceComment, preferredVoiceMimeType, voiceSignalLevel } = __pinarVoice;
    const { voiceErrorKey } = __pinarVoiceErrors;
    globalThis.api = {
      generation: () => voiceRequestGeneration,
      keySave: (event) => __pinarKeyboardEvents.handleComposerKeyDown(event) ? saveDraft() : false,
      snapshot: () => ({
        feedbackHidden: ui.voiceFeedback.hidden,
        generation: voiceRequestGeneration,
        hidden: ui.voiceCreditRetry.hidden,
        pending: typeof pendingCreditRetry === "undefined" ? null : pendingCreditRetry,
        processing: voiceProcessing,
        recording: voiceRecorder?.state,
        text: ui.input.value,
      }),
      seedRecorder: () => { const recorder = new MediaRecorder(); voiceRecorder = recorder; voiceStartedAt = 1000; return recorder; },
      startVoiceRecording,
      finishVoiceRecording,
      discardVoiceRecording,
      resetVoiceUi,
      saveDraft,
      runVoiceTranscription,
      retryVoiceWithCredits,
    };
  `, c);
  return {
    api: c.api,
    ui,
    state,
    calls,
    copies,
    readers,
    setAnswer: (fn) => { answer = fn; },
    setMicrophone: (fn) => { microphone = fn; },
  };
}

describe("voice BYOK overlay lifecycle (F5/S4b review)", () => {
  test("failure -> credits retry -> success: same audio, new ID, one double-click send, cleared payload", async () => {
    const h = harness();
    await h.api.runVoiceTranscription({ audioDataUrl: "data:audio/webm;base64,QQ==", durationSeconds: 4, requestGeneration: 0 });
    assert.equal(h.api.snapshot().hidden, false);
    const wait = deferred();
    h.setAnswer(() => wait.promise);
    const first = h.api.retryVoiceWithCredits();
    const second = h.api.retryVoiceWithCredits();
    assert.equal(h.calls.length, 2);
    assert.equal(h.api.snapshot().hidden, true);
    assert.equal(h.calls[0].audioDataUrl, h.calls[1].audioDataUrl);
    assert.equal(h.calls[0].durationSeconds, h.calls[1].durationSeconds);
    assert.notEqual(h.calls[0].requestId, h.calls[1].requestId);
    assert.equal(h.calls[0].useCredits, undefined);
    assert.equal(h.calls[1].useCredits, true);
    wait.resolve(success);
    await Promise.all([first, second]);
    assert.equal(h.ui.input.value, "New voice");
    assert.equal(h.api.snapshot().pending, null);
  });

  test("canUseCredits=false hides the action and releases the payload", async () => {
    const h = harness();
    h.setAnswer(async () => ({ ...byok, canUseCredits: false }));
    await h.api.runVoiceTranscription({ audioDataUrl: "A", durationSeconds: 4, requestGeneration: 0 });
    assert.equal(h.api.snapshot().pending, null);
    assert.equal(h.api.snapshot().hidden, true);
    await h.api.retryVoiceWithCredits();
    assert.equal(h.calls.length, 1);
  });

  test("a new recording releases the previous failure audio", async () => {
    const h = harness();
    await h.api.runVoiceTranscription({ audioDataUrl: "OLD_AUDIO", durationSeconds: 4, requestGeneration: 0 });
    await h.api.startVoiceRecording();
    assert.equal(h.api.snapshot().pending, null);
  });

  test("a manual save releases the previous failure audio", async () => {
    const h = harness();
    await h.api.runVoiceTranscription({ audioDataUrl: "OLD_AUDIO", durationSeconds: 4, requestGeneration: 0 });
    h.ui.input.value = "Manual comment";
    assert.equal(h.api.saveDraft(), true);
    assert.equal(h.state.draft, null);
    assert.equal(h.api.snapshot().pending, null);
    assert.equal(h.api.snapshot().hidden, true);
  });

  test("a failed new microphone request cannot offer the old audio retry", async () => {
    const h = harness();
    await h.api.runVoiceTranscription({ audioDataUrl: "OLD_AUDIO", durationSeconds: 4, requestGeneration: 0 });
    h.setMicrophone(async () => { throw new Error("NotAllowedError"); });
    await h.api.startVoiceRecording();
    assert.equal(h.api.snapshot().pending, null);
    assert.equal(h.api.snapshot().hidden, true);
  });

  test("the encoding blocks the keyboard save until the voice is inserted", async () => {
    const h = harness();
    const recorder = h.api.seedRecorder();
    h.ui.input.value = "Existing typed comment";
    const finish = h.api.finishVoiceRecording(recorder, null, [new Blob(["A"])], 0);
    // The FileReader is still pending: the composer must already be blocked.
    assert.equal(h.api.snapshot().processing, true);
    const saved = h.api.keySave({ key: "Enter", stopPropagation() {}, preventDefault() {} });
    assert.equal(saved, false);
    assert.deepEqual(h.state.draft, { comment: "", color: "red" });
    assert.equal(h.state.pins.length, 0);
    h.setAnswer(async () => success);
    h.readers[0].finish();
    await finish;
    // The blocked save shipped nothing: the draft is still open, no pin was
    // written, and the voice landed in the composer once encoded.
    assert.deepEqual(h.state.draft, { comment: "", color: "red" });
    assert.equal(h.state.pins.length, 0);
    assert.match(h.ui.input.value, /New voice/);
    assert.equal(h.api.snapshot().processing, false);
  });

  test("a late credits result is discarded after cancel or a new recording", async () => {
    for (const change of ["cancel", "new-recording"]) {
      const h = harness();
      await h.api.runVoiceTranscription({ audioDataUrl: "A", durationSeconds: 4, requestGeneration: 0 });
      const wait = deferred();
      h.setAnswer(() => wait.promise);
      const retry = h.api.retryVoiceWithCredits();
      h.api.resetVoiceUi();
      if (change === "new-recording") await h.api.startVoiceRecording();
      wait.resolve(success);
      await retry;
      assert.equal(h.ui.input.value, "");
      assert.equal(h.copies.length, 0);
      assert.equal(h.api.snapshot().pending, null);
      assert.equal(h.api.snapshot().processing, false);
    }
  });

  test("every BYOK cause and a hostile retryAfter renders through the BYOK textContent status", async () => {
    const causes = [
      "key_rejected", "scope_denied",
      "model_not_found", "service_disabled", "model_not_configured",
      "rate_limited",
      "timeout", "unavailable", "endpoint_unreachable", "endpoint_blocked", "egress_unavailable",
      "invalid_response",
      "<img src=x onerror=alert(1)>",
    ];
    const h = harness();
    for (const cause of causes) {
      h.setAnswer(async () => ({ ...byok, cause, retryAfter: "<img src=x onerror=alert(1)>" }));
      await h.api.runVoiceTranscription({ audioDataUrl: "A", durationSeconds: 4, requestGeneration: 0 });
      assert.equal(h.ui.voiceStatus.textContent.includes("<img"), false, cause);
      assert.equal(h.ui.voiceStatus.textContent.startsWith("Your AI endpoint"), true, cause);
    }
    h.setAnswer(async () => ({ ...byok, cause: "rate_limited", retryAfter: 30 }));
    await h.api.runVoiceTranscription({ audioDataUrl: "A", durationSeconds: 4, requestGeneration: 0 });
    assert.match(h.ui.voiceStatus.textContent, /30 seconds/);
  });
});
