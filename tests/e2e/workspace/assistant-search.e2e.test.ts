import { expect, test, type Page } from "@playwright/test";
import {
  e2eHomeDir,
  FAKE_EMBEDDING_DIMENSIONS,
  FAKE_EMBEDDING_MODEL,
  fakeEmbedding,
  removeLocalAiSettings,
  startFakeModel,
  writeLocalAiSettings,
  type FakeModel,
} from "../helpers/assistant-fake-model";

// F3 in the browser: the person asks what the pins say, the fake model calls
// pinar_pins_search, and the real local server indexes the sessions and
// searches them before the tool result goes back to the model. With an
// embedding model in /v1/models the search ranks by the fake embeddings;
// without one it ranks by text. ai.json is written straight into the e2e
// PINAR_HOME (see writeLocalAiSettings for why the AI settings routes are
// never used).
const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const home = e2eHomeDir();
// The e2e PINAR_HOME persists between runs: titles, ids and questions carry
// a per-run token, and every test deletes the sessions it created.
const run = Date.now().toString(36);
const QUERY = "contraste do botão";
// The pin the search must find first. It says contrast and button twice, so
// it stays ahead of any other document that shares one of those words.
const CONTRAST_COMMENT = "Contraste do botão: o botão de pagar tem pouco contraste";
const OTHER_COMMENT = "O menu lateral some no celular";
// The first search indexes every session of the e2e home before it ranks.
const ANSWER_TIMEOUT_MS = 15_000;
let withEmbeddings: FakeModel;
let textOnly: FakeModel;
const created: string[] = [];

test.skip(home === null, "the assistant suite needs the local e2e server and its PINAR_HOME");

test.beforeAll(async () => {
  withEmbeddings = await startFakeModel({ embeddings: true });
  textOnly = await startFakeModel();
});

test.afterAll(async () => {
  if (home) removeLocalAiSettings(home);
  await withEmbeddings?.stop();
  await textOnly?.stop();
});

test.beforeEach(async ({ page }) => {
  withEmbeddings.reset();
  textOnly.reset();
  if (home) removeLocalAiSettings(home);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("pinar-e2e-storage-ready")) return;
    localStorage.clear();
    sessionStorage.setItem("pinar-e2e-storage-ready", "true");
  });
});

// The sessions this test created, by id, through the route the workspace
// deletes sessions with; also after a failed assertion.
test.afterEach(async ({ page }) => {
  const ids = created.splice(0);
  if (ids.length === 0) return;
  if (!page.url().startsWith("http")) await page.goto("/app");
  const statuses = await page.evaluate(
    (list) => Promise.all(list.map(async (id) => (await fetch(`/api/history/${encodeURIComponent(id)}`, { method: "DELETE" })).status)),
    ids,
  );
  // 404: a seed that failed before creating that session.
  for (const status of statuses) expect([200, 404]).toContain(status);
});

function configure(fake: FakeModel) {
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

interface SeededSession {
  id: string;
  pinId: string;
  title: string;
}

// Two sessions with one pin each, saved through the capture route: one pin
// talks about the button contrast, the other about something else. The pin
// id is read back through the session route, as the search source reads it
// (pinId, else id).
async function seedSessions(page: Page, tag: string): Promise<{ contrast: SeededSession; other: SeededSession }> {
  const label = `${run} ${test.info().project.name} ${tag}`;
  const prefix = `e2e_search_${run}_${test.info().project.name}_${tag}`;
  const sessions = [
    { comment: CONTRAST_COMMENT, id: `${prefix}_contrast`, title: `Checkout ${label}`, url: "https://example.test/checkout" },
    { comment: OTHER_COMMENT, id: `${prefix}_other`, title: `Menu ${label}`, url: "https://example.test/menu" },
  ];
  created.push(...sessions.map((session) => session.id));
  const seeded = await page.evaluate(async ({ image, sessions }) => {
    const result: Array<{ id: string; pinId: string; title: string }> = [];
    for (const session of sessions) {
      const response = await fetch("/api/shots", {
        body: JSON.stringify({
          id: session.id,
          image,
          page: { title: session.title, url: session.url },
          pins: [{ comment: session.comment, kind: "element" }],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error(`/api/shots answered ${response.status}`);
      const read = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`);
      if (!read.ok) throw new Error(`/api/sessions answered ${read.status}`);
      const body = (await read.json()) as { session: { pins: Array<{ id?: string; pinId?: string }> } };
      const pin = body.session.pins[0];
      result.push({ id: session.id, pinId: pin?.pinId || pin?.id || "", title: session.title });
    }
    return result;
  }, { image: VALID_PNG, sessions });
  for (const session of seeded) expect(session.pinId, `${session.title} has a pin id`).not.toBe("");
  return { contrast: seeded[0]!, other: seeded[1]! };
}

interface SearchHit {
  caption: string | null;
  comment: string;
  pin: number;
  pinId: string;
  score: number;
  session: string;
  sessionId: string;
  url: string;
}

// The hits the server sent back to the model: the tool message of the
// second chat request, its <dados> block unescaped (&amp; &lt; &gt;) and
// parsed.
function searchHits(fake: FakeModel): SearchHit[] {
  const toolMessage = fake.requests[1]?.messages?.find((message) => message.role === "tool");
  expect(toolMessage, "the second request carries the tool result").toBeTruthy();
  let text = typeof toolMessage?.content === "string" ? toolMessage.content : JSON.stringify(toolMessage?.content);
  try {
    const parsed = JSON.parse(text) as { data?: unknown };
    if (typeof parsed.data === "string") text = parsed.data;
  } catch {
    // Already the text of the result.
  }
  const block = /<dados>([\s\S]*)<\/dados>/.exec(text);
  expect(block, "the tool result is inside <dados>").toBeTruthy();
  const data = block![1]!.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  return (JSON.parse(data) as { hits: SearchHit[] }).hits;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  a.forEach((value, index) => {
    dot += value * b[index]!;
    normA += value * value;
    normB += b[index]! * b[index]!;
  });
  return dot / Math.sqrt(normA * normB);
}

async function askAboutContrast(page: Page, fake: FakeModel, tag: string) {
  await page.goto("/app");
  const seed = await seedSessions(page, tag);
  const answer = `O contraste do botão aparece em “${seed.contrast.title}”.`;
  fake.enqueue(
    { args: { query: QUERY }, kind: "tool", name: "pinar_pins_search" },
    { kind: "text", text: answer },
  );
  await openPanel(page);
  await ask(page, `E2E search ${run} ${test.info().project.name} ${tag}: onde comentei sobre contraste do botão?`);
  await expect(panel(page).getByText(answer)).toBeVisible({ timeout: ANSWER_TIMEOUT_MS });

  expect(fake.requests).toHaveLength(2);
  const offered = (fake.requests[0]?.tools ?? []).map((entry) => entry.function?.name);
  expect(offered, "the turn offers the pin search").toContain("pinar_pins_search");
  const hits = searchHits(fake);
  expect(hits[0], "the contrast pin comes first").toMatchObject({
    comment: CONTRAST_COMMENT,
    pin: 1,
    pinId: seed.contrast.pinId,
    session: seed.contrast.title,
    sessionId: seed.contrast.id,
  });
  expect(hits.findIndex((hit) => hit.sessionId === seed.other.id), "the other session is not ahead").not.toBe(0);
  return { hits, seed };
}

test("a question about what the pins say is answered from pinar_pins_search ranked by embeddings", async ({ page }) => {
  configure(withEmbeddings);
  const { hits, seed } = await askAboutContrast(page, withEmbeddings, "embeddings");

  const requests = withEmbeddings.embeddingRequests;
  for (const request of requests) {
    expect(request.model).toBe(FAKE_EMBEDDING_MODEL);
    expect(request.dimensions).toBe(FAKE_EMBEDDING_DIMENSIONS);
  }
  // The contrast pin's document is embedded before the question is.
  const documentAt = requests.findIndex(
    (request) => request.prompt_name === "document" && (request.input ?? []).some((text) => text.includes(`Pin #1: ${CONTRAST_COMMENT}`)),
  );
  const queryAt = requests.findIndex((request) => request.prompt_name === "query");
  expect(documentAt, `the document of “${seed.contrast.title}” is embedded`).toBeGreaterThanOrEqual(0);
  expect(queryAt, "the question is embedded").toBeGreaterThan(documentAt);
  expect(requests[queryAt]?.input).toEqual([QUERY]);
  // Ranked by the cosine of the fake embeddings, not by the text fallback
  // (whose score would be 1): the score is the cosine of the question and
  // of the document the server embedded, with two decimals.
  const documentText = (requests[documentAt]?.input ?? []).find((text) => text.includes(`Pin #1: ${CONTRAST_COMMENT}`))!;
  const expectedScore = Math.round(cosine(fakeEmbedding(QUERY), fakeEmbedding(documentText)) * 100) / 100;
  expect(expectedScore).toBeLessThan(1);
  expect(hits[0]?.score).toBe(expectedScore);
});

test("without an embedding model the same turn finds the pin by text and embeds nothing", async ({ page }) => {
  configure(textOnly);
  const { hits } = await askAboutContrast(page, textOnly, "text");
  // The text ranking: every term of the question is in the pin.
  expect(hits[0]?.score).toBe(1);
  expect(textOnly.embeddingRequests).toEqual([]);
});
