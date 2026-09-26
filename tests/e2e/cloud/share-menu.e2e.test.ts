import { expect, test } from "@playwright/test";
import { installClipboardHarness, readClipboardHarness } from "../helpers/ui";

const createdAt = "2026-09-25T00:00:00.000Z";
const ownerId = "usr_cloud_local_pro";

test("project and collection Share actions copy a usable tokenized link", async ({ page }) => {
  await installClipboardHarness(page);
  const published: Array<{ resourceId: string; resourceType: string }> = [];
  const tokens: Array<{ resourceId: string; resourceType: string; token: string }> = [];
  await page.route("**/api/project-tree", (route) => route.fulfill({
    json: {
      tree: {
        projects: [{
          collections: [{
            createdAt,
            id: "col_share_menu",
            isProtected: false,
            name: "Review",
            ownerId,
            parentId: null,
            position: 0,
            projectId: "prj_share_menu",
            sessions: [],
            updatedAt: createdAt,
          }],
          createdAt,
          icon: "folder-kanban",
          id: "prj_share_menu",
          isProtected: false,
          name: "Workspace",
          ownerId,
          position: 0,
          updatedAt: createdAt,
        }],
      },
    },
  }));
  await page.route("**/api/batches", (route) => route.fulfill({ json: { batches: [] } }));
  await page.route("**/api/shares", (route) => route.fulfill({ json: { tokens } }));
  await page.route("**/api/shares/publish", async (route) => {
    const body = route.request().postDataJSON() as { resourceId: string; resourceType: string };
    published.push(body);
    const shareToken = { ...body, token: `token-${body.resourceId}` };
    tokens.push(shareToken);
    await route.fulfill({ json: { shareToken }, status: 201 });
  });

  const signIn = await page.request.post("/api/auth/email-codes/verify", {
    data: { code: "826826", email: "pro.cloud-local@pinar.test", returnTo: "/app" },
  });
  expect(signIn.ok()).toBe(true);
  await page.goto("/app");
  await page.getByRole("button", { name: "Workspace: Project actions" }).click();
  await page.getByRole("menuitem", { name: "Share" }).click();
  expect(new URL(await readClipboardHarness(page)).pathname).toBe("/p/prj_share_menu");
  expect(new URL(await readClipboardHarness(page)).searchParams.get("token")).toBe("token-prj_share_menu");
  expect(published).toEqual([{ resourceId: "prj_share_menu", resourceType: "project" }]);

  await page.getByRole("button", { name: "Workspace: Project actions" }).click();
  await page.getByRole("menuitem", { name: "Share" }).click();
  expect(published).toHaveLength(1);

  await page.getByRole("button", { name: "Review: Collection actions" }).click();
  await page.getByRole("menuitem", { name: "Share" }).click();
  const collectionUrl = new URL(await readClipboardHarness(page));
  expect(collectionUrl.pathname).toBe("/c/col_share_menu");
  expect(collectionUrl.searchParams.get("token")).toBe("token-col_share_menu");
  expect(published).toEqual([
    { resourceId: "prj_share_menu", resourceType: "project" },
    { resourceId: "col_share_menu", resourceType: "collection" },
  ]);
});
