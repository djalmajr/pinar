import { expect, test } from "@playwright/test";
import { installClipboardHarness, readClipboardHarness } from "../helpers/ui";

const createdAt = "2026-09-25T00:00:00.000Z";
const ownerId = "usr_cloud_local_pro";

test("project Share copies directly and collection access uses the segmented dialog", async ({ page }) => {
  await installClipboardHarness(page);
  const published: Array<{ resourceId: string; resourceType: string }> = [];
  let failShareLoads = false;
  let revoked = 0;
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
  await page.route("**/api/collections/col_share_menu/collaborators", (route) => route.fulfill({ json: { collaborators: [] } }));
  await page.route("**/api/shares", (route) => {
    if (failShareLoads) {
      return route.fulfill({ json: { error: "unavailable" }, status: 503 });
    }
    return route.fulfill({ json: { tokens } });
  });
  await page.route("**/api/shares/publish", async (route) => {
    const body = route.request().postDataJSON() as { resourceId: string; resourceType: string };
    published.push(body);
    const shareToken = { ...body, token: `token-${body.resourceId}` };
    tokens.push(shareToken);
    await route.fulfill({ json: { shareToken }, status: 201 });
  });
  await page.route("**/api/shares/revoke", async (route) => {
    revoked += 1;
    const body = route.request().postDataJSON() as { resourceId: string; resourceType: string };
    const index = tokens.findIndex((token) => token.resourceId === body.resourceId && token.resourceType === body.resourceType);
    if (index >= 0) tokens.splice(index, 1);
    await route.fulfill({ status: 204 });
  });

  const signIn = await page.request.post("/api/auth/email-codes/verify", {
    data: { code: "826826", email: "pro.cloud-local@pinar.test", returnTo: "/app" },
  });
  expect(signIn.ok()).toBe(true);
  await page.goto("/app");
  await page.getByRole("button", { name: "Workspace: Project actions" }).click();
  await page.getByRole("menuitem", { name: "Share" }).click();
  const projectUrl = new URL(await readClipboardHarness(page));
  expect(projectUrl.pathname).toBe("/p/prj_share_menu");
  expect(projectUrl.searchParams.get("token")).toBe("token-prj_share_menu");
  expect(published).toEqual([{ resourceId: "prj_share_menu", resourceType: "project" }]);

  await page.evaluate(() => {
    window.__pinarE2EClipboard = "";
  });
  await page.getByRole("button", { name: "Workspace: Project actions" }).click();
  await page.getByRole("menuitem", { name: "Share" }).click();
  await expect.poll(() => readClipboardHarness(page)).toBe(projectUrl.toString());
  expect(published).toHaveLength(1);

  failShareLoads = true;
  await page.getByRole("button", { name: "Review: Collection actions" }).click();
  await page.getByRole("menuitem", { name: "Share" }).click();
  const dialog = page.getByRole("dialog");
  const shareTab = dialog.getByRole("tab", { name: "Share" });
  await expect(shareTab).toHaveAttribute("aria-selected", "true");
  await expect(shareTab).toBeFocused();
  await expect(dialog.getByRole("alert")).toContainText("Couldn’t update the share link");
  await expect(dialog.getByRole("button", { name: "Publish" })).toHaveCount(0);
  failShareLoads = false;
  await dialog.getByRole("button", { name: "Retry" }).click();
  await expect(dialog.getByText("Not published")).toBeVisible();
  expect(published).toHaveLength(1);
  expect(new URL(await readClipboardHarness(page)).pathname).toBe("/p/prj_share_menu");

  await dialog.getByRole("button", { name: "Publish" }).click();
  const linkInput = dialog.getByRole("textbox", { name: "Copy link" });
  const collectionUrl = new URL(await linkInput.inputValue());
  expect(collectionUrl.pathname).toBe("/c/col_share_menu");
  expect(collectionUrl.searchParams.get("token")).toBe("token-col_share_menu");
  await dialog.getByRole("button", { name: "Copy link" }).click();
  expect(await readClipboardHarness(page)).toBe(collectionUrl.toString());
  expect(published).toEqual([
    { resourceId: "prj_share_menu", resourceType: "project" },
    { resourceId: "col_share_menu", resourceType: "collection" },
  ]);

  await dialog.getByRole("button", { name: "Revoke" }).click();
  await expect(dialog.getByText("Not published")).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(revoked).toBe(1);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Review: Collection actions" }).click();
  await page.getByRole("menuitem", { name: "Collaborators" }).click();
  const collaboratorsTab = page.getByRole("dialog").getByRole("tab", { name: "Collaborators" });
  await expect(collaboratorsTab).toHaveAttribute("aria-selected", "true");
  await expect(collaboratorsTab).toBeFocused();
});
