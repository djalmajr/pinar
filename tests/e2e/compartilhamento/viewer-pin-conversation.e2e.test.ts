import { expect, test } from "@playwright/test";

const sessionId = "viewer-conversation";

const session = {
  createdAt: "2026-09-25T11:00:00.000Z",
  id: sessionId,
  page: {
    description: "Conversation fixture.",
    title: "Conversation fixture",
    url: "https://example.test/conversation",
  },
  pins: [
    {
      comment: "Original note",
      coords: { x: 24, y: 48 },
      number: 1,
      pinId: "pin_1",
      selector: "button#save",
      tag: "button",
      type: "point",
    },
    {
      comment: "Second note",
      coords: { x: 80, y: 120 },
      number: 2,
      pinId: "pin_2",
      selector: "span.price",
      tag: "span",
      type: "point",
    },
  ],
  shotId: sessionId,
  shotUrl: `/shots/${sessionId}.svg`,
};

test.beforeEach(async ({ page }) => {
  const reviews = [
    { actions: ["accept"], captureId: sessionId, pinId: "pin_1", status: "open", timeline: [] },
    { actions: ["reopen"], captureId: sessionId, pinId: "pin_2", status: "accepted", timeline: [] },
  ];
  const comments = [
    {
      actorId: "ada",
      actorLabel: "Ada",
      actorType: "human",
      body: "Only on pin 2",
      captureId: sessionId,
      createdAt: "2026-09-25T12:00:00.000Z",
      id: "c_pin2",
      pinId: "pin_2",
    },
  ];
  const executions = [
    {
      agent: "cursor",
      captureId: sessionId,
      createdAt: "2026-09-25T12:02:00.000Z",
      id: "exec_1",
      idempotencyKey: "exec_1",
      results: [{
        createdAt: "2026-09-25T12:02:00.000Z",
        files: [],
        pinId: "pin_1",
        reason: "The label was too light",
        status: "changed",
        summary: "Raised the contrast",
      }],
    },
  ];
  let sessionReads = 0;
  let rejectNextComment = true;

  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { kind: "local", plan: "free" } },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({
    json: {
      tree: {
        projects: [{
          collections: [{
            createdAt: session.createdAt,
            id: "col_conversation",
            isProtected: true,
            name: "Inbox",
            ownerId: "local",
            parentId: null,
            position: 0,
            projectId: "prj_conversation",
            sessions: [],
            updatedAt: session.createdAt,
          }],
          createdAt: session.createdAt,
          icon: "user-round",
          id: "prj_conversation",
          isProtected: true,
          name: "Personal",
          ownerId: "local",
          position: 0,
          updatedAt: session.createdAt,
        }],
      },
    },
  }));
  await page.route(`**/shots/${sessionId}.svg`, (route) => route.fulfill({
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"></svg>',
    contentType: "image/svg+xml",
  }));
  await page.route(`**/api/sessions/${sessionId}**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST" && path.endsWith("/review")) {
      const body = route.request().postDataJSON() as { action?: string };
      const pinId = path.split("/").at(-2) || "";
      const review = reviews.find((item) => item.pinId === pinId);
      if (review && body.action === "accept") {
        review.status = "accepted";
        review.actions = ["reopen"];
      }
      if (review && body.action === "reopen") {
        review.status = "reopened";
        review.actions = ["accept"];
      }
      await route.fulfill({ json: { ok: true, review } });
      return;
    }
    if (route.request().method() === "POST" && path.endsWith("/comments")) {
      const body = route.request().postDataJSON() as { body?: string };
      if (rejectNextComment) {
        rejectNextComment = false;
        await route.fulfill({ json: { error: "failed" }, status: 500 });
        return;
      }
      comments.push({
        actorId: "local",
        actorLabel: "Local",
        actorType: "human",
        body: body.body || "",
        captureId: sessionId,
        createdAt: "2026-09-25T12:05:00.000Z",
        id: "c_new",
        pinId: path.split("/").at(-2) || "",
      });
      await route.fulfill({ json: { ok: true } });
      return;
    }
    sessionReads += 1;
    await route.fulfill({
      json: { comments, executions, ok: true, reviews, session },
    });
  });

  await page.exposeBinding("__sessionReads", () => sessionReads);
  await page.goto(`/v/${sessionId}`);
});

test("pin dialog concludes, reopens, and keeps comments on their pin", async ({ page }) => {
  const cards = page.locator("aside").getByTitle(/Open pin/);
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).not.toContainText("Open");
  await expect(cards.nth(0)).not.toContainText("Found by");
  await expect(cards.nth(1)).toContainText("Concluded");
  await expect(page.getByText("Found by selector", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Found by text", { exact: true })).toHaveCount(0);

  await cards.nth(0).click();
  const dialog = page.getByRole("dialog", { name: "Pin 1" });
  await expect(dialog.getByRole("tab", { name: "Comments", selected: true })).toBeVisible();
  await expect(dialog.getByRole("tab")).toHaveText(["Comments", "Preview", "Raw"]);

  const captureLink = dialog.getByRole("link", { name: "Open this capture" });
  await expect(captureLink).toBeVisible();
  await expect(captureLink).toHaveAttribute("href", session.shotUrl);
  await expect(captureLink).toHaveAttribute("target", "_blank");
  await expect(captureLink).toHaveAttribute("rel", "noopener noreferrer");
  await expect(captureLink.getByRole("img")).toBeVisible();

  const screenshotBox = await captureLink.boundingBox();
  const commentsSection = dialog.getByRole("region", { name: "Comments" });
  const commentsBox = await commentsSection.boundingBox();
  const concludeBox = await dialog.getByRole("button", { name: "Conclude pin" }).boundingBox();
  expect(screenshotBox).not.toBeNull();
  expect(commentsBox).not.toBeNull();
  expect(concludeBox).not.toBeNull();
  expect((screenshotBox?.y ?? 0) + (screenshotBox?.height ?? 0)).toBeLessThanOrEqual(commentsBox?.y ?? 0);
  expect((commentsBox?.y ?? 0) + (commentsBox?.height ?? 0)).toBeLessThanOrEqual(concludeBox?.y ?? 0);

  await expect(dialog.getByRole("button", { name: "Conclude pin" })).toBeVisible();
  await expect(dialog.getByText("Last agent result")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Accept correction" })).toHaveCount(0);
  await expect(dialog.getByText("changed", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Raised the contrast")).toHaveCount(0);
  await expect(dialog.getByText("The label was too light")).toHaveCount(0);
  await expect(dialog.getByText("cursor", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Only on pin 2")).toHaveCount(0);

  const readsBeforeTyping = await page.evaluate(() => (window as unknown as { __sessionReads?: () => number }).__sessionReads?.() ?? -1);
  const field = dialog.getByRole("textbox", { name: "Comment" });
  await field.fill("Keep this draft");
  const readsAfterTyping = await page.evaluate(() => (window as unknown as { __sessionReads?: () => number }).__sessionReads?.() ?? -1);
  expect(readsAfterTyping).toBe(readsBeforeTyping);

  await dialog.getByRole("button", { name: "Send comment" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(field).toHaveValue("Keep this draft");

  await dialog.getByRole("button", { name: "Send comment" }).click();
  await expect(field).toHaveValue("");
  await expect(dialog.getByText("Keep this draft")).toBeVisible();
  await expect(dialog.getByText("Local", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Conclude pin" }).click();
  await expect(dialog.getByRole("button", { name: "Reopen pin" })).toBeVisible();
  await expect(dialog.getByText("Concluded", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Reopen pin" }).click();
  await expect(dialog.getByRole("button", { name: "Conclude pin" })).toBeVisible();

  await dialog.getByRole("button", { name: "Close" }).click();
  await cards.nth(1).click();
  const second = page.getByRole("dialog", { name: "Pin 2" });
  await expect(second.getByText("Only on pin 2")).toBeVisible();
  await expect(second.getByText("Keep this draft")).toHaveCount(0);
  await expect(second.getByText("Raised the contrast")).toHaveCount(0);
  await expect(second.getByRole("button", { name: "Reopen pin" })).toBeVisible();
});

test("comment controls stay inside a narrow pin dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByTitle("Open pin 1").click();
  const dialog = page.getByRole("dialog", { name: "Pin 1" });
  const close = dialog.getByRole("button", { name: "Close" });
  const send = dialog.getByRole("button", { name: "Send comment" });
  const field = dialog.getByRole("textbox", { name: "Comment" });
  await expect(send).toBeVisible();
  const closeBox = await close.boundingBox();
  const sendBox = await send.boundingBox();
  const fieldBox = await field.boundingBox();
  expect(closeBox).not.toBeNull();
  expect(sendBox).not.toBeNull();
  expect(fieldBox).not.toBeNull();
  expect((sendBox?.y ?? 0)).toBeGreaterThan((closeBox?.y ?? 0) + (closeBox?.height ?? 0));
  expect((fieldBox?.x ?? 0) + (fieldBox?.width ?? 0)).toBeLessThanOrEqual(390);
  expect((sendBox?.x ?? 0) + (sendBox?.width ?? 0)).toBeLessThanOrEqual(390);
  await close.focus();
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
