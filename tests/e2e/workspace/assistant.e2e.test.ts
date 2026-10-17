import { expect, test, type Page } from "@playwright/test";
import {
  e2eHomeDir,
  removeLocalAiSettings,
  startFakeModel,
  writeLocalAiSettings,
  type FakeModel,
} from "../helpers/assistant-fake-model";
import { isMobileViewport } from "../helpers/ui";

// The real local server answers the assistant routes; the model is a fake
// OpenAI-compatible server in this process. ai.json is written straight into
// the e2e PINAR_HOME (see writeLocalAiSettings for why the settings routes
// are never used).
const home = e2eHomeDir();
// The e2e PINAR_HOME persists between runs: questions carry a per-run token
// so a title never matches a conversation left by an earlier run.
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

test("without AI configured the toggle opens a panel that points to the AI settings", async ({ page }) => {
  await page.goto("/app");
  const button = toggle(page);
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "false");

  await button.click();
  // On phones the panel is a modal sheet: the toggle behind it leaves the
  // accessibility tree while the sheet is open.
  if (!isMobileViewport(page)) await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(panel(page).getByText("Set up AI in Settings to use the assistant.")).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Open AI settings" })).toBeVisible();
  await expect(panel(page).getByRole("textbox", { name: "Ask the assistant…" })).toHaveCount(0);

  await panel(page).getByRole("button", { name: "Close assistant" }).click();
  await expect(panel(page)).toBeHidden();
  await expect(button).toHaveAttribute("aria-expanded", "false");
});

test("a question streams the answer, lands in the history and reopens after a reload", async ({ page }) => {
  configureFakeModel();
  const question = `E2E history ${run} ${test.info().project.name}: how many projects?`;
  fake.enqueue({ kind: "text", text: "You have one project, Personal." });

  await page.goto("/app");
  await openPanel(page);
  await expect(panel(page).getByText("Ask about your projects, collections, sessions and pins.")).toBeVisible();
  await ask(page, question);
  await expect(panel(page).getByText("You have one project, Personal.")).toBeVisible();

  await openHistory(page);
  await expect(threadButton(page, question)).toBeVisible();

  await page.reload();
  await openPanel(page);
  await openHistory(page);
  await threadButton(page, question).click();
  await expect(panel(page).getByText(question, { exact: true })).toBeVisible();
  await expect(panel(page).getByText("You have one project, Personal.")).toBeVisible();
});

test("a read tool result goes back to the model inside <dados> before the final answer", async ({ page }) => {
  configureFakeModel();
  fake.enqueue(
    { args: {}, kind: "tool", name: "pinar_list_projects" },
    { kind: "text", text: "I found the Personal project." },
  );

  await page.goto("/app");
  await openPanel(page);
  await ask(page, `E2E tool ${run} ${test.info().project.name}: list my projects`);
  await expect(panel(page).getByText("I found the Personal project.")).toBeVisible();

  expect(fake.requests).toHaveLength(2);
  const toolMessage = fake.requests[1].messages?.find((message) => message.role === "tool");
  expect(toolMessage, "the second request carries the tool result").toBeTruthy();
  const content = JSON.stringify(toolMessage?.content);
  expect(content).toContain("<dados>");
  expect(content).toContain("Personal");
});

test("a model failure shows the translated error, never the raw one, and the question can be asked again", async ({ page }) => {
  configureFakeModel();
  fake.enqueue(
    { body: "SYNTHETIC_PROVIDER_FAILURE", kind: "fail", status: 500 },
    { kind: "text", text: "It worked this time." },
  );

  await page.goto("/app");
  await openPanel(page);
  await ask(page, `E2E failure ${run} ${test.info().project.name}: anything`);
  const alert = panel(page).getByRole("alert").filter({ hasText: "The assistant is unavailable right now." });
  await expect(alert).toBeVisible();
  await expect(page.getByText("SYNTHETIC_PROVIDER_FAILURE")).toHaveCount(0);

  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(panel(page).getByText("It worked this time.")).toBeVisible();
});

test("deleting a conversation removes it from the list and from the API", async ({ page }) => {
  configureFakeModel();
  const question = `E2E delete ${run} ${test.info().project.name}: temporary question`;
  fake.enqueue({ kind: "text", text: "A short answer." });

  await page.goto("/app");
  await openPanel(page);
  await ask(page, question);
  await expect(panel(page).getByText("A short answer.")).toBeVisible();

  const threadId = await page.evaluate(async (title) => {
    const response = await fetch("/api/assistant/threads");
    const body = await response.json() as { threads: Array<{ id: string; title: string }> };
    return body.threads.find((thread) => thread.title === title)?.id ?? null;
  }, question);
  expect(threadId).toBeTruthy();

  await openHistory(page);
  const row = panel(page).getByRole("listitem").filter({ hasText: question });
  await row.getByRole("button", { name: "Delete conversation" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete conversation" }).click();
  await expect(row).toHaveCount(0);

  const status = await page.evaluate(async (id) => (await fetch(`/api/assistant/threads/${id}`)).status, threadId);
  expect(status).toBe(404);
});
