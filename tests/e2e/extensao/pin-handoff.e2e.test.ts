import { expect, test } from "@playwright/test";
import { createPin, HANDOFF_MARKDOWN, launchHandoffSession, readDraft } from "../helpers/extension-session";
import { pressCopyShortcut } from "../helpers/extension-shortcut";

test("complete copy keeps captureId and pinId without editing the bundle", async () => {
  const { context, page, worker } = await launchHandoffSession();
  try {
    await createPin(page, "Make the CTA bolder");
    await expect.poll(async () => (await readDraft(worker))?.entries[0]?.shot ?? null).toMatch(/^data:image\/png;base64,/);
    const draft = await readDraft(worker);
    const entry = draft.entries[0];
    expect(entry.captureId).toBeTruthy();
    expect(entry.pin.id).toBeTruthy();

    await pressCopyShortcut(page);
    await expect(page.locator('[data-pinar="host"]')).toHaveAttribute("aria-label", "Session saved");
    await expect.poll(async () => readDraft(worker)).toBeNull();
    const handoff = await worker.evaluate(() => (globalThis as any).__handoff);
    expect(handoff.finished).toEqual([draft.id]);
    // The upload carries the ids the draft assigned, unchanged.
    expect(handoff.shots).toHaveLength(1);
    expect(handoff.shots[0].id).toBe(entry.captureId);
    expect(handoff.shots[0].pins[0].id).toBe(entry.pin.id);
    expect(handoff.shots[0].pins[0].comment).toBe("Make the CTA bolder");
    expect(handoff.shots[0].image).toBe(entry.shot);
    // The clipboard gets the destination's handoff byte for byte.
    expect(handoff.clipboard).toEqual([HANDOFF_MARKDOWN]);
    await expect(page.locator('[data-pinar="host"]')).toBeHidden();
  } finally {
    await context.close();
  }
});

// A session pin is never delivered without its screenshot while screenshots
// are on (createContinuousSession, extension/continuous-session.js): the
// comment and DOM context stay in the pending draft entry, nothing is uploaded
// or copied, and the finish is reported as not done.
test("screenshot failure keeps comment and DOM context pending instead of copying", async () => {
  const { context, page, worker } = await launchHandoffSession();
  try {
    await worker.evaluate(() => {
      chrome.tabs.captureVisibleTab = (async () => { throw new Error("capture failed"); }) as unknown as typeof chrome.tabs.captureVisibleTab;
    });
    await createPin(page, "Still useful without pixels");
    await expect.poll(async () => (await readDraft(worker))?.entries[0]?.status ?? null).toBe("pending");
    const entry = (await readDraft(worker)).entries[0];
    expect(entry.shot ?? null).toBeNull();
    expect(entry.pin.comment).toBe("Still useful without pixels");
    expect(entry.pin.path || entry.pin.selector).toBeTruthy();

    await pressCopyShortcut(page);
    await expect(page.locator('[data-pinar="host"]')).toHaveAttribute("aria-label", /Could not finish the session/);
    const handoff = await worker.evaluate(() => (globalThis as any).__handoff);
    expect(handoff.shots).toEqual([]);
    expect(handoff.clipboard).toEqual([]);
    const pending = (await readDraft(worker)).entries[0];
    expect(pending.status).toBe("pending");
    expect(pending.pin.comment).toBe("Still useful without pixels");
  } finally {
    await context.close();
  }
});
