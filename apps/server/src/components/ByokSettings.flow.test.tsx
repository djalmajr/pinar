// F5/S4: the request flow of the BYOK subpanel — what a late answer may and
// may not do to the form. There is no DOM in `bun test`, so the React hooks
// the subpanel uses are replaced by a small slot store: ByokSettings runs as
// a plain function, its effects run after each render, and the assertions
// read the props it hands to ByokSettingsPanel. bun test shares the module
// registry across the files of one process, so the react mock carries the
// real module's full surface and afterAll restores it (same pattern as
// ByokSettings.test.tsx).
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The icon virtual modules resolve under Vite alone (same scan as
// ByokSettings.test.tsx).
const ROOTS = [
  new URL("..", import.meta.url).pathname,
  new URL("../../../../packages/ui/src", import.meta.url).pathname,
];
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
for (const spec of new Set(ROOTS.flatMap(sourceFiles).flatMap((file) => readFileSync(file, "utf8").match(/~icons\/[a-z0-9-]+\/[a-z0-9-]+/g) ?? []))) {
  mock.module(spec, () => ({ default: () => null }));
}

type Effect = { cleanup?: void | (() => void); deps: unknown[] };
const slots: unknown[] = [];
const effects = new Map<number, Effect>();
let cursor = 0;
let pendingEffects: Array<() => void> = [];

function depsChanged(next: unknown[], previous: unknown[]): boolean {
  return next.length !== previous.length || next.some((value, index) => !Object.is(value, previous[index]));
}

const react = { ...(await import("react")) };
mock.module("react", () => ({
  ...react,
  useCallback(fn: unknown, deps: unknown[]) {
    const index = cursor++;
    const slot = slots[index] as { deps: unknown[]; fn: unknown } | undefined;
    if (slot === undefined || depsChanged(deps, slot.deps)) slots[index] = { deps, fn };
    return (slots[index] as { fn: unknown }).fn;
  },
  // The only context the subpanel reads is the i18n one; t is the identity.
  useContext: () => ({ language: "en", t: (key: string) => key }),
  useEffect(fn: () => void | (() => void), deps: unknown[]) {
    const index = cursor++;
    const previous = effects.get(index);
    if (previous !== undefined && !depsChanged(deps, previous.deps)) return;
    pendingEffects.push(() => {
      if (typeof previous?.cleanup === "function") previous.cleanup();
      effects.set(index, { cleanup: fn(), deps });
    });
  },
  useRef(initial: unknown) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useState(initial: unknown) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    const set = (next: unknown) => {
      slots[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(slots[index]) : next;
    };
    return [slots[index], set];
  },
}));

afterAll(() => {
  mock.module("react", () => react);
});

const { ByokSettings } = await import("./ByokSettings");

type PanelProps = {
  busy: string;
  drafts: { baseUrl: string; chatModel: string; embeddingModel: string; transcriptionModel: string };
  error: string | null;
  keyDraft: string;
  onDraftsChange: (drafts: PanelProps["drafts"]) => void;
  onSave: () => void;
  onTest: () => void;
  view: { capabilities: { chat: { testedAt: string | null } }; models: { chat: string | null } } | null;
};

function render(open = true) {
  cursor = 0;
  const element = ByokSettings({ open }) as { props: { children: Array<{ props: PanelProps }> } } | null;
  const work = pendingEffects;
  pendingEffects = [];
  for (const run of work) run();
  return element;
}

/** The props the subpanel hands to ByokSettingsPanel on a fresh render. */
function panel(): PanelProps {
  const element = render();
  if (element === null) throw new Error("the subpanel is hidden");
  return element.props.children[0]!.props;
}

async function settle() {
  for (let round = 0; round < 3; round++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function byokView(chatModel: string, testedAt: string | null = null) {
  const capability = { error: null, ok: testedAt === null ? null : true, testedAt };
  return {
    baseUrl: "https://provider.example.test/v1",
    capabilities: {
      chat: capability,
      embeddings: { ...capability, dims: null },
      tools: capability,
      transcription: capability,
      vision: capability,
    },
    configured: true,
    keyLast4: "abcd",
    models: { chat: chatModel, embedding: null, transcription: null },
    updatedAt: "2026-10-18T00:00:00.000Z",
  };
}

type Handler = (method: string, url: string, body: unknown) => Promise<Response>;
let calls: string[] = [];

function serve(handler: Handler) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = String(input);
    calls.push(`${method} ${url}`);
    return handler(method, url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
  }) as typeof fetch;
}

/** A response the test releases by hand. */
function held() {
  let release: (response: Response) => void = () => undefined;
  const response = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { release, response };
}

async function openWith(chatModel: string) {
  render();
  await settle();
  expect(panel().drafts.chatModel).toBe(chatModel);
}

beforeEach(() => {
  slots.length = 0;
  effects.clear();
  pendingEffects = [];
  cursor = 0;
  calls = [];
});

describe("ByokSettings request flow", () => {
  test("testing the saved settings updates the view and keeps the unsaved edits", async () => {
    serve(async (_method, url) =>
      url.endsWith("/test")
        ? Response.json(byokView("saved-model", "2026-10-18T12:00:00.000Z"))
        : Response.json(byokView("saved-model")));
    await openWith("saved-model");
    const before = panel();
    before.onDraftsChange({ ...before.drafts, chatModel: "my-unsaved-model" });

    panel().onTest();
    expect(panel().busy).toBe("testing");
    await settle();

    const after = panel();
    expect(after.busy).toBe("idle");
    expect(after.drafts.chatModel).toBe("my-unsaved-model");
    expect(after.view?.capabilities.chat.testedAt).toBe("2026-10-18T12:00:00.000Z");
  });

  test("a byok_changed answer is a change made elsewhere: it reloads the drafts too", async () => {
    serve(async (_method, url) =>
      url.endsWith("/test")
        ? Response.json({ code: "byok_changed", view: byokView("changed-elsewhere") }, { status: 409 })
        : Response.json(byokView("saved-model")));
    await openWith("saved-model");
    const before = panel();
    before.onDraftsChange({ ...before.drafts, chatModel: "my-unsaved-model" });

    panel().onTest();
    await settle();

    const after = panel();
    expect(after.drafts.chatModel).toBe("changed-elsewhere");
    expect(after.error).toBe("byok.errorChanged");
  });

  test("a test answer that lands after a close and reopen leaves the reopened form alone", async () => {
    const oldTest = held();
    const newTest = held();
    let tests = 0;
    serve(async (_method, url) => {
      if (!url.endsWith("/test")) return Response.json(byokView("current-model"));
      tests += 1;
      return tests === 1 ? oldTest.response : newTest.response;
    });
    await openWith("current-model");
    panel().onTest();
    await settle();
    expect(panel().busy).toBe("testing");

    // Close and reopen while the first test is still out.
    expect(render(false)).toBeNull();
    await openWith("current-model");
    const reopened = panel();
    expect(reopened.busy).toBe("idle");
    reopened.onDraftsChange({ ...reopened.drafts, chatModel: "unsaved-new-model" });
    // A second test starts in the reopened form.
    panel().onTest();
    expect(panel().busy).toBe("testing");

    oldTest.release(Response.json(byokView("old-test-model", "2026-10-17T00:00:00.000Z")));
    await settle();

    const after = panel();
    // The old answer changes nothing, and its finally does not end the new test.
    expect(after.drafts.chatModel).toBe("unsaved-new-model");
    expect(after.view?.models.chat).toBe("current-model");
    expect(after.view?.capabilities.chat.testedAt).toBeNull();
    expect(after.busy).toBe("testing");

    newTest.release(Response.json(byokView("current-model", "2026-10-18T12:00:00.000Z")));
    await settle();
    expect(panel().busy).toBe("idle");
    expect(panel().view?.capabilities.chat.testedAt).toBe("2026-10-18T12:00:00.000Z");
    expect(panel().drafts.chatModel).toBe("unsaved-new-model");
  });

  test("a save answer that lands after a close and reopen runs no test and clears nothing", async () => {
    const put = held();
    serve(async (method) => (method === "PUT" ? put.response : Response.json(byokView("current-model"))));
    await openWith("current-model");
    const before = panel();
    before.onDraftsChange({ ...before.drafts, chatModel: "saved-before-close" });
    panel().onSave();
    expect(panel().busy).toBe("saving");

    render(false);
    await openWith("current-model");
    const reopened = panel();
    reopened.onDraftsChange({ ...reopened.drafts, chatModel: "typed-after-reopen" });

    put.release(Response.json(byokView("saved-before-close")));
    await settle();

    const after = panel();
    expect(after.drafts.chatModel).toBe("typed-after-reopen");
    expect(after.busy).toBe("idle");
    expect(calls.filter((call) => call.startsWith("POST"))).toEqual([]);
  });
});
