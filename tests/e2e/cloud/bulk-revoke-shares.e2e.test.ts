import { expect, test } from "@playwright/test";
import { openWorkspaceSidebar } from "../helpers/ui";

const createdAt = "2026-09-25T00:00:00.000Z";
const ownerId = "usr_cloud_local_pro";

function session(id: string, title: string) {
  return {
    collectionId: "col_bulk",
    createdAt,
    id,
    page: { title, url: `https://example.test/${id}` },
    pins: [{ comment: title, coords: { x: 10, y: 20 }, number: 1, type: "point" }],
    shotId: id,
    shotUrl: `/shots/${id}.svg`,
    viewerUrl: `/v/${id}.md`,
  };
}

test("bulk revocation only targets direct session links and keeps confirmation open while saving", async ({ page }) => {
  const direct = session("session_direct", "Direct link capture");
  const inherited = session("session_inherited", "Project link capture");
  const tokens = [
    { token: "direct-token", resourceType: "session", resourceId: direct.id },
    { token: "project-token", resourceType: "project", resourceId: "project_bulk" },
  ];
  const revoked: string[] = [];
  let finishRevoke = () => {};
  const pendingRevoke = new Promise<void>((resolve) => { finishRevoke = resolve; });

  await page.route("**/api/project-tree", (route) => route.fulfill({
    json: {
      tree: {
        projects: [{
          collections: [{
            createdAt,
            id: "col_bulk",
            isProtected: false,
            name: "Collection",
            ownerId,
            parentId: null,
            position: 0,
            projectId: "project_bulk",
            sessions: [direct, inherited],
            updatedAt: createdAt,
          }],
          createdAt,
          icon: "folder-kanban",
          id: "project_bulk",
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
  await page.route("**/api/shares/revoke", async (route) => {
    const body = route.request().postDataJSON() as { resourceId: string; resourceType: string };
    expect(body.resourceType).toBe("session");
    revoked.push(body.resourceId);
    await pendingRevoke;
    tokens.splice(tokens.findIndex((token) => token.resourceId === body.resourceId), 1);
    await route.fulfill({ json: { ok: true } });
  });

  const signIn = await page.request.post("/api/auth/email-codes/verify", {
    data: {
      code: "826826",
      email: "pro.cloud-local@pinar.test",
      returnTo: "/app",
    },
  });
  expect(signIn.ok()).toBe(true);
  const projectTreeLoaded = page.waitForResponse((response) => response.url().endsWith("/api/project-tree") && response.ok());
  await page.goto("/app");
  await projectTreeLoaded;
  await openWorkspaceSidebar(page, "Shared");
  const sharedFilter = page.getByRole("button", { exact: true, name: "Shared" });
  await sharedFilter.click();
  await expect(sharedFilter).toHaveAttribute("data-active", "");
  await page.getByRole("checkbox", { name: "Select Direct link capture" }).click();
  await page.getByRole("checkbox", { name: "Select Project link capture" }).click();
  await page.locator("[data-bulk-toolbar]").getByRole("button", { name: "Revoke links" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Revoke links" });
  await expect(confirmation).toContainText("1");
  await confirmation.getByRole("button", { name: "Revoke" }).click();
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "Revoking…" })).toBeDisabled();
  expect(revoked).toEqual([direct.id]);
  finishRevoke();
  await expect(confirmation).toBeHidden();
  await expect(page.getByText("Project link capture", { exact: true })).toBeVisible();
  await page.locator("[data-bulk-toolbar]").getByRole("button", { name: "Revoke links" }).click();
  await expect(page.getByText("The selected sessions have no direct links to revoke.")).toBeVisible();
  await expect(page.getByRole("alertdialog", { name: "Revoke links" })).toHaveCount(0);
});
