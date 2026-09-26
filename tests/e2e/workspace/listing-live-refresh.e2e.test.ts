import { expect, test } from "@playwright/test";
import { WORKSPACE_TREE_POLL_MS } from "../../../apps/server/src/lib/workspace-tree-sync";

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

test("focus refresh is not repeated while a tree request is still open, and the slow poll skips batches and shares", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => localStorage.clear());
  const counts = { batches: 0, shares: 0, tree: 0 };
  let holdTree = false;
  let releaseTree = () => {};
  let heldTree = Promise.resolve();
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { installationId: "ins_live", kind: "installation", plan: "free" } },
  }));
  await page.route("**/api/project-tree", async (route) => {
    counts.tree += 1;
    if (holdTree) await heldTree;
    await route.fulfill({
      json: {
        tree: tree({ accepted: 0, correction_ready: 0, open: 1, reopened: 0 }),
      },
    });
  });
  await page.route("**/api/batches", async (route) => {
    counts.batches += 1;
    await route.fulfill({ json: { batches: [] } });
  });
  await page.route("**/api/shares", async (route) => {
    counts.shares += 1;
    await route.fulfill({ json: { tokens: [] } });
  });

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Live review session" })).toBeVisible();
  const loaded = { ...counts };

  heldTree = new Promise((resolve) => {
    releaseTree = resolve;
  });
  holdTree = true;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => counts.tree).toBe(loaded.tree + 1);
  await expect.poll(() => counts.batches).toBe(loaded.batches + 1);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(500);
  expect(counts.tree).toBe(loaded.tree + 1);
  expect(counts.batches).toBe(loaded.batches + 1);
  const sharesAfterFocus = counts.shares;
  const released = page.waitForResponse((response) => response.url().includes("/api/project-tree"));
  releaseTree();
  holdTree = false;
  await released;
  await page.evaluate(async () => {
    await Promise.resolve();
  });
  expect(counts.tree).toBe(loaded.tree + 1);

  await page.clock.fastForward(WORKSPACE_TREE_POLL_MS);
  await expect.poll(() => counts.tree).toBe(loaded.tree + 2);
  expect(counts.batches).toBe(loaded.batches + 1);
  expect(counts.shares).toBe(sharesAfterFocus);
});
