/**
 * SSR HTML checks for the auth state in the first paint: the server-rendered
 * HTML of `/` and `/pricing` must already carry the signed-in/signed-out
 * state (header CTA + Fair Source support card), so nothing swaps after
 * hydration.
 *
 * The test renders the real route tree with the real root loader
 * (`beforeLoad` language + `loader` messages/session resolution) through the
 * TanStack SSR renderers, with the SSR request context
 * (`@tanstack/react-start/server`) and the API surface (`@/server/api`)
 * provided by the test: the session always resolves through the real
 * `handleCloudApiRequest` / `handleLocalApiRequest` handlers.
 */
import { afterAll, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// SSR request context doubles
// ---------------------------------------------------------------------------
const ssrRequest = {
  cookie: null as string | null,
  url: new URL("https://pinar.test/?lang=en"),
};
let ssrResponseHeaders = new Headers();

type SsrResponseHeaderSetter = (name: string, value: string) => void;
const ssrResponseHeaderSetter: SsrResponseHeaderSetter = (name, value) => {
  ssrResponseHeaders.set(name, value);
};

mock.module("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) =>
    name.toLowerCase() === "cookie" ? ssrRequest.cookie ?? undefined : undefined,
  getRequestUrl: () => ssrRequest.url,
  getResponseHeader: (name: string) => ssrResponseHeaders.get(name) ?? undefined,
  setResponseHeader: ssrResponseHeaderSetter,
}));

type ApiHandler = (request: Request) => Promise<Response>;
const apiSurface = {
  cloud: null as ApiHandler | null,
  local: false,
  localHandler: null as ApiHandler | null,
};

// `@/server/api` is aliased to the running surface at build time; the tests
// wire it to the real Cloud (in-memory env) or local handlers.
mock.module("@/server/api", () => ({
  authorizeAppRequest: () => ({ allowed: true, reason: null, userId: null }),
  handleApiRequest: (request: Request) => {
    const handler = apiSurface.local ? apiSurface.localHandler : apiSurface.cloud;
    if (!handler) throw new Error("test: API surface handler not wired");
    return handler(request);
  },
  handlePublicRequest: () => new Response("Not found", { status: 404 }),
}));

// unplugin-icons virtual modules do not resolve outside Vite.
const ICON_SPECS = [
  "~icons/lucide/arrow-down",
  "~icons/lucide/arrow-left",
  "~icons/lucide/arrow-right",
  "~icons/lucide/arrow-up",
  "~icons/lucide/bot",
  "~icons/lucide/calendar-clock",
  "~icons/lucide/calendar-days",
  "~icons/lucide/check",
  "~icons/lucide/chevron-down",
  "~icons/lucide/chevron-left",
  "~icons/lucide/chevron-right",
  "~icons/lucide/chevron-up",
  "~icons/lucide/chevrons-up-down",
  "~icons/lucide/circle-alert",
  "~icons/lucide/circle-check",
  "~icons/lucide/circle-check-big",
  "~icons/lucide/circle-help",
  "~icons/lucide/clock-3",
  "~icons/lucide/cloud",
  "~icons/lucide/code-xml",
  "~icons/lucide/coffee",
  "~icons/lucide/coins",
  "~icons/lucide/columns-3",
  "~icons/lucide/command",
  "~icons/lucide/copy",
  "~icons/lucide/credit-card",
  "~icons/lucide/database",
  "~icons/lucide/download",
  "~icons/lucide/ellipsis-vertical",
  "~icons/lucide/external-link",
  "~icons/lucide/file-text",
  "~icons/lucide/folder",
  "~icons/lucide/folder-input",
  "~icons/lucide/folder-kanban",
  "~icons/lucide/folder-open",
  "~icons/lucide/folder-plus",
  "~icons/lucide/folder-tree",
  "~icons/lucide/hard-drive",
  "~icons/lucide/heart",
  "~icons/lucide/history",
  "~icons/lucide/house",
  "~icons/lucide/inbox",
  "~icons/lucide/info",
  "~icons/lucide/key-round",
  "~icons/lucide/languages",
  "~icons/lucide/laptop",
  "~icons/lucide/layers",
  "~icons/lucide/layout-grid",
  "~icons/lucide/link-2",
  "~icons/lucide/list-filter",
  "~icons/lucide/list-video",
  "~icons/lucide/loader-circle",
  "~icons/lucide/lock",
  "~icons/lucide/lock-keyhole",
  "~icons/lucide/log-in",
  "~icons/lucide/log-out",
  "~icons/lucide/mail",
  "~icons/lucide/map-pin",
  "~icons/lucide/menu",
  "~icons/lucide/message-circle",
  "~icons/lucide/minus",
  "~icons/lucide/monitor",
  "~icons/lucide/moon",
  "~icons/lucide/newspaper",
  "~icons/lucide/octagon-x",
  "~icons/lucide/panel-left",
  "~icons/lucide/panels-top-left",
  "~icons/lucide/pencil",
  "~icons/lucide/plus",
  "~icons/lucide/refresh-cw",
  "~icons/lucide/rotate-ccw",
  "~icons/lucide/search",
  "~icons/lucide/settings",
  "~icons/lucide/share-2",
  "~icons/lucide/shield-check",
  "~icons/lucide/sliders-horizontal",
  "~icons/lucide/sparkles",
  "~icons/lucide/sun",
  "~icons/lucide/table-2",
  "~icons/lucide/tags",
  "~icons/lucide/trash-2",
  "~icons/lucide/triangle-alert",
  "~icons/lucide/unlink",
  "~icons/lucide/user-plus",
  "~icons/lucide/users",
  "~icons/lucide/x",
  "~icons/lucide/zoom-in",
  "~icons/lucide/zoom-out",
  "~icons/radix-icons/github-logo",
];
for (const spec of ICON_SPECS) {
  mock.module(spec, () => ({ default: () => null }));
}

// The app reads the Vite `define` values through `import.meta.env`; Bun has
// no Vite, so the SSR flags are set here for the duration of this file.
const ENV = import.meta.env as Record<string, unknown>;
const savedEnv = {
  ssr: ENV.SSR,
  runtime: ENV.VITE_PINAR_RUNTIME,
};
ENV.SSR = true;
ENV.VITE_PINAR_RUNTIME = "cloud";

afterAll(() => {
  if (savedEnv.ssr === undefined) delete ENV.SSR;
  else ENV.SSR = savedEnv.ssr;
  if (savedEnv.runtime === undefined) delete ENV.VITE_PINAR_RUNTIME;
  else ENV.VITE_PINAR_RUNTIME = savedEnv.runtime;
});

const {
  handleCloudApiRequest,
  resetCloudMemoryStateForTests,
  seedCloudWebSessionForTests,
} = await import("../server/cloud-api");
const { handleApiRequest: handleLocalApiRequest } = await import("../server/api.local");
const {
  authSessionCacheForTests,
  resetAuthSessionForTests,
} = await import("./auth-session");
const { hasWebSessionCookie } = await import("./auth-session-server");
const { createElement } = await import("react");
const {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} = await import("@tanstack/react-router");
const {
  attachRouterServerSsrUtils,
  renderRouterToString,
} = await import("@tanstack/react-router/ssr/server");
const { routeTree } = await import("../routeTree.gen");

const CLOUD_ENV = {
  AUTH_PEPPER: "ssr-auth-test-pepper",
  EXTENSION_ORIGIN: "chrome-extension://pinar-ssr-test",
};
apiSurface.cloud = (request: Request) => handleCloudApiRequest(request, CLOUD_ENV);

const EN = {
  openApp: "Open app",
  signIn: "Sign in",
  supportTitle: "Support Fair Source development",
};

async function renderSsrPage(
  path: string,
  cookie: string | null,
  presetResponseHeaders: Record<string, string> = {},
): Promise<string> {
  ssrRequest.url = new URL(`${path}?lang=en`, "https://pinar.test");
  ssrRequest.cookie = cookie;
  ssrResponseHeaders = new Headers(presetResponseHeaders);
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [`${path}?lang=en`] }),
    routeTree: routeTree,
  });
  await router.load();
  attachRouterServerSsrUtils({ router, manifest: undefined });
  const response = await renderRouterToString({
    router,
    responseHeaders: new Headers(),
    children: createElement(RouterProvider, { router }),
  });
  expect(response.status).toBe(200);
  return response.text();
}

function resetSurfaces() {
  resetCloudMemoryStateForTests();
  resetAuthSessionForTests();
}

test("SSR signed-out paint: 'Sign in' CTA and support card, with Vary: Cookie", async () => {
  resetSurfaces();
  for (const path of ["/", "/pricing"]) {
    const html = await renderSsrPage(path, null);
    expect(html).toContain(EN.signIn);
    expect(html).not.toContain(EN.openApp);
    expect(html).toContain(EN.supportTitle);
    // The language/session-dependent HTML keeps the per-cookie Vary header
    // (set in @/lib/language-server); the app never marks it public.
    expect(ssrResponseHeaders.get("vary") ?? "").toContain("Cookie");
  }
});

test("SSR Free paint: 'Open app' CTA and the support card", async () => {
  resetSurfaces();
  const free = await seedCloudWebSessionForTests({
    email: "ssr-free@pinar.test",
    plan: "free",
  });
  for (const path of ["/", "/pricing"]) {
    const html = await renderSsrPage(path, free.cookie);
    expect(html).toContain(EN.openApp);
    expect(html).not.toContain(EN.signIn);
    expect(html).toContain(EN.supportTitle);
  }
});

test("SSR Pro paint: 'Open app' CTA and no support card", async () => {
  resetSurfaces();
  const pro = await seedCloudWebSessionForTests({
    email: "ssr-pro@pinar.test",
    plan: "pro",
  });
  for (const path of ["/", "/pricing"]) {
    const html = await renderSsrPage(path, pro.cookie);
    expect(html).toContain(EN.openApp);
    expect(html).not.toContain(EN.signIn);
    expect(html).not.toContain(EN.supportTitle);
  }
});

test("isolation: consecutive requests in one process do not share session state", async () => {
  resetSurfaces();
  const pro = await seedCloudWebSessionForTests({
    email: "iso-pro@pinar.test",
    plan: "pro",
  });
  const proHtml = await renderSsrPage("/", pro.cookie);
  expect(proHtml).toContain(EN.openApp);
  expect(proHtml).not.toContain(EN.supportTitle);
  // The server must never keep a session in the module cache: the same
  // process renders every user.
  expect(authSessionCacheForTests()).toBe("empty");

  const anonHtml = await renderSsrPage("/", null);
  expect(anonHtml).toContain(EN.signIn);
  expect(anonHtml).toContain(EN.supportTitle);
  expect(authSessionCacheForTests()).toBe("empty");
});

test("unknown session: neutral CTA placeholder and no support card", async () => {
  resetSurfaces();
  const failingSurface: ApiHandler = () => Promise.reject(new Error("db down"));
  apiSurface.cloud = failingSurface;
  try {
    const html = await renderSsrPage("/", null);
    expect(html).toContain("data-auth-cta=\"placeholder\"");
    expect(html).not.toContain(EN.signIn);
    expect(html).not.toContain(EN.openApp);
    expect(html).not.toContain(EN.supportTitle);
  } finally {
    apiSurface.cloud = (request: Request) => handleCloudApiRequest(request, CLOUD_ENV);
  }
});

test("Cache-Control: session HTML is private, no-cache; cookie-less HTML is untouched", async () => {
  resetSurfaces();
  const free = await seedCloudWebSessionForTests({
    email: "cc-free@pinar.test",
    plan: "free",
  });
  // Same URL, user cookie: the HTML must not sit in a shared cache.
  await renderSsrPage("/", free.cookie);
  expect(ssrResponseHeaders.get("cache-control")).toBe("private, no-cache");
  await renderSsrPage("/pricing", free.cookie);
  expect(ssrResponseHeaders.get("cache-control")).toBe("private, no-cache");
  // No session cookie: nothing is set (the existing Vary rules stand).
  await renderSsrPage("/", null);
  expect(ssrResponseHeaders.get("cache-control")).toBeNull();
  // A more restrictive Cache-Control set earlier is not overwritten.
  await renderSsrPage("/", free.cookie, { "cache-control": "no-store" });
  expect(ssrResponseHeaders.get("cache-control")).toBe("no-store");
});

test("hasWebSessionCookie: only a real pinar_session cookie qualifies", () => {
  expect(hasWebSessionCookie(null)).toBe(false);
  expect(hasWebSessionCookie("")).toBe(false);
  expect(hasWebSessionCookie("pinar_session=tok-123")).toBe(true);
  expect(hasWebSessionCookie("theme=dark; pinar_session=tok-123; lang=en")).toBe(true);
  // Lookalike names do not qualify.
  expect(hasWebSessionCookie("Xpinar_session=tok")).toBe(false);
  expect(hasWebSessionCookie("pinar_session_other=tok")).toBe(false);
  // An empty value is not a session.
  expect(hasWebSessionCookie("pinar_session=")).toBe(false);
});

test("local runtime: SSR resolves the local/free session and keeps CTA and card", async () => {
  resetSurfaces();
  ENV.VITE_PINAR_RUNTIME = "local";
  apiSurface.local = true;
  apiSurface.localHandler = (request: Request) => handleLocalApiRequest(request);
  try {
    const html = await renderSsrPage("/", null);
    expect(html).toContain(EN.openApp);
    expect(html).not.toContain(EN.signIn);
    expect(html).toContain(EN.supportTitle);
    expect(authSessionCacheForTests()).toBe("empty");
  } finally {
    ENV.VITE_PINAR_RUNTIME = "cloud";
    apiSurface.local = false;
  }
});
