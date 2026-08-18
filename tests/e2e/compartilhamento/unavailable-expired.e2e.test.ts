import { expect, test } from "@playwright/test";

const createdAt = "2026-08-18T00:00:00.000Z";
const privateOwner = "owner-private-do-not-expose";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { installationId: "ins_unavailable", kind: "installation", plan: "free" } },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({
    json: {
      tree: {
        projects: [
          {
            collections: [
              {
                createdAt,
                id: "col_unavailable_inbox",
                isProtected: true,
                name: "Inbox",
                ownerId: "ins_unavailable",
                parentId: null,
                position: 0,
                projectId: "prj_unavailable_personal",
                sessions: [],
                updatedAt: createdAt,
              },
            ],
            createdAt,
            icon: "user-round",
            id: "prj_unavailable_personal",
            isProtected: true,
            name: "Personal",
            ownerId: "ins_unavailable",
            position: 0,
            updatedAt: createdAt,
          },
        ],
      },
    },
  }));
});

test("missing, expired and foreign session ids fail with the same safe public state", async ({ page }) => {
  for (const id of ["missing-session", "expired-session", "foreign-session"]) {
    await page.route(`**/api/sessions/${id}`, (route) => route.fulfill({
      json: { error: "Session not found" },
      status: 404,
    }));
    await page.goto(`/v/${id}`);

    await expect(page.getByRole("heading", { name: "Annotation session not found" })).toBeVisible();
    await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(privateOwner);
  }

  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "No annotation sessions found" })).toBeVisible();
});

test("Markdown for absent or expired sessions returns 404 without content leakage", async ({ page }) => {
  for (const id of ["missing-session", "expired-session"]) {
    await page.route(`**/v/${id}.md`, (route) => route.fulfill({
      body: "Session not found",
      contentType: "text/plain",
      status: 404,
    }));
  }
  await page.goto("/");

  for (const id of ["missing-session", "expired-session"]) {
    const response = await page.evaluate(async (sessionId) => {
      const result = await fetch(`/v/${sessionId}.md`);
      return { body: await result.text(), status: result.status };
    }, id);
    expect(response).toEqual({ body: "Session not found", status: 404 });
    expect(response.body).not.toContain(privateOwner);
    expect(response.body).not.toContain("Expired session title");
  }
});

test("an aggregate that remains after retention explains that its collection is empty", async ({ page }) => {
  await page.route("**/api/public/collections/empty-after-retention", (route) => route.fulfill({
    json: {
      collection: {
        createdAt,
        id: "empty-after-retention",
        isProtected: false,
        name: "Retained collection",
        ownerId: "ins_unavailable",
        parentId: null,
        position: 1,
        projectId: "prj_archive",
        sessions: [],
        updatedAt: createdAt,
      },
      ok: true,
    },
  }));

  await page.goto("/c/empty-after-retention");

  await expect(page.getByRole("heading", { name: "Retained collection" })).toBeVisible();
  await expect(page.getByText("0 sessions", { exact: true })).toBeVisible();
  await expect(page.getByText("No sessions in this collection.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open" })).toHaveCount(0);
});
