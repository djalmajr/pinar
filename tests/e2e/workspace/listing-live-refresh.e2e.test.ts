import { expect, test } from "@playwright/test";

const createdAt = "2026-08-18T00:00:00.000Z";

function tree(reviewCounts: {
  accepted: number;
  correction_ready: number;
  open: number;
  reopened: number;
}) {
  return {
    projects: [{
      collections: [{
        createdAt,
        id: "col_live",
        isProtected: true,
        name: "Inbox",
        ownerId: "ins_live",
        parentId: null,
        position: 0,
        projectId: "prj_live",
        sessions: [{
          createdAt,
          id: "live-review",
          page: { title: "Live review session", url: "https://example.test/live" },
          pins: [{ comment: "Fix the CTA", coords: { x: 24, y: 48 }, number: 1, type: "point" }],
          reviewCounts,
        }],
        updatedAt: createdAt,
      }],
      createdAt,
      icon: "user-round",
      id: "prj_live",
      isProtected: true,
      name: "Personal",
      ownerId: "ins_live",
      position: 0,
      updatedAt: createdAt,
    }],
  };
}

test("listing picks up agent review changes without a full page reload", async ({ page }) => {
  let agentFinished = false;
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { installationId: "ins_live", kind: "installation", plan: "free" } },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({
    json: {
      tree: tree(agentFinished
        ? { accepted: 0, correction_ready: 1, open: 0, reopened: 0 }
        : { accepted: 0, correction_ready: 0, open: 1, reopened: 0 }),
    },
  }));

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Live review session" })).toBeVisible();
  await expect(page.getByText(/1 (Open|Aberto)/)).toBeVisible();
  await expect(page.getByText(/Ready to accept|Pronto para aceitar/)).toHaveCount(0);

  agentFinished = true;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText(/1 (Ready to accept|Pronto para aceitar)/)).toBeVisible({
    timeout: 8_000,
  });
  await expect(page.getByText(/1 (Open|Aberto)/)).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/?$/);
});
