// The new-collection dialog before and after the project tree lands. There
// is no DOM in `bun test`, so the React hooks are replaced by a small slot
// store (same pattern as ByokSettings.flow.test.tsx): WorkspaceChrome runs as
// a plain function, its effects run after each render, and the assertions
// read the props of the elements it returns. bun test shares the module
// registry across the files of one process, so each mock keeps the real
// module's full surface and afterAll restores it.
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";

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

type Effect = { cleanup?: void | (() => void); deps: unknown[] | undefined };
let slots: unknown[] = [];
let effects = new Map<number, Effect>();
let cursor = 0;
let pendingEffects: Array<() => void> = [];

function depsChanged(next: unknown[] | undefined, previous: unknown[] | undefined): boolean {
  if (next === undefined || previous === undefined) return true;
  return next.length !== previous.length || next.some((value, index) => !Object.is(value, previous[index]));
}

const translate = (key: string) => key;
const react = { ...(await import("react")) };
mock.module("react", () => ({
  ...react,
  useCallback(fn: unknown, deps: unknown[]) {
    const index = cursor++;
    const slot = slots[index] as { deps: unknown[]; value: unknown } | undefined;
    if (slot === undefined || depsChanged(deps, slot.deps)) slots[index] = { deps, value: fn };
    return (slots[index] as { value: unknown }).value;
  },
  // Each context reads its default value; the i18n one (default null)
  // gets the identity t.
  useContext: (context: { _currentValue?: unknown }) => context._currentValue ?? { language: "en", t: translate },
  useEffect(fn: () => void | (() => void), deps?: unknown[]) {
    const index = cursor++;
    const previous = effects.get(index);
    if (previous !== undefined && !depsChanged(deps, previous.deps)) return;
    pendingEffects.push(() => {
      if (typeof previous?.cleanup === "function") previous.cleanup();
      effects.set(index, { cleanup: fn(), deps });
    });
  },
  useMemo(fn: () => unknown, deps: unknown[]) {
    const index = cursor++;
    const slot = slots[index] as { deps: unknown[]; value: unknown } | undefined;
    if (slot === undefined || depsChanged(deps, slot.deps)) slots[index] = { deps, value: fn() };
    return (slots[index] as { value: unknown }).value;
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

const router = { ...(await import("@tanstack/react-router")) };
mock.module("@tanstack/react-router", () => ({ ...router, useNavigate: () => () => undefined }));

afterAll(() => {
  mock.module("react", () => react);
  mock.module("@tanstack/react-router", () => router);
});

const { WorkspaceChrome } = await import("./WorkspaceChrome");
const { Dialog } = await import("@pinar/ui");
const { HistorySidebar } = await import("@/components/HistorySidebar");

const NOW = "2026-10-19T12:00:00.000Z";
const PROJECT = {
  collections: [],
  createdAt: NOW,
  icon: "folder",
  id: "prj_1",
  isProtected: false,
  name: "Project",
  ownerId: "usr_1",
  position: 0,
  updatedAt: NOW,
};

interface Call { method: string; path: string }
let calls: Call[] = [];
let releaseTree: (() => void) | null = null;
const realFetch = globalThis.fetch;

// The tree either answers at once or waits until releaseTree() is called.
function installFetch(tree: "loaded" | "pending") {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, path });
    if (path === "/api/project-tree") {
      if (tree === "pending") await new Promise<void>((resolve) => { releaseTree = resolve; });
      return Response.json({ tree: { projects: [PROJECT] } });
    }
    if (method === "POST" && path === `/api/projects/${PROJECT.id}/collections`) {
      return Response.json({ collection: { ...PROJECT, icon: undefined, id: "col_1", name: "Roadmap", parentId: null, projectId: PROJECT.id } }, { status: 201 });
    }
    return Response.json({}, { status: 404 });
  }) as typeof fetch;
}

let tree: ReactElement;
function render() {
  cursor = 0;
  tree = WorkspaceChrome({ children: null }) as ReactElement;
  const run = pendingEffects;
  pendingEffects = [];
  for (const effect of run) effect();
}

async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    render();
  }
}

function elements(node: unknown, found: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found);
  } else if (node && typeof node === "object" && "props" in node) {
    const element = node as ReactElement<Record<string, unknown>>;
    found.push(element);
    for (const value of Object.values(element.props)) elements(value, found);
  }
  return found;
}

function find(predicate: (element: ReactElement<Record<string, unknown>>) => boolean) {
  const match = elements(tree).find((element) => predicate(element as ReactElement<Record<string, unknown>>));
  if (!match) throw new Error("element not found");
  return match as ReactElement<Record<string, unknown>>;
}

const dialog = () => find((element) => element.type === Dialog);
const submitButton = () => find((element) => element.props.type === "submit");
const form = () => find((element) => element.type === "form");
const errorAlert = () => elements(tree).find((element) => (element.props as { role?: string }).role === "alert") as ReactElement<{ children?: unknown }> | undefined;
const collectionPosts = () => calls.filter((call) => call.method === "POST" && call.path.endsWith("/collections"));

async function openNewCollection(name: string) {
  (find((element) => element.type === HistorySidebar).props.onCreate as (kind: string) => void)("collection");
  render();
  (find((element) => element.props["aria-label"] === "dashboard.name").props.onChange as (event: unknown) => void)({ target: { value: name } });
  render();
}

async function forceSubmit() {
  (form().props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
  await settle();
}

// The browser globals the component reads. The page is hidden, so the tree
// poll never arms its interval.
const BROWSER_GLOBALS = ["document", "localStorage", "window"] as const;
function installBrowserGlobals() {
  const storage = new Map<string, string>();
  const listeners = { addEventListener() {}, removeEventListener() {} };
  const values = {
    document: { ...listeners, body: { style: { cursor: "" } }, documentElement: { getAttribute: () => null, removeAttribute() {}, setAttribute() {} }, visibilityState: "hidden" },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => void storage.delete(key),
      setItem: (key: string, value: string) => void storage.set(key, value),
    },
    window: { ...listeners, clearInterval() {}, location: { origin: "http://127.0.0.1" }, setInterval: () => 0 },
  };
  for (const name of BROWSER_GLOBALS) Object.defineProperty(globalThis, name, { configurable: true, value: values[name], writable: true });
}

beforeEach(() => {
  slots = [];
  effects = new Map();
  pendingEffects = [];
  calls = [];
  releaseTree = null;
  installBrowserGlobals();
});

// A tree left pending stays pending: answering it after the globals are gone
// would run the component against a removed localStorage.
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const name of BROWSER_GLOBALS) delete (globalThis as Record<string, unknown>)[name];
});

describe("WorkspaceChrome new collection before the project tree lands", () => {
  test("keeps Create disabled and the typed name, and sends no POST", async () => {
    installFetch("pending");
    render();
    await settle();
    await openNewCollection("Roadmap");

    expect(dialog().props.open).toBe(true);
    expect(submitButton().props.disabled).toBe(true);
    expect(find((element) => element.props["aria-label"] === "dashboard.name").props.value).toBe("Roadmap");
    expect(collectionPosts()).toEqual([]);

    // The tree lands: the same dialog, with the same name, can now create.
    releaseTree?.();
    await settle();
    expect(submitButton().props.disabled).toBe(false);
    expect(find((element) => element.props["aria-label"] === "dashboard.name").props.value).toBe("Roadmap");
  });

  test("a forced submit without a project keeps the dialog open with the error and sends no POST", async () => {
    installFetch("pending");
    render();
    await settle();
    await openNewCollection("Roadmap");
    await forceSubmit();

    expect(dialog().props.open).toBe(true);
    expect(errorAlert()?.props.children).toBe("dashboard.containerSaveFailed");
    expect(collectionPosts()).toEqual([]);
  });

  test("with the project loaded, Create posts the collection and closes the dialog", async () => {
    installFetch("loaded");
    render();
    await settle();
    await openNewCollection("Roadmap");

    expect(submitButton().props.disabled).toBe(false);
    await forceSubmit();

    expect(collectionPosts()).toEqual([{ method: "POST", path: `/api/projects/${PROJECT.id}/collections` }]);
    expect(dialog().props.open).toBe(false);
    expect(errorAlert()).toBeUndefined();
  });
});
