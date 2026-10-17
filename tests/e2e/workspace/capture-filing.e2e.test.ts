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
// routes are never used); the dialog's own AI settings requests, and their
// subroutes, are answered in the page in every test and never reach the
// server.
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
const INBOX_FALLBACK = "Without AI available, new captures go to the Inbox.";
const DESTINATION = "Capture destination";
let fake: FakeModel;
const createdSessions: string[] = [];
const createdCollections: string[] = [];
const createdProjects: string[] = [];
// Every AI settings request the common route answered, as "METHOD /path".
const aiSettingsRequests: string[] = [];

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
  // The dialog reads the AI settings whenever it opens and writes them from
  // its AI section. Here every such request, subroutes included, is answered
  // in the page and never forwarded: a read sees the AI switched off, and a
  // write is refused and fails the test in afterEach. A test that saves adds
  // its own route for that, which Playwright tries first.
  await page.route("**/api/ai/settings**", async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    aiSettingsRequests.push(`${method} ${path}`);
    if (method === "GET" && path === "/api/ai/settings") {
      await route.fulfill({ json: { apiKeyPreview: "", endpoint: "", hasApiKey: false, mode: "disabled", model: "", transcriptionModel: "" } });
      return;
    }
    await route.fulfill({ json: { error: "AI settings are not written in this suite", ok: false }, status: 403 });
  });
});

// Everything the test created, also after a failed assertion: the sessions
// by id, then the collections and the project; the setting goes back off and
// ai.json is removed. A step that fails does not stop the others: the test
// fails at the end with the list of what was left behind.
test.afterEach(async ({ request }) => {
  const leftovers: string[] = [];
  async function attempt(what: string, step: () => Promise<string | null>) {
    try {
      const problem = await step();
      if (problem) leftovers.push(`${what}: ${problem}`);
    } catch (error) {
      leftovers.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const deleted = (path: string, accepted: number[]) => async () => {
    const status = (await request.delete(path)).status();
    return accepted.includes(status) ? null : `DELETE answered ${status}`;
  };
  await attempt("the setting back off", async () => {
    const response = await request.patch("/api/preferences", { data: { autoCaptureDestination: false } });
    return response.ok() ? null : `PATCH answered ${response.status()}`;
  });
  await attempt("ai.json", async () => {
    if (home) removeLocalAiSettings(home);
    return null;
  });
  for (const id of createdSessions.splice(0)) {
    // 404: a capture that failed before it was saved.
    await attempt(`session ${id}`, deleted(`/api/history/${encodeURIComponent(id)}`, [200, 404]));
  }
  for (const id of createdCollections.splice(0)) {
    await attempt(`collection ${id}`, deleted(`/api/collections/${encodeURIComponent(id)}`, [200]));
  }
  for (const id of createdProjects.splice(0)) {
    await attempt(`project ${id}`, deleted(`/api/projects/${encodeURIComponent(id)}`, [200]));
  }
  const writes = aiSettingsRequests.splice(0).filter((entry) => !entry.startsWith("GET "));
  expect(leftovers, "cleanup left these behind").toEqual([]);
  expect(writes, "AI settings writes no test answered").toEqual([]);
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

// One POST from the page, the way the workspace and the capture send it.
async function postFromPage<T>(page: Page, path: string, body: unknown): Promise<T> {
  return page.evaluate(async ({ body, path }) => {
    const response = await fetch(path, { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method: "POST" });
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    return response.json();
  }, { body, path });
}

// A project with collections A and B, each with example captures, created
// through the routes the workspace and the capture use while the setting is
// off, plus the Inbox the capture falls back to. Each resource joins the
// cleanup lists as soon as it exists (an example capture, whose id is known,
// just before its POST), so a seed that fails halfway leaves nothing behind.
async function seedWorkspace(page: Page, tag: string): Promise<Seed> {
  const label = `${run} ${test.info().project.name} ${tag}`;
  const prefix = `e2e_filing_${run}_${test.info().project.name}_${tag}`;
  type Named = { id: string; name: string };
  const { project } = await postFromPage<{ project: Named }>(page, "/api/projects", { name: `Filing ${label}` });
  createdProjects.push(project.id);
  const { collection: a } = await postFromPage<{ collection: Named }>(page, `/api/projects/${project.id}/collections`, { name: `Design ${label}` });
  createdCollections.push(a.id);
  const { collection: b } = await postFromPage<{ collection: Named }>(page, `/api/projects/${project.id}/collections`, { name: `Research ${label}` });
  createdCollections.push(b.id);
  const examples = [
    { collectionId: a.id, id: `${prefix}_example_a1`, title: `Checkout button spacing ${label}` },
    { collectionId: a.id, id: `${prefix}_example_a2`, title: `Cart header alignment ${label}` },
    { collectionId: b.id, id: `${prefix}_example_b1`, title: `Pricing copy interview ${label}` },
  ];
  for (const example of examples) {
    createdSessions.push(example.id);
    await postFromPage(page, "/api/shots", {
      collectionId: example.collectionId,
      id: example.id,
      image: VALID_PNG,
      page: { title: example.title, url: "https://example.test/examples" },
      pins: [{ comment: "Example pin", kind: "element" }],
    });
  }
  const inboxId = await page.evaluate(async () => {
    const tree = (await (await fetch("/api/project-tree")).json()) as {
      tree: { projects: Array<{ collections: Array<{ id: string; isProtected: boolean }>; isProtected: boolean }> };
    };
    return tree.tree.projects.find((item) => item.isProtected)?.collections.find((item) => item.isProtected)?.id ?? "";
  });
  expect(inboxId, "the protected Inbox exists").not.toBe("");
  return {
    a: { id: a.id, label: `${project.name} / ${a.name}`, name: a.name },
    b: { id: b.id, label: `${project.name} / ${b.name}`, name: b.name },
    inboxId,
    project: { id: project.id, name: project.name },
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

// The mark takes keyboard focus: Shift+Tab from the page link right after it
// lands on it and opens the tooltip.
async function expectMarkFromKeyboard(page: Page, scope: Locator) {
  await scope.getByRole("link").first().focus();
  await page.keyboard.press("Shift+Tab");
  await expect(scope.getByRole("img", { name: MARK })).toBeFocused();
  const tooltip = page.getByRole("tooltip").last();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText(MARK);
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

test("a preferences read that started before the switch was saved does not turn it back off", async ({ page, request }) => {
  // Save in the AI section succeeds in the page, as in the test above.
  await page.route("**/api/ai/settings", async (route) => {
    await route.fulfill(route.request().method() === "PATCH"
      ? { json: { apiKeyPreview: "", hasApiKey: false, ok: true, tested: { model: "fake-model" } } }
      : { json: { apiKeyPreview: "", endpoint: fake.endpoint, hasApiKey: false, mode: "local", model: "fake-model", transcriptionModel: "" } });
  });
  // Every read says the server can choose, so the switch is usable from the
  // start. The first read after the save is answered by the server at once,
  // with the switch still off, and held in the page until released.
  let holdNextRead = false;
  let heldReads = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/preferences", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    if (route.request().method() === "GET" && holdNextRead) {
      holdNextRead = false;
      heldReads += 1;
      await held;
    }
    await route.fulfill({ json: { ...body, autoCaptureDestinationAvailable: true }, status: response.status() });
  });
  try {
    await page.goto("/app");
    const dialog = await openCaptureSettings(page);
    await settingsSection(dialog, "AI Assistant").click();
    holdNextRead = true;
    await dialog.getByRole("button", { exact: true, name: "Save" }).filter({ visible: true }).click();
    await expect.poll(() => heldReads).toBe(1);

    await settingsSection(dialog, "Capture").click();
    const toggle = dialog.getByRole("switch", { name: SWITCH });
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect.poll(() => storedAutomatic(request)).toBe(true);

    // The held read now answers "off": it started before the save, so the
    // switch stays on.
    const staleAnswer = page.waitForEvent("requestfinished", (finished) =>
      finished.method() === "GET" && new URL(finished.url()).pathname === "/api/preferences");
    release();
    await staleAnswer;
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    await expect(toggle).toBeChecked();
    await expect(dialog.getByRole("combobox", { name: DESTINATION })).toBeDisabled();
    expect(await storedAutomatic(request)).toBe(true);
  } finally {
    release();
  }
});

test("with the setting on and the AI removed, the switch shows on, can be turned off, and the selector stays locked until then", async ({ page, request }) => {
  await page.goto("/app");
  const seed = await seedWorkspace(page, "no-ai");
  await setAutomatic(request, true);
  // No ai.json (beforeEach removed it): the server cannot choose, yet the
  // setting stays saved on, and a new capture goes to the Inbox without
  // asking anything (A45).
  const id = `e2e_filing_${run}_${test.info().project.name}_no_ai`;
  const answer = await capture(page, { collectionId: seed.a.id, id, title: `Checkout without AI ${run} ${test.info().project.name}` });
  expect(answer.status).toBe(201);
  expect(answer.filing).toEqual({ collectionId: null, confidence: 0, engine: "none", reason: "error" });
  expect(answer.destination.collectionId).toBe(seed.inboxId);
  const stored = await storedSession(page, id);
  expect(stored.collectionId).toBe(seed.inboxId);
  expect(stored.filedBy).toBeUndefined();
  expect(fake.decisionRequests).toHaveLength(0);

  await page.goto("/app");
  const dialog = await openCaptureSettings(page);
  // Opening the dialog reads the AI settings: the common route answered it.
  await expect.poll(() => aiSettingsRequests).toContain("GET /api/ai/settings");
  const toggle = dialog.getByRole("switch", { name: SWITCH });
  const destination = dialog.getByRole("combobox", { name: DESTINATION });
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeEnabled();
  await expect(destination).toBeDisabled();
  await expect(dialog.getByText(INBOX_FALLBACK)).toBeVisible();
  await expect(dialog.getByText(UNAVAILABLE)).toHaveCount(0);

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(() => storedAutomatic(request)).toBe(false);
  await expect(destination).toBeEnabled();
  // Off and still unavailable: it cannot be turned back on here.
  await expect(toggle).toBeDisabled();
  await expect(dialog.getByText(UNAVAILABLE)).toBeVisible();
  await expect(dialog.getByText(INBOX_FALLBACK)).toHaveCount(0);
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
  await expectMarkFromKeyboard(page, card(page, title));
  // A click on the mark stays there: the session viewer does not open.
  await card(page, title).getByRole("img", { name: MARK }).click();
  await page.waitForTimeout(300);
  expect(new URL(page.url()).searchParams.get("session")).toBeNull();
  await page.keyboard.press("Escape");

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
