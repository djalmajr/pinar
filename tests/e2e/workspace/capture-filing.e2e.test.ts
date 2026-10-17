import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import {
  e2eHomeDir,
  removeLocalAiSettings,
  startFakeModel,
  writeLocalAiSettings,
  type FakeModel,
} from "../helpers/assistant-fake-model";
import { isMobileViewport, openWorkspaceAccountMenu, openWorkspaceSidebar } from "../helpers/ui";

// F3.5 in the browser: with "Choose the collection automatically" on and
// the fake model declaring the decisions extra, the real local server files
// a new capture (POST /api/shots) into the collection the model picked and
// marks it; moving the session clears the mark. ai.json is written straight
// into the e2e PINAR_HOME (see writeLocalAiSettings for why the AI settings
// routes are never used); the dialog's own AI settings requests are answered
// in the page and never reach the server.
const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const home = e2eHomeDir();
// The e2e PINAR_HOME persists between runs and other files use the same
// server afterwards: names and ids carry a per-run token, and every test
// deletes what it created and turns the setting back off.
const run = Date.now().toString(36);
const MARK = "Filed automatically. Move to correct.";
const NONE = "None of these";
const SWITCH = "Choose the collection automatically";
const UNAVAILABLE = "Requires AI to be set up.";
const DESTINATION = "Capture destination";
let fake: FakeModel;
const createdSessions: string[] = [];
const createdProjects: string[] = [];

test.skip(home === null, "the filing suite needs the local e2e server and its PINAR_HOME");

test.beforeAll(async () => {
  fake = await startFakeModel({ decisions: true });
});

test.afterAll(async () => {
  if (home) removeLocalAiSettings(home);
  await fake?.stop();
});

test.beforeEach(async ({ page, request }) => {
  fake.reset();
  if (home) removeLocalAiSettings(home);
  await setAutomatic(request, false);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("pinar-e2e-storage-ready")) return;
    localStorage.clear();
    sessionStorage.setItem("pinar-e2e-storage-ready", "true");
  });
});

// Everything the test created, also after a failed assertion: the sessions
// by id, then the project with its collections; the setting goes back off
// and ai.json is removed.
test.afterEach(async ({ request }) => {
  await setAutomatic(request, false);
  if (home) removeLocalAiSettings(home);
  for (const id of createdSessions.splice(0)) {
    // 404: a capture that failed before it was saved.
    expect([200, 404]).toContain((await request.delete(`/api/history/${encodeURIComponent(id)}`)).status());
  }
  for (const id of createdProjects.splice(0)) {
    expect((await request.delete(`/api/projects/${encodeURIComponent(id)}`)).status()).toBe(200);
  }
});

async function setAutomatic(request: APIRequestContext, value: boolean) {
  const response = await request.patch("/api/preferences", { data: { autoCaptureDestination: value } });
  expect(response.ok(), `PATCH /api/preferences autoCaptureDestination=${value}`).toBe(true);
}

async function storedAutomatic(request: APIRequestContext): Promise<unknown> {
  return ((await (await request.get("/api/preferences")).json()) as { autoCaptureDestination?: unknown }).autoCaptureDestination;
}

function configureFakeModel() {
  if (home) writeLocalAiSettings(home, fake.endpoint);
}

interface Seed {
  a: { id: string; label: string; name: string };
  b: { id: string; label: string; name: string };
  inboxId: string;
  project: { id: string; name: string };
}

// A project with collections A and B, each with example captures, created
// through the routes the workspace and the capture use while the setting is
// off, plus the Inbox the capture falls back to.
async function seedWorkspace(page: Page, tag: string): Promise<Seed> {
  const label = `${run} ${test.info().project.name} ${tag}`;
  const prefix = `e2e_filing_${run}_${test.info().project.name}_${tag}`;
  const seed = await page.evaluate(async ({ image, label, prefix }) => {
    const post = async (path: string, body: unknown) => {
      const response = await fetch(path, { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method: "POST" });
      if (!response.ok) throw new Error(`${path} answered ${response.status}`);
      return response.json();
    };
    const { project } = await post("/api/projects", { name: `Filing ${label}` });
    const { collection: a } = await post(`/api/projects/${project.id}/collections`, { name: `Design ${label}` });
    const { collection: b } = await post(`/api/projects/${project.id}/collections`, { name: `Research ${label}` });
    const examples = [
      { collectionId: a.id, id: `${prefix}_example_a1`, title: `Checkout button spacing ${label}` },
      { collectionId: a.id, id: `${prefix}_example_a2`, title: `Cart header alignment ${label}` },
      { collectionId: b.id, id: `${prefix}_example_b1`, title: `Pricing copy interview ${label}` },
    ];
    for (const example of examples) {
      await post("/api/shots", {
        collectionId: example.collectionId,
        id: example.id,
        image,
        page: { title: example.title, url: "https://example.test/examples" },
        pins: [{ comment: "Example pin", kind: "element" }],
      });
    }
    const tree = (await (await fetch("/api/project-tree")).json()) as {
      tree: { projects: Array<{ collections: Array<{ id: string; isProtected: boolean }>; isProtected: boolean }> };
    };
    const inbox = tree.tree.projects.find((item) => item.isProtected)?.collections.find((item) => item.isProtected);
    return {
      a: { id: a.id as string, name: a.name as string },
      b: { id: b.id as string, name: b.name as string },
      examples: examples.map((example) => example.id),
      inboxId: inbox?.id ?? "",
      project: { id: project.id as string, name: project.name as string },
    };
  }, { image: VALID_PNG, label, prefix });
  createdProjects.push(seed.project.id);
  createdSessions.push(...seed.examples);
  expect(seed.inboxId, "the protected Inbox exists").not.toBe("");
  return {
    a: { ...seed.a, label: `${seed.project.name} / ${seed.a.name}` },
    b: { ...seed.b, label: `${seed.project.name} / ${seed.b.name}` },
    inboxId: seed.inboxId,
    project: seed.project,
  };
}

interface ShotAnswer {
  destination: { collectionId: string };
  filing?: { collectionId: string | null; confidence: number; engine: string; reason: string };
  status: number;
}

// A new capture as the extension sends it in manual mode: POST /api/shots
// with its cached collectionId in the body.
async function capture(page: Page, input: { collectionId: string; id: string; title: string }): Promise<ShotAnswer> {
  createdSessions.push(input.id);
  return page.evaluate(async ({ image, input }) => {
    const response = await fetch("/api/shots", {
      body: JSON.stringify({
        collectionId: input.collectionId,
        id: input.id,
        image,
        page: { title: input.title, url: "https://example.test/new-capture" },
        pins: [{ comment: "The checkout button overlaps the cart total", kind: "element" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return { ...(await response.json()), status: response.status };
  }, { image: VALID_PNG, input });
}

// The session as the session route returns it.
async function storedSession(page: Page, id: string) {
  return page.evaluate(async (sessionId) => {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    return ((await response.json()) as { session: { collectionId: string; filedBy?: string } }).session;
  }, id);
}

// The workspace on the seeded project, across its collections.
async function openProject(page: Page, projectId: string) {
  await page.evaluate((id) => {
    localStorage.setItem("pinar-selected-project", id);
    localStorage.removeItem("pinar-selected-collection");
    localStorage.setItem("pinar-history-view", "grid");
  }, projectId);
  await page.goto("/app");
}

function card(page: Page, title: string) {
  return page.locator('[data-slot="card"]').filter({ hasText: title }).first();
}

function row(page: Page, title: string) {
  return page.getByRole("row").filter({ hasText: title }).first();
}

// The mark's name is its tooltip text; hovering shows the tooltip itself.
// Touch screens have no hover, so on phones the accessible name is the check.
async function expectMark(page: Page, scope: Locator) {
  const mark = scope.getByRole("img", { name: MARK });
  await expect(mark).toHaveCount(1);
  if (isMobileViewport(page)) return;
  await mark.hover();
  // A tooltip from an earlier hover may still be closing: read the newest.
  await expect(page.getByRole("tooltip").last()).toHaveText(MARK);
  await page.mouse.move(0, 0);
}

async function openCaptureSettings(page: Page) {
  await openWorkspaceAccountMenu(page);
  await page.getByRole("menuitem", { exact: true, name: "Settings" }).click();
  const dialog = page.locator('[data-slot="dialog-content"]');
  await expect(dialog).toBeVisible();
  await settingsSection(dialog, "Capture").click();
  return dialog;
}

// The dialog has a sidebar (desktop) and a strip (phones) of the same sections.
function settingsSection(dialog: Locator, name: string) {
  return dialog.getByRole("button", { exact: true, name }).filter({ visible: true }).first();
}

test("the switch needs the AI, follows a saved AI setup and saves the setting", async ({ page, request }) => {
  const preferenceReads: string[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "GET" && new URL(sent.url()).pathname === "/api/preferences") preferenceReads.push(sent.url());
  });
  // The dialog's AI settings requests stay in the page: the routes that
  // write them are never called on this machine (see writeLocalAiSettings).
  const aiSettingsCalls: string[] = [];
  await page.route("**/api/ai/settings", async (route) => {
    aiSettingsCalls.push(route.request().method());
    await route.fulfill(route.request().method() === "PATCH"
      ? { json: { apiKeyPreview: "", hasApiKey: false, ok: true, tested: { model: "fake-model" } } }
      : { json: { apiKeyPreview: "", endpoint: fake.endpoint, hasApiKey: false, mode: "local", model: "fake-model", transcriptionModel: "" } });
  });
  await page.goto("/app");
  const dialog = await openCaptureSettings(page);
  const toggle = dialog.getByRole("switch", { name: SWITCH });
  const destination = dialog.getByRole("combobox", { name: DESTINATION });

  // Without AI the server cannot choose.
  await expect(toggle).toBeDisabled();
  await expect(dialog.getByText(UNAVAILABLE)).toBeVisible();
  await expect(destination).toBeEnabled();

  // The AI is set up (ai.json) and saved in the dialog: the save reads the
  // preferences again, so the switch follows without a reload.
  configureFakeModel();
  const readsBeforeSave = preferenceReads.length;
  await settingsSection(dialog, "AI Assistant").click();
  await dialog.getByRole("button", { exact: true, name: "Save" }).filter({ visible: true }).click();
  await expect.poll(() => preferenceReads.length).toBe(readsBeforeSave + 1);
  await settingsSection(dialog, "Capture").click();
  await expect(toggle).toBeEnabled();
  await expect(dialog.getByText(UNAVAILABLE)).toHaveCount(0);
  // Opening the section reads nothing more.
  expect(preferenceReads.length).toBe(readsBeforeSave + 1);
  expect(aiSettingsCalls).toEqual(["GET", "PATCH"]);

  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(destination).toBeDisabled();
  await expect.poll(() => storedAutomatic(request)).toBe(true);

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(destination).toBeEnabled();
  await expect.poll(() => storedAutomatic(request)).toBe(false);
});

test("a confident choice files the capture into its collection with the mark, and moving it clears the mark", async ({ page, request }) => {
  configureFakeModel();
  await page.goto("/app");
  const seed = await seedWorkspace(page, "chosen");
  await setAutomatic(request, true);
  fake.enqueueDecision({ choice: seed.a.label, probabilities: { [NONE]: 0.05, [seed.a.label]: 0.9, [seed.b.label]: 0.05 } });

  const title = `Checkout total overlap ${run} ${test.info().project.name}`;
  const id = `e2e_filing_${run}_${test.info().project.name}_chosen`;
  const answer = await capture(page, { collectionId: seed.inboxId, id, title });
  expect(answer.status).toBe(201);
  expect(answer.filing).toMatchObject({ collectionId: seed.a.id, engine: "decisions", reason: "chosen" });
  expect(answer.destination.collectionId).toBe(seed.a.id);
  expect(await storedSession(page, id)).toMatchObject({ collectionId: seed.a.id, filedBy: "auto" });

  // What the model was asked: both collections and "None of these", never the Inbox.
  expect(fake.decisionRequests).toHaveLength(1);
  const options = fake.decisionRequests[0]?.questions?.[0]?.options ?? [];
  expect(options).toEqual(expect.arrayContaining([seed.a.label, seed.b.label, NONE]));
  expect(options.at(-1)).toBe(NONE);
  expect(options.filter((option) => /inbox/i.test(option))).toEqual([]);

  // Across the project's collections: the card's chip and the table row carry the mark.
  await openProject(page, seed.project.id);
  const filedCard = card(page, title);
  await expect(filedCard).toContainText(seed.a.name);
  await expectMark(page, filedCard);
  await page.getByRole("tab", { name: "Table view" }).click();
  await expectMark(page, row(page, title));
  await page.getByRole("tab", { name: "Grid view" }).click();

  // Inside collection A the chip goes away and the mark stands beside the title.
  await openWorkspaceSidebar(page, seed.a.name);
  await page.getByRole("button", { exact: true, name: seed.a.name }).click();
  await expect(card(page, title)).not.toContainText(seed.a.name);
  await expectMark(page, card(page, title));

  // The person corrects it through the session menu: the mark goes away.
  await card(page, title).getByRole("button", { name: "More session actions" }).click();
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  const moveDialog = page.getByRole("dialog", { name: "Move to…" });
  await expect(moveDialog.getByRole("combobox", { name: "Workspace" })).toHaveValue(seed.project.name);
  await moveDialog.getByRole("combobox", { name: "Collection" }).fill(seed.b.name);
  await page.getByRole("option", { name: seed.b.name }).click();
  await moveDialog.getByRole("button", { exact: true, name: "Move" }).click();
  await expect(moveDialog).toBeHidden();
  await expect.poll(async () => (await storedSession(page, id)).collectionId).toBe(seed.b.id);
  expect((await storedSession(page, id)).filedBy).toBeUndefined();

  await openWorkspaceSidebar(page, seed.b.name);
  await page.getByRole("button", { exact: true, name: seed.b.name }).click();
  await expect(card(page, title)).toBeVisible();
  await expect(card(page, title).getByRole("img", { name: MARK })).toHaveCount(0);
});

test("below the confidence floor the capture goes to the Inbox without the mark", async ({ page, request }) => {
  configureFakeModel();
  await page.goto("/app");
  const seed = await seedWorkspace(page, "doubt");
  await setAutomatic(request, true);
  fake.enqueueDecision({ choice: seed.a.label, probabilities: { [NONE]: 0.2, [seed.a.label]: 0.5, [seed.b.label]: 0.3 } });

  const title = `Checkout doubt ${run} ${test.info().project.name}`;
  const id = `e2e_filing_${run}_${test.info().project.name}_doubt`;
  const answer = await capture(page, { collectionId: seed.b.id, id, title });
  expect(answer.status).toBe(201);
  expect(answer.filing).toMatchObject({ collectionId: null, engine: "decisions", reason: "low_confidence" });
  expect(answer.destination.collectionId).toBe(seed.inboxId);
  const stored = await storedSession(page, id);
  expect(stored.collectionId).toBe(seed.inboxId);
  expect(stored.filedBy).toBeUndefined();
  expect(fake.decisionRequests).toHaveLength(1);

  // In the Inbox (of the protected project) the card has no mark.
  const inboxProject = await page.evaluate(async (inboxId) => {
    const tree = (await (await fetch("/api/project-tree")).json()) as {
      tree: { projects: Array<{ collections: Array<{ id: string }>; id: string }> };
    };
    return tree.tree.projects.find((item) => item.collections.some((collection) => collection.id === inboxId))?.id ?? "";
  }, seed.inboxId);
  await openProject(page, inboxProject);
  await expect(card(page, title)).toBeVisible();
  await expect(card(page, title).getByRole("img", { name: MARK })).toHaveCount(0);
});

test("with the switch off the capture keeps the body's collection and asks no decision", async ({ page }) => {
  configureFakeModel();
  await page.goto("/app");
  const seed = await seedWorkspace(page, "manual");

  const title = `Checkout manual ${run} ${test.info().project.name}`;
  const id = `e2e_filing_${run}_${test.info().project.name}_manual`;
  const answer = await capture(page, { collectionId: seed.b.id, id, title });
  expect(answer.status).toBe(201);
  expect(answer.filing).toBeUndefined();
  expect(answer.destination.collectionId).toBe(seed.b.id);
  const stored = await storedSession(page, id);
  expect(stored.collectionId).toBe(seed.b.id);
  expect(stored.filedBy).toBeUndefined();
  expect(fake.decisionRequests).toEqual([]);
});
