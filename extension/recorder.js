// Reproduction recording (Visual Context v1 `reproduction`, DJA-171). Pure
// bookkeeping for the background service worker: one recording per tab,
// bounded steps, coalesced typing, navigation steps from the tabs API. The
// content script decides what a step is; the AI (server) turns the timeline
// into prose and a Playwright test later.
// Keep the limits in sync with REPRODUCTION_LIMITS in packages/shared.

export const REPRODUCTION_VERSION = 1;
export const RECORDING_LIMITS = Object.freeze({
  inputCoalesceMs: 1_500,
  maxSteps: 60,
  maxThumbnailLength: 40_000,
  maxValueLength: 200,
  thumbnailIntervalMs: 800,
});
const STEP_KINDS = new Set(["click", "input", "key", "navigate", "scroll", "wait"]);
const THUMBNAIL_KINDS = new Set(["click", "key", "navigate"]);

function clip(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function createRecording(now = Date.now()) {
  return {
    finished: false,
    lastThumbnailAt: 0,
    startedAt: new Date(now).toISOString(),
    steps: [],
    truncated: false,
  };
}

/** Normalizes a step reported by a content script; null when it is unusable. */
export function normalizeStep(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object" || !STEP_KINDS.has(raw.kind)) return null;
  const step = {
    at: typeof raw.at === "string" && raw.at ? raw.at : new Date(now).toISOString(),
    kind: raw.kind,
  };
  if (raw.locator && typeof raw.locator === "object") {
    const locator = {};
    for (const key of ["cssSelector", "domPath", "innerText", "tag"]) {
      if (typeof raw.locator[key] === "string" && raw.locator[key]) locator[key] = clip(raw.locator[key], key === "domPath" ? 2_000 : 500);
    }
    if (raw.locator.fingerprint && typeof raw.locator.fingerprint === "object") locator.fingerprint = raw.locator.fingerprint;
    if (Object.keys(locator).length) step.locator = locator;
  }
  if (raw.redacted === true) step.redacted = true;
  else if (typeof raw.value === "string" && raw.value) step.value = clip(raw.value, RECORDING_LIMITS.maxValueLength);
  if (typeof raw.title === "string" && raw.title) step.title = clip(raw.title, 200);
  if (typeof raw.url === "string" && raw.url) step.url = clip(raw.url, 2_000);
  if (typeof raw.thumbnail === "string" && raw.thumbnail.startsWith("data:image/") && raw.thumbnail.length <= RECORDING_LIMITS.maxThumbnailLength) {
    step.thumbnail = raw.thumbnail;
  }
  return step;
}

function sameTarget(left, right) {
  if (!left?.locator || !right?.locator) return false;
  return (left.locator.domPath && left.locator.domPath === right.locator.domPath)
    || (left.locator.cssSelector && left.locator.cssSelector === right.locator.cssSelector);
}

/**
 * Appends a step. Typing into the same field within the coalesce window
 * replaces the previous input step, so a form fill is one step per field.
 * Returns the stored step, or null when the recording is closed or full.
 */
export function appendStep(recording, raw, now = Date.now()) {
  if (!recording || recording.finished) return null;
  const step = normalizeStep(raw, now);
  if (!step) return null;
  const last = recording.steps.at(-1);
  if (step.kind === "input" && last?.kind === "input" && sameTarget(last, step)
    && Date.parse(step.at) - Date.parse(last.at) <= RECORDING_LIMITS.inputCoalesceMs) {
    recording.steps[recording.steps.length - 1] = { ...last, ...step, thumbnail: last.thumbnail };
    return recording.steps.at(-1);
  }
  if (step.kind === "scroll" && last?.kind === "scroll" && ((!last.locator && !step.locator) || sameTarget(last, step))) {
    recording.steps[recording.steps.length - 1] = { ...last, ...step };
    return recording.steps.at(-1);
  }
  if (recording.steps.length >= RECORDING_LIMITS.maxSteps) {
    recording.truncated = true;
    return null;
  }
  recording.steps.push(step);
  return step;
}

export function navigationStep(url, title, now = Date.now()) {
  return normalizeStep({ kind: "navigate", title, url }, now);
}

/** Whether a thumbnail should be taken for this step right now. */
export function wantsThumbnail(recording, step, now = Date.now()) {
  if (!recording || !step || !THUMBNAIL_KINDS.has(step.kind)) return false;
  if (now - recording.lastThumbnailAt < RECORDING_LIMITS.thumbnailIntervalMs) return false;
  recording.lastThumbnailAt = now;
  return true;
}

export function attachThumbnail(step, thumbnail) {
  if (!step || typeof thumbnail !== "string") return;
  if (!thumbnail.startsWith("data:image/") || thumbnail.length > RECORDING_LIMITS.maxThumbnailLength) return;
  step.thumbnail = thumbnail;
}

/** Closes the recording and returns the Visual Context `reproduction` value. */
export function finishRecording(recording) {
  if (!recording) return null;
  recording.finished = true;
  if (!recording.steps.length) return null;
  return {
    startedAt: recording.startedAt,
    steps: recording.steps.map((step) => ({ ...step })),
    version: REPRODUCTION_VERSION,
  };
}

export function recordingStatus(recording) {
  return {
    count: recording?.steps.length ?? 0,
    finished: recording?.finished === true,
    recording: Boolean(recording) && recording.finished !== true,
    truncated: recording?.truncated === true,
  };
}
