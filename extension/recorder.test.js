import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  RECORDING_LIMITS,
  appendStep,
  attachThumbnail,
  createRecording,
  finishRecording,
  navigationStep,
  normalizeStep,
  recordingStatus,
  wantsThumbnail,
} from "./recorder.js";

const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const contentSrc = readFileSync(new URL("./content.js", import.meta.url), "utf8");
const privacySrc = readFileSync(new URL("./privacy.js", import.meta.url), "utf8");

const T0 = Date.parse("2026-09-08T10:00:00.000Z");

describe("extension reproduction recorder", () => {
  test("is wired through background, content script and the sanitizer", () => {
    assert.match(backgroundSrc, /recorder:start/);
    assert.match(backgroundSrc, /recorder:step/);
    assert.match(backgroundSrc, /recorder:finish/);
    assert.match(backgroundSrc, /recorder:cancel/);
    assert.match(backgroundSrc, /__pinarResumeRecording/);
    assert.match(contentSrc, /recorder:step/);
    assert.match(contentSrc, /reproduction:/);
    assert.match(contentSrc, /data-hint="record"/);
    assert.match(privacySrc, /input\.reproduction/);
  });

  test("normalizes steps and refuses unknown kinds", () => {
    assert.equal(normalizeStep({ kind: "teleport" }), null);
    assert.equal(normalizeStep(null), null);
    const step = normalizeStep({
      at: "2026-09-08T10:00:00.000Z",
      kind: "input",
      locator: { cssSelector: "input[name=email]", domPath: "form > input", innerText: "", tag: "input" },
      value: "user@example.test",
    }, T0);
    assert.deepEqual(step, {
      at: "2026-09-08T10:00:00.000Z",
      kind: "input",
      locator: { cssSelector: "input[name=email]", domPath: "form > input", tag: "input" },
      value: "user@example.test",
    });
    const redacted = normalizeStep({ kind: "input", redacted: true, value: "hunter2" }, T0);
    assert.equal(redacted.value, undefined);
    assert.equal(redacted.redacted, true);
    assert.equal(normalizeStep({ kind: "click", thumbnail: "http://evil/x.png" }, T0).thumbnail, undefined);
  });

  test("coalesces typing into the same field and keeps its thumbnail", () => {
    const recording = createRecording(T0);
    const locator = { cssSelector: "input[name=q]" };
    const first = appendStep(recording, { at: new Date(T0).toISOString(), kind: "input", locator, value: "p" }, T0);
    attachThumbnail(first, "data:image/jpeg;base64,AAA");
    appendStep(recording, { at: new Date(T0 + 400).toISOString(), kind: "input", locator, value: "pi" }, T0 + 400);
    appendStep(recording, { at: new Date(T0 + 900).toISOString(), kind: "input", locator, value: "pin" }, T0 + 900);
    assert.equal(recording.steps.length, 1);
    assert.equal(recording.steps[0].value, "pin");
    assert.equal(recording.steps[0].thumbnail, "data:image/jpeg;base64,AAA");
    appendStep(recording, { at: new Date(T0 + 5_000).toISOString(), kind: "input", locator, value: "pinar" }, T0 + 5_000);
    assert.equal(recording.steps.length, 2, "typing after the window is a new step");
  });

  test("bounds the number of steps and reports truncation", () => {
    const recording = createRecording(T0);
    for (let index = 0; index < RECORDING_LIMITS.maxSteps + 5; index += 1) {
      appendStep(recording, { kind: "click", locator: { cssSelector: `#b${index}` } }, T0 + index);
    }
    assert.equal(recording.steps.length, RECORDING_LIMITS.maxSteps);
    assert.equal(recording.truncated, true);
    assert.deepEqual(recordingStatus(recording), { count: RECORDING_LIMITS.maxSteps, finished: false, recording: true, truncated: true });
  });

  test("throttles thumbnails to click, key and navigate steps", () => {
    const recording = createRecording(T0);
    const click = appendStep(recording, { kind: "click" }, T0);
    assert.equal(wantsThumbnail(recording, click, T0 + 1), true);
    const second = appendStep(recording, { kind: "click" }, T0 + 100);
    assert.equal(wantsThumbnail(recording, second, T0 + 100), false, "inside the interval");
    const scroll = appendStep(recording, { kind: "scroll", value: "800px" }, T0 + 2_000);
    assert.equal(wantsThumbnail(recording, scroll, T0 + 2_000), false);
    const nav = appendStep(recording, navigationStep("https://example.test/next", "Next", T0 + 3_000), T0 + 3_000);
    assert.equal(nav.url, "https://example.test/next");
    assert.equal(wantsThumbnail(recording, nav, T0 + 3_000), true);
    attachThumbnail(nav, "x".repeat(RECORDING_LIMITS.maxThumbnailLength + 1));
    assert.equal(nav.thumbnail, undefined, "oversized thumbnails are dropped");
  });

  test("finishing closes the recording and yields the Visual Context value", () => {
    const empty = createRecording(T0);
    assert.equal(finishRecording(empty), null);
    assert.equal(finishRecording(null), null);
    const recording = createRecording(T0);
    appendStep(recording, { kind: "navigate", url: "https://example.test/login" }, T0);
    appendStep(recording, { kind: "click", locator: { innerText: "Sign in" } }, T0 + 10);
    const reproduction = finishRecording(recording);
    assert.equal(reproduction.version, 1);
    assert.equal(reproduction.startedAt, "2026-09-08T10:00:00.000Z");
    assert.equal(reproduction.steps.length, 2);
    assert.equal(appendStep(recording, { kind: "click" }, T0 + 20), null, "no steps after finish");
    assert.deepEqual(recordingStatus(recording), { count: 2, finished: true, recording: false, truncated: false });
    assert.deepEqual(finishRecording(recording).steps, reproduction.steps, "finish is repeatable for retries");
  });
});
