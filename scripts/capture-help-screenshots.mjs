import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { translations } from "../packages/shared/src/i18n/index.ts";
import { SUPPORTED_LANGUAGES } from "../packages/shared/src/types/index.ts";
import { helpScreenshotDefinitions } from "../apps/server/src/lib/help-content.ts";
import { startFakeModel, writeLocalAiSettings } from "../tests/e2e/helpers/assistant-fake-model.ts";
import { overlayFixtureHtml } from "./help-screenshot-fixtures/capture-overlay.mjs";

const OUTPUT_ROOT = new URL(
  "../apps/server/public/help/screenshots/",
  import.meta.url,
);
const STAGING_ROOT = new URL(`.generated-${process.pid}/`, OUTPUT_ROOT);

const EXTENSION_DIST = resolve(
  fileURLToPath(new URL("../extension/dist", import.meta.url)),
);
const CONTENT_TYPES = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".woff2": "font/woff2",
};
const ONLY_KEY = process.env.PINAR_HELP_SCREENSHOT_ONLY || "";
const UI_MESSAGE_LOADERS = {
  de: () => import("../apps/server/src/lib/ui-locales/de.ts"),
  en: () => import("../apps/server/src/lib/ui-locales/en.ts"),
  es: () => import("../apps/server/src/lib/ui-locales/es.ts"),
  fr: () => import("../apps/server/src/lib/ui-locales/fr.ts"),
  ja: () => import("../apps/server/src/lib/ui-locales/ja.ts"),
  pt: () => import("../apps/server/src/lib/ui-locales/pt.ts"),
  zh: () => import("../apps/server/src/lib/ui-locales/zh.ts"),
};

const SCREENSHOT_TARGETS = {
  // Its own Pinar with demo data and a fake model: see startAssistantDemo.
  assistant: { assistantDemo: true, path: "/app" },
  // Its own local Cloud: see startByokCloud (the panel only exists in the
  // cloud runtime).
  "own-ai-endpoint": { byokCloud: true, path: "/app" },
  "capture-copied": { path: "/screenshot-fixtures/capture-overlay?mode=copied" },
  "capture-copy-failed": {
    path: "/screenshot-fixtures/capture-overlay?mode=copy-failed",
  },
  "capture-full-page": {
    path: "/screenshot-fixtures/capture-overlay?mode=full-page",
  },
  "capture-masks": { path: "/screenshot-fixtures/capture-overlay?mode=masks" },
  "capture-pins": { path: "/screenshot-fixtures/capture-overlay?mode=pins" },
  "capture-review": { path: "/screenshot-fixtures/capture-overlay?mode=pins" },
  "capture-selection": {
    path: "/screenshot-fixtures/capture-overlay?mode=selection",
  },
  "capture-shortcuts": { path: "/extension-options/options.html" },
  "capture-toolbar": { path: "/screenshot-fixtures/capture-overlay" },
  "capture-session-review": {
    path: "/screenshot-fixtures/capture-overlay?mode=session-review",
  },
  "capture-types": { path: "/screenshot-fixtures/capture-overlay?mode=types" },
  "capture-viewer": { path: "/app", view: "grid", openSession: true },
  "capture-workspace": { path: "/app", view: "grid" },
  "extension-options": { path: "/extension-options/options.html" },
  "extension-preferences": { path: "/extension-options/options.html" },
  "help-navigation": { path: "/help/getting-started" },
  "install-pinar": { path: "/extension-options/options.html" },
  "legal-retention": { path: "/legal/retention" },
  "options-local": {
    path: "/extension-options/options.html",
    storageMode: "local",
  },
  "preferences-privacy": { path: "/extension-options/options.html" },
  pricing: { path: "/pricing" },
  "pricing-credits": { path: "/pricing" },
  privacy: { path: "/legal/privacy" },
  "sharing-markdown": { path: "/app", view: "grid", openMarkdown: true },
  "sign-in-email": { path: "/sign-in", tab: 1 },
  updates: { path: "/releases/0.1.5" },
  "workspace-nested": { path: "/app", view: "grid", clickCollection: true },
  "workspace-review": { path: "/app", view: "table", openReviewFilter: true },
  "workspace-security": { path: "/app", view: "grid", clickPersonal: true },
  "workspace-table": { path: "/app", view: "table" },
};

if (
  Object.keys(SCREENSHOT_TARGETS).length !== helpScreenshotDefinitions.length
) {
  throw new Error("Help screenshot definitions and capture targets differ");
}

const SCREENSHOTS = helpScreenshotDefinitions
  .map((definition) => {
    const target = SCREENSHOT_TARGETS[definition.key];
    if (!target) {
      throw new Error(`Missing capture target for ${definition.key}`);
    }
    return { ...definition, ...target };
  })
  .filter((screenshot) => !ONLY_KEY || screenshot.key === ONLY_KEY);

if (ONLY_KEY && SCREENSHOTS.length === 0) {
  throw new Error(`Unknown PINAR_HELP_SCREENSHOT_ONLY=${ONLY_KEY}`);
}

async function discoverBaseUrl() {
  if (process.env.PINAR_HELP_SCREENSHOT_BASE_URL) {
    return process.env.PINAR_HELP_SCREENSHOT_BASE_URL.replace(/\/$/, "");
  }
  for (let port = 17373; port <= 17382; port += 1) {
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      const health = await response.json();
      if (response.ok && health?.service === "pinar") return baseUrl;
    } catch {
      // Keep scanning the reserved local Pinar port range.
    }
  }
  throw new Error(
    "No local Pinar server answered /api/health on ports 17373-17382",
  );
}

async function waitForRenderedLocale(page, language) {
  await page.waitForFunction(
    (expectedLanguage) => document.documentElement.lang === expectedLanguage,
    language,
  );
  const pathname = new URL(page.url()).pathname;
  if (pathname.startsWith("/help") || pathname.startsWith("/releases")) {
    await page.waitForSelector(`[data-content-language="${language}"]`);
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images]
        .filter(
          (image) =>
            image.loading !== "lazy" ||
            image.getBoundingClientRect().top < innerHeight,
        )
        .map((image) =>
          image.complete
            ? undefined
            : new Promise((resolve) => {
                image.addEventListener("load", resolve, { once: true });
                image.addEventListener("error", resolve, { once: true });
              }),
        ),
    );
  });
}

function extensionOptionsChromeMock(language, storageMode = "cloud") {
  const os =
    process.platform === "win32"
      ? "win"
      : process.platform === "darwin"
        ? "mac"
        : "linux";
  const settings = {
    cloudUrl: "https://pinar.dev",
    copyOnFinishBatch: "prompt",
    copyViewerContent: false,
    enableHistory: true,
    handoffMode: "compact",
    includeScreenshot: true,
    includeViewer: true,
    language,
    loopMetricsOptIn: false,
    sensitiveQueryKeys: "token, api_key",
    storageMode,
    theme: "light",
  };
  return {
    os,
    settings,
  };
}

async function fulfillExtensionOptions(route) {
  const pathname = new URL(route.request().url()).pathname;
  const relative =
    decodeURIComponent(pathname.slice("/extension-options/".length)) ||
    "options.html";
  const file = resolve(EXTENSION_DIST, relative);
  if (file !== EXTENSION_DIST && !file.startsWith(`${EXTENSION_DIST}${sep}`)) {
    await route.abort("blockedbyclient");
    return;
  }
  try {
    await route.fulfill({
      body: await readFile(file),
      contentType: CONTENT_TYPES[extname(file)] || "application/octet-stream",
    });
  } catch {
    await route.fulfill({ body: "Not found", status: 404 });
  }
}

// The assistant cover: one question in each language and the answer the fake
// model gives, with a proposed move waiting for confirmation.
const ASSISTANT_DEMO_CONVERSATION = {
  de: ["Welche Sitzung hat den Pin zum Bezahlen-Button? Verschiebe sie nach Design.", "Das ist „Payment step“ mit dem Pin „Pay button overlaps the order total“. Ich habe vorgeschlagen, sie nach Design zu verschieben; nichts ändert sich, bevor du bestätigst."],
  en: ["Which session has the pin about the pay button? Move it to Design.", "“Payment step” has that pin: “Pay button overlaps the order total”. I proposed moving it to Design; nothing changes until you confirm."],
  es: ["¿Qué sesión tiene el pin sobre el botón de pago? Muévela a Design.", "Es “Payment step”, con el pin “Pay button overlaps the order total”. Propuse moverla a Design; nada cambia hasta que confirmes."],
  fr: ["Quelle session contient l’épingle sur le bouton de paiement ? Déplacez-la vers Design.", "C’est « Payment step », avec l’épingle « Pay button overlaps the order total ». J’ai proposé de la déplacer vers Design ; rien ne change avant votre confirmation."],
  ja: ["支払いボタンについてのピンがあるセッションは？ Design に移動して。", "「Payment step」に「Pay button overlaps the order total」というピンがあります。Design への移動を提案しました。確定するまで何も変わりません。"],
  pt: ["Qual sessão tem o pin sobre o botão de pagar? Mova para Design.", "É a “Payment step”, com o pin “Pay button overlaps the order total”. Propus movê-la para Design; nada muda até você confirmar."],
  zh: ["哪个会话有关于支付按钮的标注？把它移到 Design。", "是「Payment step」，其中的标注是「Pay button overlaps the order total」。我已提议把它移到 Design；在您确认之前什么都不会改变。"],
};

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

// A page of a fictional shop, rendered to a PNG data URL for a demo capture.
async function demoShot(browser, { accent, blocks, title }) {
  const page = await browser.newPage({ viewport: { height: 800, width: 1280 } });
  try {
    await page.setContent(`<!doctype html><html><head><style>
      body{margin:0;font-family:-apple-system,Segoe UI,sans-serif;background:#f6f7f9;color:#111827}
      header{height:64px;background:#fff;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:32px;padding:0 48px}
      .logo{width:96px;height:22px;border-radius:6px;background:${accent}}
      nav span{display:inline-block;width:72px;height:10px;margin-right:18px;border-radius:5px;background:#d1d5db}
      main{padding:40px 48px} h1{font-size:30px;margin:0 0 24px}
      .grid{display:grid;grid-template-columns:2fr 1fr;gap:24px}
      .block{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:22px;min-height:120px;font-size:16px}
      .field{height:42px;border:1px solid #d1d5db;border-radius:8px;margin:10px 0}
      .button{height:46px;border-radius:10px;background:${accent};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;margin-top:16px}
    </style></head><body><header><div class="logo"></div><nav><span></span><span></span><span></span></nav></header>
    <main><h1>${title}</h1><div class="grid">${blocks.map((block) => `<div class="block">${block}</div>`).join("")}</div></main></body></html>`);
    return `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;
  } finally {
    await page.close();
  }
}

// The assistant answers through a model, and no real model may be reached
// from here. So this cover gets its own Pinar: the local build on a free
// port with a temporary PINAR_HOME, pointed at the e2e fake model on
// loopback by writing ai.json into that home (the AI settings routes are
// never called), with a demo project created through the workspace routes.
// Everything goes away in stop().
async function startAssistantDemo(browser) {
  const entry = fileURLToPath(new URL("../apps/server/.output/server/index.mjs", import.meta.url));
  if (!existsSync(entry)) {
    throw new Error("The assistant cover needs the local build: run `bun run build:local` first");
  }
  const home = await mkdtemp(join(tmpdir(), "pinar-help-assistant-"));
  let fake = null;
  let server = null;
  let exited = Promise.resolve();
  const stop = async () => {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await exited;
    }
    await fake?.stop();
    await rm(home, { force: true, recursive: true });
  };
  try {
    fake = await startFakeModel();
    writeLocalAiSettings(home, fake.endpoint);
    const port = await freePort();
    const env = { ...process.env, PINAR_HOME: home, PORT: String(port) };
    delete env.PINAR_PORT;
    let output = "";
    server = spawn(process.execPath, [entry], { env, stdio: ["ignore", "pipe", "pipe"] });
    exited = new Promise((resolveExit) => server.once("exit", resolveExit));
    server.stdout.on("data", (chunk) => {
      output += chunk;
    });
    server.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    process.stdout.write(`assistant demo: Pinar pid ${server.pid} on ${baseUrl}, home ${home}\n`);
    for (let attempt = 0; ; attempt += 1) {
      if (server.exitCode !== null) throw new Error(`The assistant demo server exited:\n${output}`);
      try {
        const health = await (await fetch(`${baseUrl}/api/health`)).json();
        if (health?.service === "pinar") break;
      } catch {
        // Not listening yet.
      }
      if (attempt >= 100) throw new Error(`The assistant demo server did not answer:\n${output}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }

    const images = {
      header: await demoShot(browser, { accent: "#7c3aed", blocks: ['Hero<div class="field"></div>', 'Menu<div class="field"></div>'], title: "Home" }),
      payment: await demoShot(browser, { accent: "#2563eb", blocks: ['Card number<div class="field"></div>Name on card<div class="field"></div>', 'Order total<div class="button">Pay now</div>'], title: "Payment" }),
      summary: await demoShot(browser, { accent: "#059669", blocks: ['2 items<div class="field"></div><div class="field"></div>', 'Discount<div class="field"></div>'], title: "Order summary" }),
    };
    const page = await browser.newPage();
    try {
      await page.goto(`${baseUrl}/app`);
      const ids = await page.evaluate(async (images) => {
        const post = async (path, body) => {
          const response = await fetch(path, { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method: "POST" });
          if (!response.ok) throw new Error(`${path} answered ${response.status}`);
          return response.json();
        };
        const { project } = await post("/api/projects", { name: "Storefront" });
        const { collection: checkout } = await post(`/api/projects/${project.id}/collections`, { name: "Checkout" });
        const { collection: design } = await post(`/api/projects/${project.id}/collections`, { name: "Design" });
        const shots = [
          { collectionId: checkout.id, id: "help_demo_payment", image: images.payment, pins: ["Pay button overlaps the order total", "Card field label is cut off"], title: "Payment step", url: "https://shop.example.test/checkout/payment" },
          { collectionId: checkout.id, id: "help_demo_summary", image: images.summary, pins: ["Discount line is missing"], title: "Order summary", url: "https://shop.example.test/checkout/summary" },
          { collectionId: design.id, id: "help_demo_header", image: images.header, pins: ["Logo too close to the menu"], title: "Header spacing", url: "https://shop.example.test/" },
        ];
        for (const shot of shots) {
          await post("/api/shots", {
            collectionId: shot.collectionId,
            id: shot.id,
            image: shot.image,
            page: { title: shot.title, url: shot.url },
            pins: shot.pins.map((comment) => ({ comment, kind: "element" })),
          });
        }
        return { design: design.id, payment: "help_demo_payment", project: project.id };
      }, images);
      return { baseUrl, fake, ids, stop };
    } finally {
      await page.close();
    }
  } catch (error) {
    await stop();
    throw error;
  }
}

// The workspace on the demo project with the assistant panel open: the
// question of `language` sent, the fake model's proposed move and answer.
async function showAssistantDemo(page, demo, language, ui) {
  const [question, answer] = ASSISTANT_DEMO_CONVERSATION[language];
  demo.fake.reset();
  demo.fake.enqueue(
    { args: { collectionId: demo.ids.design, sessionId: demo.ids.payment }, kind: "tool", name: "pinar_move_session" },
    { kind: "text", text: answer },
  );
  await page.goto(`${demo.baseUrl}/app`, { waitUntil: "domcontentloaded" });
  await page.evaluate((projectId) => {
    localStorage.setItem("pinar-selected-project", projectId);
    localStorage.removeItem("pinar-selected-collection");
    localStorage.setItem("pinar-history-view", "grid");
  }, demo.ids.project);
  await page.goto(`${demo.baseUrl}/app`, { waitUntil: "networkidle" });
  await waitForRenderedLocale(page, language);
  await page.locator('[data-sidebar="content"]').getByText("Checkout", { exact: true }).click();
  await page.getByRole("button", { exact: true, name: ui["assistant.toggle"] }).click();
  const panel = page.getByRole("region", { name: ui["assistant.title"] });
  await panel.waitFor();
  const composer = panel.getByRole("textbox", { name: ui["assistant.placeholder"] });
  await composer.fill(question);
  await composer.press("Enter");
  await panel.getByRole("button", { exact: true, name: ui["assistant.proposalConfirm"] }).waitFor({ timeout: 15_000 });
  await panel.getByText(answer).waitFor();
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

// The BYOK settings panel only exists in the cloud runtime, so this cover
// gets its own local Cloud the way the e2e does: dev:cloud on a free port
// with a temporary state path. The Pro fixture signs in once (the fixture
// email code is one-shot per boot), and every language reuses the session
// cookie. /api/byok* is answered with page.route, so no real key and no
// external endpoint is ever reached.
const BYOK_DEMO_VIEW = {
  baseUrl: "https://provider.example.test/v1",
  capabilities: {
    chat: { error: null, ok: true, testedAt: "2026-10-18T00:00:05.000Z" },
    embeddings: {
      dims: null,
      error: "model_not_found",
      ok: false,
      testedAt: "2026-10-18T00:00:06.000Z",
    },
    tools: { error: null, ok: true, testedAt: "2026-10-18T00:00:05.000Z" },
    transcription: { error: null, ok: null, testedAt: null },
    vision: { error: null, ok: true, testedAt: "2026-10-18T00:00:07.000Z" },
  },
  configured: true,
  keyLast4: "abcd",
  models: { chat: "gpt-e2e", embedding: null, transcription: null },
  updatedAt: "2026-10-18T00:00:07.000Z",
};
const BYOK_DEMO_UNCONFIGURED = {
  baseUrl: null,
  capabilities: {
    chat: { error: null, ok: null, testedAt: null },
    embeddings: { dims: null, error: null, ok: null, testedAt: null },
    tools: { error: null, ok: null, testedAt: null },
    transcription: { error: null, ok: null, testedAt: null },
    vision: { error: null, ok: null, testedAt: null },
  },
  configured: false,
  keyLast4: null,
  models: { chat: null, embedding: null, transcription: null },
  updatedAt: null,
};

async function startByokCloud() {
  const statePath = await mkdtemp(join(tmpdir(), "pinar-help-byok-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let server = null;
  let output = "";
  const stop = async () => {
    if (server && server.exitCode === null) {
      const exited = new Promise((resolveExit) => server.once("exit", resolveExit));
      const signal = (name) => {
        try {
          process.kill(-server.pid, name);
        } catch {
          try {
            server.kill(name);
          } catch {
            // Already gone.
          }
        }
      };
      signal("SIGTERM");
      await Promise.race([
        exited,
        new Promise((resolveWait) => setTimeout(resolveWait, 10_000)),
      ]);
      if (server.exitCode === null) {
        signal("SIGKILL");
        await exited;
      }
    }
    await rm(statePath, { force: true, recursive: true });
  };
  try {
    server = spawn(
      "bun",
      ["run", "dev:cloud", "--", "--port", String(port), "--state-path", statePath],
      {
        cwd: resolve(fileURLToPath(new URL("..", import.meta.url))),
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout.on("data", (chunk) => {
      output += chunk;
    });
    server.stderr.on("data", (chunk) => {
      output += chunk;
    });
    process.stdout.write(`byok cloud: pid ${server.pid} on ${baseUrl}, state ${statePath}\n`);
    for (let attempt = 0; ; attempt += 1) {
      if (server.exitCode !== null) {
        throw new Error(`The byok cloud exited before answering:\n${output}`);
      }
      try {
        const health = await (await fetch(`${baseUrl}/api/health`)).json();
        if (health?.service === "pinar") break;
      } catch {
        // Not listening yet.
      }
      if (attempt >= 360) {
        throw new Error(`The byok cloud did not answer on ${baseUrl}:\n${output}`);
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
    // One Pro sign-in: the fixture email code is one-shot per boot, so the
    // session cookie is reused by the seven languages. Two attempts, then
    // the cover is left as it was and the error is reported with the output.
    let cookie = null;
    for (let attempt = 0; attempt < 2 && cookie === null; attempt += 1) {
      if (attempt > 0) process.stdout.write("byok cloud: retrying the Pro sign-in\n");
      const response = await fetch(`${baseUrl}/api/auth/email-codes/verify`, {
        headers: { "content-type": "application/json" },
        method: "POST",
        body: JSON.stringify({
          code: "826826",
          email: "pro.cloud-local@pinar.test",
          returnTo: "/app",
        }),
      });
      const setCookies = response.headers.getSetCookie?.() ?? [];
      const session = setCookies.find((value) => value.startsWith("pinar_session="));
      if (response.ok && session) {
        cookie = session.slice("pinar_session=".length).split(";")[0];
      } else {
        process.stdout.write(
          `byok cloud: sign-in attempt ${attempt + 1} answered ${response.status}\n`,
        );
      }
    }
    if (cookie === null) {
      throw new Error(`The byok cloud Pro sign-in never set the session cookie:\n${output}`);
    }
    return { baseUrl, cookie, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

// The AI settings section with the BYOK panel: the mixed capability view
// (chat with tools and vision on the endpoint, embeddings on the credits
// with a cause, transcription untested), the example URL and the masked key.
async function showByokSettings(page, cloud, language, ui) {
  page.route("**/api/byok", (route) => {
    if (route.request().method() === "PUT" || route.request().method() === "DELETE") {
      return route.fulfill({ json: BYOK_DEMO_UNCONFIGURED });
    }
    return route.fulfill({ json: BYOK_DEMO_VIEW });
  });
  page.route("**/api/byok/test", (route) =>
    route.fulfill({ json: BYOK_DEMO_VIEW }),
  );
  await page.context().addCookies([
    { domain: "127.0.0.1", name: "pinar_session", path: "/", value: cloud.cookie },
  ]);
  await page.goto(`${cloud.baseUrl}/app`, { waitUntil: "networkidle" });
  await waitForRenderedLocale(page, language);
  const trigger = page
    .locator('[data-sidebar="footer"]')
    .getByRole("button", { exact: true, name: ui["app.accountMenu"] });
  await trigger.waitFor({ timeout: 30_000 });
  // The first click right after the page load can land before hydration and
  // be swallowed, so the trigger is clicked until the menu actually opens.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await page.keyboard.press("Escape");
    await trigger.click();
    const opened = await page
      .locator('[role="menuitem"]')
      .first()
      .waitFor({ timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (opened) break;
  }
  await page.getByRole("menuitem", { exact: true, name: ui["settings.title"] }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 15_000 });
  await dialog.getByRole("button", { exact: true, name: ui["settings.ai"] }).click();
  await dialog.getByText(ui["byok.heading"], { exact: true }).waitFor({ timeout: 15_000 });
  await page
    .waitForFunction(
      (url) =>
        [...document.querySelectorAll("input")].some(
          (input) => input.value === url,
        ),
      BYOK_DEMO_VIEW.baseUrl,
      { timeout: 15_000 },
    )
    .catch(() => {
      // The endpoint field may render its value differently; the heading
      // and the fonts are enough for the cover.
    });
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function launchHelpScreenshotBrowser() {
  if (process.env.PINAR_HELP_SCREENSHOT_CHANNEL) {
    return chromium.launch({
      channel: process.env.PINAR_HELP_SCREENSHOT_CHANNEL,
      headless: true,
    });
  }
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.includes("Executable doesn't exist")) throw error;
    return chromium.launch({ channel: "msedge", headless: true });
  }
}

// Only the targets on the local Pinar need it: the assistant cover and the
// own-endpoint cover bring their own servers.
const baseUrl = SCREENSHOTS.some(
  (screenshot) => !screenshot.assistantDemo && !screenshot.byokCloud,
)
  ? await discoverBaseUrl()
  : null;
await mkdir(STAGING_ROOT, { recursive: true });

try {
  const browser = await launchHelpScreenshotBrowser();
  let assistantDemo = null;
  let byokCloud = null;
  try {
    if (SCREENSHOTS.some((screenshot) => screenshot.assistantDemo)) {
      assistantDemo = await startAssistantDemo(browser);
    }
    if (SCREENSHOTS.some((screenshot) => screenshot.byokCloud)) {
      byokCloud = await startByokCloud();
    }
    for (const language of SUPPORTED_LANGUAGES) {
      const context = await browser.newContext({ colorScheme: "light" });
      const optionsMock = extensionOptionsChromeMock(language);
      await context.addInitScript((locale) => {
        localStorage.setItem("pinar-language", locale);
      }, language);
      await context.addInitScript(({ os, settings }) => {
        globalThis.chrome = {
          runtime: {
            getManifest: () => ({ version: "0.3.0" }),
            getPlatformInfo: async () => ({ os }),
            id: "pinar-help-screenshots",
            sendMessage: async (message) => {
              if (message?.type === "preferences:get") {
                return {
                  handoffMode: settings.handoffMode,
                  includeScreenshot: settings.includeScreenshot,
                  ok: true,
                };
              }
              if (
                message?.type === "destination:get" ||
                message?.type === "destination:set"
              ) {
                const now = "2026-08-18T00:00:00.000Z";
                return {
                  destination: {
                    collectionId: "inbox",
                    projectId: "personal",
                  },
                  ok: true,
                  tree: {
                    projects: [
                      {
                        collections: [
                          {
                            createdAt: now,
                            id: "inbox",
                            isProtected: true,
                            name: "Inbox",
                            ownerId: "local",
                            parentId: null,
                            position: 0,
                            projectId: "personal",
                            sessions: [],
                            updatedAt: now,
                          },
                        ],
                        createdAt: now,
                        icon: "folder",
                        id: "personal",
                        isProtected: true,
                        name: "Personal",
                        ownerId: "local",
                        position: 0,
                        updatedAt: now,
                      },
                    ],
                  },
                };
              }
              if (message?.type === "auth:get") {
                return {
                  ok: true,
                  session: {
                    installationId: "help-screenshots",
                    kind: "installation",
                    plan: "free",
                  },
                };
              }
              return { ok: true };
            },
          },
          commands: {
            getAll: (callback) => {
              callback([
                {
                  description: "Toggle Pinar",
                  name: "_execute_action",
                  shortcut: "Alt+Shift+P",
                },
                {
                  description: "Finish batch",
                  name: "finish-batch",
                  shortcut: "Alt+Shift+B",
                },
                {
                  description: "Cancel batch",
                  name: "cancel-batch",
                  shortcut: "Alt+Shift+N",
                },
                {
                  description: "Open panel",
                  name: "open-panel",
                  shortcut: "Alt+Shift+O",
                },
              ]);
            },
          },
          tabs: {
            create: async () => {},
          },
          storage: {
            local: {
              get: async (defaults = {}) => ({ ...defaults }),
              remove: async () => {},
              set: async () => {},
            },
            sync: {
              get: async (defaults = {}) => ({ ...defaults, ...settings }),
              set: async () => {},
            },
          },
        };
      }, optionsMock);
      await context.route("**/api/legal/current", (route) =>
        route.fulfill({
          json: {
            acceptableUseUrl: "/legal/acceptable-use",
            privacyUrl: "/legal/privacy",
            termsUrl: "/legal/terms",
            version: "2026-08-18",
          },
        }),
      );
      await context.route("**/extension-options/**", fulfillExtensionOptions);
      await context.route("**/screenshot-fixtures/capture-overlay**", (route) => {
        const mode =
          new URL(route.request().url()).searchParams.get("mode") || "capture";
        return route.fulfill({
          body: overlayFixtureHtml(translations[language], {
            language,
            mode,
            sendMod: process.platform === "darwin" ? "⌘" : "Ctrl",
          }),
          contentType: "text/html; charset=utf-8",
        });
      });
      const page = await context.newPage();
      const copy = translations[language];
      const ui = (await UI_MESSAGE_LOADERS[language]()).default;

      for (const screenshot of SCREENSHOTS) {
        await page.setViewportSize({
          width: screenshot.width,
          height: screenshot.height,
        });
        if (screenshot.assistantDemo) {
          await showAssistantDemo(page, assistantDemo, language, ui);
          const directory = new URL(`${language}/`, STAGING_ROOT);
          await mkdir(directory, { recursive: true });
          await page.screenshot({
            animations: "disabled",
            caret: "hide",
            path: fileURLToPath(new URL(`${screenshot.key}.webp`, directory)),
            quality: 88,
            type: "webp",
          });
          process.stdout.write(`${language}/${screenshot.key}.webp\n`);
          continue;
        }
        if (screenshot.byokCloud) {
          await showByokSettings(page, byokCloud, language, ui);
          const directory = new URL(`${language}/`, STAGING_ROOT);
          await mkdir(directory, { recursive: true });
          await page.screenshot({
            animations: "disabled",
            caret: "hide",
            path: fileURLToPath(new URL(`${screenshot.key}.webp`, directory)),
            quality: 88,
            type: "webp",
          });
          process.stdout.write(`${language}/${screenshot.key}.webp\n`);
          continue;
        }
        if (screenshot.view) {
          await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
          await page.evaluate((view) => {
            localStorage.setItem("pinar-history-view", view);
          }, screenshot.view);
        }
        const isExtensionOptions = [
          "capture-shortcuts",
          "extension-options",
          "extension-preferences",
          "install-pinar",
          "options-local",
          "preferences-privacy",
        ].includes(screenshot.key);
        await page.goto(`${baseUrl}${screenshot.path}`, {
          waitUntil: isExtensionOptions ? "domcontentloaded" : "networkidle",
        });
        if (isExtensionOptions) {
          await page.getByText(copy.header_title).waitFor();
          if (
            screenshot.key === "extension-preferences" ||
            screenshot.key === "preferences-privacy"
          ) {
            await page.getByRole("tab", { name: copy.tab_capture }).click();
            if (screenshot.key === "preferences-privacy") {
              await page.getByText(copy.privacy_query_keys_label).waitFor();
            } else {
              await page.getByText(copy.section_handoff).waitFor();
              await page.getByText(copy.screenshot_label).waitFor();
            }
          } else if (screenshot.key === "capture-shortcuts") {
            await page.getByRole("tab", { name: copy.tab_shortcuts }).click();
            await page.getByText(copy.shortcuts_overlay_title).waitFor();
          } else if (screenshot.key === "options-local") {
            await page.getByText(copy.local_title, { exact: true }).click();
            await page.getByText(copy.local_desc).waitFor();
          } else if (screenshot.key === "install-pinar") {
            await page.getByRole("link", { name: copy.btn_download_macos }).waitFor();
          } else {
            await page.getByRole("link", { name: copy.account_create_on_web, exact: true }).waitFor();
          }
        } else if (String(screenshot.path || "").includes("screenshot-fixtures/capture-overlay")) {
          await page
            .locator(
              screenshot.key === "capture-session-review"
                ? ".review-card"
                : "[data-overlay-toolbar]",
            )
            .waitFor();
          await page.evaluate(async () => {
            await document.fonts.ready;
          });
        } else if (screenshot.openSession || screenshot.view) {
          await page.locator("[data-dashboard-scroll-area]").waitFor({
            timeout: 15_000,
          });
        } else {
          await waitForRenderedLocale(page, language);
        }
        if (screenshot.tab !== undefined) {
          await page.getByRole("tab").nth(screenshot.tab).click();
        }
        if (screenshot.openSession) {
          const sessionId = await page
            .locator("[data-session-id]")
            .first()
            .getAttribute("data-session-id", { timeout: 15_000 });
          if (!sessionId) {
            throw new Error("capture-viewer needs at least one saved session");
          }
          await page.goto(`${baseUrl}/v/${encodeURIComponent(sessionId)}`, {
            waitUntil: "networkidle",
          });
          await page.locator("img").first().waitFor();
        }
        if (screenshot.key === "privacy" || screenshot.key === "legal-retention") {
          await page
            .getByRole("tablist", { name: /Legal documents|Documentos legais/i })
            .waitFor();
        }
        if (screenshot.openMarkdown) {
          const projectId = await page.evaluate(async () => {
            const response = await fetch("/api/projects");
            const data = await response.json();
            return data.projects?.[0]?.id ?? null;
          });
          if (!projectId) {
            throw new Error("sharing-markdown needs at least one project");
          }
          await page.goto(`${baseUrl}/p/${encodeURIComponent(projectId)}`, {
            waitUntil: "networkidle",
          });
          await page.getByRole("button").filter({ hasText: /Markdown/ }).waitFor();
        }
        if (screenshot.clickCollection) {
          const sidebar = page.locator("[data-sidebar]");
          const menuButton = sidebar.locator('[data-slot="sidebar-menu-button"]');
          await menuButton.first().waitFor();
          const toggles = sidebar.locator("[data-collection-toggle]");
          const toggleCount = await toggles.count();
          for (let index = 0; index < toggleCount; index += 1) {
            if ((await toggles.nth(index).getAttribute("aria-expanded")) === "false") {
              await toggles.nth(index).click();
            }
          }
          const studio = menuButton.filter({ hasText: "Studio" });
          const nestedRoot = menuButton.filter({ hasText: "Yatta!" });
          if ((await studio.count()) > 0) {
            await studio.click();
          } else if ((await nestedRoot.count()) > 0) {
            await nestedRoot.click();
          } else {
            await menuButton.filter({ hasText: "Inbox" }).first().click();
          }
        }
        if (screenshot.openReviewFilter) {
          await page
            .getByRole("button", {
              name: /Review|Revisão|Revisión|Revue|Prüfung|审阅|レビュー/,
            })
            .click();
          await page.getByRole("menu").waitFor();
        }
        if (screenshot.clickPersonal) {
          await page.locator("button[aria-label='Personal']").click();
          await page.getByRole("menu").waitFor();
        }
        if (screenshot.key === "pricing-credits") {
          await page
            .getByRole("heading", { name: ui["pricing.addOnsTitle"] })
            .scrollIntoViewIfNeeded();
          await page
            .getByRole("heading", { name: ui["pricing.aiCreditsTitle"] })
            .waitFor();
        }
        const languageDirectory = new URL(`${language}/`, STAGING_ROOT);
        await mkdir(languageDirectory, { recursive: true });
        const screenshotPath = fileURLToPath(
          new URL(`${screenshot.key}.webp`, languageDirectory),
        );
        const screenshotOptions = {
          animations: "disabled",
          caret: "hide",
          path: screenshotPath,
          quality: 88,
          type: "webp",
        };
        if (screenshot.key === "install-pinar") {
          await page
            .locator("label")
            .filter({ hasText: copy.local_title })
            .screenshot(screenshotOptions);
        } else if (screenshot.key === "extension-preferences") {
          await page
            .locator("section")
            .filter({ hasText: copy.screenshot_label })
            .screenshot(screenshotOptions);
        } else if (screenshot.key === "preferences-privacy") {
          await page
            .locator("section")
            .filter({ hasText: copy.privacy_query_keys_label })
            .screenshot(screenshotOptions);
        } else if (screenshot.key === "pricing-credits") {
          await page
            .locator("[data-slot='card']")
            .filter({
              has: page.getByRole("heading", {
                name: ui["pricing.aiCreditsTitle"],
              }),
            })
            .screenshot(screenshotOptions);
        } else if (isExtensionOptions) {
          await page.locator("div.max-w-\\[640px\\]").first().screenshot(screenshotOptions);
        } else {
          await page.screenshot(screenshotOptions);
        }
        process.stdout.write(`${language}/${screenshot.key}.webp\n`);
      }

      await context.close();
    }
  } finally {
    await assistantDemo?.stop();
    await byokCloud?.stop();
    await browser.close();
  }

  for (const language of SUPPORTED_LANGUAGES) {
    const outputDirectory = new URL(`${language}/`, OUTPUT_ROOT);
    if (ONLY_KEY) {
      await mkdir(outputDirectory, { recursive: true });
      await copyFile(
        new URL(`${language}/${ONLY_KEY}.webp`, STAGING_ROOT),
        new URL(`${ONLY_KEY}.webp`, outputDirectory),
      );
      continue;
    }
    await rm(outputDirectory, { force: true, recursive: true });
    await rename(new URL(`${language}/`, STAGING_ROOT), outputDirectory);
  }
} finally {
  await rm(STAGING_ROOT, { force: true, recursive: true });
}
