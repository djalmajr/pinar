import { expect, test, type Page } from "@playwright/test";
import {
  e2eHomeDir,
  removeLocalAiSettings,
  startFakeModel,
  writeLocalAiSettings,
  type FakeModel,
} from "../helpers/assistant-fake-model";

// F2 in the browser: the real local server turns the fake model's write
// calls into proposals, and the cards confirm, undo and decline them through
// the real routes. ai.json is written straight into the e2e PINAR_HOME (see
// writeLocalAiSettings for why the AI settings routes are never used).
const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const home = e2eHomeDir();
// The e2e PINAR_HOME persists between runs: names and questions carry a
// per-run token so nothing matches what an earlier run left behind.
const run = Date.now().toString(36);
let fake: FakeModel;

test.skip(home === null, "the assistant suite needs the local e2e server and its PINAR_HOME");

test.beforeAll(async () => {
  fake = await startFakeModel();
});

test.afterAll(async () => {
  if (home) removeLocalAiSettings(home);
  await fake?.stop();
});

test.beforeEach(async ({ page }) => {
  fake.reset();
  if (home) removeLocalAiSettings(home);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("pinar-e2e-storage-ready")) return;
    localStorage.clear();
    sessionStorage.setItem("pinar-e2e-storage-ready", "true");
  });
});

function configureFakeModel() {
  if (home) writeLocalAiSettings(home, fake.endpoint);
}

function toggle(page: Page) {
  return page.getByRole("button", { exact: true, name: "Assistant" });
}

function panel(page: Page) {
  return page.getByRole("region", { name: "Assistant" });
}

// The open state persists, so after a reload the panel may already be open.
// On phones it is a modal sheet that hides the header toggle meanwhile.
async function openPanel(page: Page) {
  await expect(toggle(page).or(panel(page)).first()).toBeVisible();
  if (!(await panel(page).isVisible())) await toggle(page).click();
  await expect(panel(page)).toBeVisible();
}

async function ask(page: Page, question: string) {
  const composer = panel(page).getByRole("textbox", { name: "Ask the assistant…" });
  await composer.fill(question);
  await composer.press("Enter");
}

async function openHistory(page: Page) {
  const history = panel(page).getByRole("button", { exact: true, name: "Conversations" });
  if ((await history.getAttribute("aria-expanded")) !== "true") await history.click();
}

function threadButton(page: Page, title: string) {
  return panel(page).getByRole("button", { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
}

// A proposal card: the container of its translated action text.
function card(page: Page, actionText: string) {
  return panel(page).getByText(actionText, { exact: true }).locator("..");
}

interface Seed {
  a: { id: string; name: string };
  b: { id: string; name: string };
  session: { id: string; title: string };
}

// A project with collections A and B and one session (one pin) in A,
// created through the routes the workspace and the capture use.
async function seedWorkspace(page: Page, tag: string): Promise<Seed> {
  const label = `${run} ${test.info().project.name} ${tag}`;
  return page.evaluate(async ({ image, label, sessionId }) => {
    const post = async (path: string, body: unknown) => {
      const response = await fetch(path, { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method: "POST" });
      if (!response.ok) throw new Error(`${path} answered ${response.status}`);
      return response.json();
    };
    const { project } = await post("/api/projects", { name: `Proposals ${label}` });
    const { collection: a } = await post(`/api/projects/${project.id}/collections`, { name: `Alpha ${label}` });
    const { collection: b } = await post(`/api/projects/${project.id}/collections`, { name: `Beta ${label}` });
    const title = `Checkout ${label}`;
    await post("/api/shots", {
      collectionId: a.id,
      id: sessionId,
      image,
      page: { title, url: "https://example.test/checkout" },
      pins: [{ comment: "Button misaligned", kind: "element" }],
    });
    return { a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name }, session: { id: sessionId, title } };
  }, { image: VALID_PNG, label, sessionId: `e2e_prop_${run}_${test.info().project.name}_${tag}` });
}

// The collection the session is in, read through the session route.
function sessionCollection(page: Page, sessionId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
    if (!response.ok) return `status ${response.status}`;
    return ((await response.json()) as { session: { collectionId: string } }).session.collectionId;
  }, sessionId);
}

// The turn's answer is stored when the outcome settles; a new turn on the
// thread before that is refused, so wait for the stored messages.
async function waitForStoredMessages(page: Page, title: string, count: number) {
  await expect.poll(() => page.evaluate(async (threadTitle) => {
    const threads = (await (await fetch("/api/assistant/threads")).json()) as { threads: Array<{ id: string; title: string }> };
    const thread = threads.threads.find((item) => item.title === threadTitle);
    if (!thread) return 0;
    return ((await (await fetch(`/api/assistant/threads/${thread.id}`)).json()) as { messages: unknown[] }).messages.length;
  }, title)).toBe(count);
}

test("a proposed move is confirmed and undone on the card, and the final state survives a reload", async ({ page }) => {
  configureFakeModel();
  await page.goto("/app");
  const seed = await seedWorkspace(page, "move");
  fake.enqueue(
    { args: { collectionId: seed.b.id, sessionId: seed.session.id }, kind: "tool", name: "pinar_move_session" },
    { kind: "text", text: "I proposed the move; confirm it on the card." },
  );
  const question = `E2E proposal ${run} ${test.info().project.name}: move the checkout session`;
  const action = `Move the session “${seed.session.title}” to “${seed.b.name}”`;

  await test.step("the turn shows the card with names and Confirm / Decline, and nothing moved", async () => {
    await openPanel(page);
    await ask(page, question);
    await expect(panel(page).getByText("I proposed the move; confirm it on the card.")).toBeVisible();
    const proposal = card(page, action);
    await expect(proposal.getByRole("button", { name: "Confirm" })).toBeVisible();
    await expect(proposal.getByRole("button", { name: "Decline" })).toBeVisible();
    for (const id of [seed.session.id, seed.a.id, seed.b.id]) await expect(proposal).not.toContainText(id);
    expect(await sessionCollection(page, seed.session.id)).toBe(seed.a.id);
  });

  await test.step("Confirm: Done and Undo, and the session is in B", async () => {
    const proposal = card(page, action);
    await proposal.getByRole("button", { name: "Confirm" }).click();
    await expect(proposal.getByText("Done", { exact: true })).toBeVisible();
    await expect(proposal.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(proposal.getByRole("button", { name: "Confirm" })).toHaveCount(0);
    await expect.poll(() => sessionCollection(page, seed.session.id)).toBe(seed.b.id);
  });

  await test.step("Undo: Undone, and the session is back in A", async () => {
    const proposal = card(page, action);
    await proposal.getByRole("button", { name: "Undo" }).click();
    await expect(proposal.getByText("Undone", { exact: true })).toBeVisible();
    await expect(proposal.getByRole("button", { name: "Undo" })).toHaveCount(0);
    await expect.poll(() => sessionCollection(page, seed.session.id)).toBe(seed.a.id);
  });

  await test.step("reload and reopen the conversation: the card keeps its final state, no Confirm", async () => {
    await waitForStoredMessages(page, question, 2);
    await page.reload();
    await openPanel(page);
    await openHistory(page);
    await threadButton(page, question).click();
    const reopened = card(page, action);
    await expect(reopened.getByText("Undone", { exact: true })).toBeVisible();
    await expect(reopened.getByRole("button", { name: "Confirm" })).toHaveCount(0);
    await expect(reopened.getByRole("button", { name: "Undo" })).toHaveCount(0);
  });
});

test("Decline marks the proposal declined and changes nothing", async ({ page }) => {
  configureFakeModel();
  await page.goto("/app");
  const seed = await seedWorkspace(page, "decline");
  fake.enqueue(
    { args: { collectionId: seed.b.id, sessionId: seed.session.id }, kind: "tool", name: "pinar_move_session" },
    { kind: "text", text: "Here is a proposal you can decline." },
  );
  await openPanel(page);
  await ask(page, `E2E decline ${run} ${test.info().project.name}: move it`);
  const proposal = card(page, `Move the session “${seed.session.title}” to “${seed.b.name}”`);
  await proposal.getByRole("button", { name: "Decline" }).click();
  await expect(proposal.getByText("Declined", { exact: true })).toBeVisible();
  await expect(proposal.getByRole("button", { name: "Confirm" })).toHaveCount(0);
  expect(await sessionCollection(page, seed.session.id)).toBe(seed.a.id);
});

test("a delete proposal shows the irreversible warning", async ({ page }) => {
  configureFakeModel();
  await page.goto("/app");
  const seed = await seedWorkspace(page, "delete");
  fake.enqueue(
    { args: { sessionId: seed.session.id }, kind: "tool", name: "pinar_delete_session" },
    { kind: "text", text: "Deleting it removes the session and its pin for good; I proposed it." },
  );
  await openPanel(page);
  await ask(page, `E2E delete proposal ${run} ${test.info().project.name}: delete it`);
  const proposal = card(page, `Delete the session “${seed.session.title}” (1 pin)`);
  await expect(proposal.getByText("Can’t be undone", { exact: true })).toBeVisible();
  await expect(proposal.getByRole("button", { name: "Confirm" })).toBeVisible();
  // Not confirmed: the session is still there, where it was.
  expect(await sessionCollection(page, seed.session.id)).toBe(seed.a.id);
});

test("a question with options: clicking one sends it as the next message and the options go away", async ({ page }) => {
  configureFakeModel();
  const askQuestion = `Which collection, ${run}?`;
  const options = ["Alpha", "Beta", "Gamma"];
  fake.enqueue(
    { args: { options, question: askQuestion }, kind: "tool", name: "pinar_ask" },
    { kind: "text", text: "Beta it is." },
  );
  const question = `E2E ask ${run} ${test.info().project.name}: move my sessions`;
  await page.goto("/app");
  await openPanel(page);
  await ask(page, question);

  const group = panel(page).getByRole("group", { name: askQuestion });
  for (const option of options) await expect(group.getByRole("button", { exact: true, name: option })).toBeVisible();
  expect(fake.requests).toHaveLength(1);

  await waitForStoredMessages(page, question, 2);
  await group.getByRole("button", { exact: true, name: "Beta" }).click();
  await expect(panel(page).getByText("Beta it is.")).toBeVisible();
  await expect(group).toHaveCount(0);

  expect(fake.requests).toHaveLength(2);
  const lastUser = [...(fake.requests[1].messages ?? [])].reverse().find((message) => message.role === "user");
  expect(JSON.stringify(lastUser?.content)).toBe(JSON.stringify("Beta"));
});
