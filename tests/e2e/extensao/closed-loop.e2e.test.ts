import { expect, test, type Page } from "@playwright/test";
import { pressCopyShortcut } from "../helpers/extension-shortcut";
import { createPin, HANDOFF_MARKDOWN, launchHandoffSession, readDraft } from "../helpers/extension-session";
import { injectExtensionScripts } from "../helpers/extension-scripts";

const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const fixture = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Closed loop fixture</title>
    <style>
      body { font: 16px/1.4 sans-serif; margin: 0; padding: 140px 48px; }
      button { height: 64px; width: 180px; }
    </style>
  </head>
  <body>
    <main>
      <button id="save">Save changes</button>
      <section aria-modal="true" hidden id="fixture-dialog" role="dialog">
        <button id="close-dialog">Close</button>
        <p id="delete-copy">Delete local agents?</p>
      </section>
    </main>
    <script>
      const dialog = document.querySelector("#fixture-dialog");
      const closeDialog = document.querySelector("#close-dialog");
      globalThis.openFixtureDialog = () => {
        dialog.hidden = false;
        closeDialog.focus();
      };
      document.addEventListener("focusin", (event) => {
        if (!dialog.hidden && !dialog.contains(event.target)) closeDialog.focus();
      }, true);
    </script>
  </body>
</html>`;

async function installHarness(page: Page) {
  await page.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachOpenShadow(init) {
      return original.call(this, { ...init, mode: "open" });
    };
  });
  await page.route("**/closed-loop-fixture", (route) => route.fulfill({
    body: fixture,
    contentType: "text/html",
  }));
  await page.goto("/closed-loop-fixture");
  await page.evaluate(() => {
    const runtimeState = { messages: [] as unknown[], pins: [] as unknown[] };
    (globalThis as any).__pinarRuntimeState = runtimeState;
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: async (message: any) => {
          runtimeState.messages.push(structuredClone(message));
          if (message.type === "pins:sync") {
            runtimeState.pins = structuredClone(message.pins);
            return { ok: true, pins: structuredClone(runtimeState.pins) };
          }
          if (message.type === "pins:list") return { ok: true, pins: structuredClone(runtimeState.pins) };
          if (message.type === "pins:refresh") return { ok: true };
          if (message.type === "pins:clear") {
            runtimeState.pins = [];
            return { ok: true };
          }
          return { ok: true };
        },
      },
    };
  });
  await injectExtensionScripts(page);
  await expect(page.locator('[data-pinar="host"]')).toBeVisible();
}

// The handoff any of the four agents reads is the session the service worker
// finishes (1ec1ecc): the capture keeps the captureId the draft assigned and
// the pin keeps its own id, and the clipboard gets the destination's handoff.
test("pin copy keeps capture ids for the four-agent handoff", async () => {
  const { context, page, worker } = await launchHandoffSession();
  try {
    await createPin(page, "Make the CTA bolder");
    await expect.poll(async () => (await readDraft(worker))?.entries[0]?.status ?? null).toBe("saved");
    const entry = (await readDraft(worker)).entries[0];
    await pressCopyShortcut(page);
    await expect(page.locator('[data-pinar="host"]')).toHaveAttribute("aria-label", "Session saved");
    const handoff = await worker.evaluate(() => (globalThis as any).__handoff);
    expect(entry.captureId).toBeTruthy();
    expect(handoff.shots.map((shot: any) => shot.id)).toEqual([entry.captureId]);
    expect(handoff.shots[0].pins[0].id).toBe(entry.pin.id);
    expect(handoff.shots[0].pins[0].comment).toBe("Make the CTA bolder");
    expect(handoff.clipboard).toEqual([HANDOFF_MARKDOWN]);
  } finally {
    await context.close();
  }
});

test("pin composer focuses its comment field over a page modal", async ({ page }) => {
  await installHarness(page);
  await page.evaluate(() => (globalThis as any).openFixtureDialog());
  const target = page.locator("#delete-copy");
  await expect(target).toBeVisible();
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;

  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const composer = page.locator('[data-pinar="host"] [data-ref="composer"]');
  const input = composer.locator("textarea");
  await expect(composer).toBeVisible();
  await expect(input).toBeFocused();
});

// Pinar Local stopped accepting agent feedback in d9bfd30 (agent results live
// in Pinar Cloud, tests/e2e/cloud/agent-access.e2e.test.ts): an agent
// execution is refused with 410 and never shapes the pin's review, while
// the human accept and reopen still work on the local session.
test("workspace refuses agent feedback, keeps the human accept and reopen, and keeps metrics empty without opt-in", async ({ page }) => {
  // The e2e server keeps its home across runs: a per-run capture id keeps
  // earlier runs' reviews out of this one.
  const captureId = `e2e_closed_loop_${Date.now().toString(36)}`;
  await page.goto("/app");
  const uploaded = await page.evaluate(async ({ captureId, image }) => {
    const response = await fetch("/api/shots", {
      body: JSON.stringify({
        captureId,
        id: captureId,
        image,
        page: { title: "Closed loop", url: "https://example.test/closed-loop" },
        pins: [{ comment: "Make the CTA bolder", kind: "element", pinId: "pin_cta" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return { status: response.status };
  }, { captureId, image: VALID_PNG });
  expect(uploaded.status).toBe(201);

  const agentExecution = (idempotencyKey: string, agent: string, summary: string) => page.evaluate(async ({ agent, captureId, idempotencyKey, summary }) => {
    const created = await fetch("/api/agent-executions", {
      body: JSON.stringify({
        agent,
        captureId,
        idempotencyKey,
        results: [{ pinId: "pin_cta", status: "changed", summary }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const session = await (await fetch(`/api/sessions/${captureId}`)).json();
    return { body: await created.json(), created: created.status, executions: session.executions, reviews: session.reviews };
  }, { agent, captureId, idempotencyKey: `${idempotencyKey}_${captureId}`, summary });
  const review = (action: string) => page.evaluate(async ({ action, captureId }) => {
    const response = await fetch(`/api/sessions/${captureId}/pins/pin_cta/review`, {
      body: JSON.stringify({ action }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body = await response.json();
    return { status: response.status, review: body.review?.status };
  }, { action, captureId });

  const first = await agentExecution("exec_e2e_closed_loop_01", "claude", "First correction");
  expect(first.created).toBe(410);
  expect(first.body.error).toBe("agent_feedback_disabled");
  // Only human events shape a local review: the refused execution leaves none.
  expect(first.executions).toEqual([]);
  expect(first.reviews).toEqual([]);

  const accepted = await review("accept");
  expect(accepted.status).toBe(200);
  expect(accepted.review).toBe("accepted");

  const reopened = await review("reopen");
  expect(reopened.status).toBe(200);
  expect(reopened.review).toBe("reopened");

  const second = await agentExecution("exec_e2e_closed_loop_02", "grok", "Second correction");
  expect(second.created).toBe(410);
  expect(second.body.error).toBe("agent_feedback_disabled");
  expect(second.executions).toEqual([]);
  expect(second.reviews.map((item: any) => [item.pinId, item.status])).toEqual([["pin_cta", "reopened"]]);

  const metrics = await page.evaluate(async () => {
    const off = await fetch("/api/loop-metrics", {
      body: JSON.stringify({
        events: [{ comment: "Make the CTA bolder", event: "handoff", url: "https://example.test/closed-loop" }],
        optIn: false,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const listed = await (await fetch("/api/loop-metrics")).json();
    return { listed, off: await off.json() };
  });
  expect(metrics.off.stored).toBe(0);
  expect(JSON.stringify(metrics.listed)).not.toContain("Make the CTA bolder");
  expect(JSON.stringify(metrics.listed)).not.toContain("https://example.test/closed-loop");
});
