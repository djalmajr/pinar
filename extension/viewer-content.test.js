import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { formatClipboardPayload } from "./format.js";
import {
  MAX_VIEWER_MARKDOWN_BYTES,
  readBoundedResponseText,
  readOptionalViewerMarkdown,
} from "./viewer-markdown.js";

const backgroundSource = readFileSync(new URL("./background.js", import.meta.url), "utf8");

function sourceBetween(start, end) {
  return backgroundSource.slice(backgroundSource.indexOf(start), backgroundSource.indexOf(end));
}

function eventTarget() {
  return { addListener() {} };
}

function createStorage(initial = {}) {
  const values = { ...initial };
  return {
    values,
    async get(keys) {
      if (keys == null) return { ...values };
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
      if (typeof keys === "string") return keys in values ? { [keys]: values[keys] } : {};
      return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, key in values ? values[key] : fallback]));
    },
    async remove(keys) {
      for (const key of (Array.isArray(keys) ? keys : [keys])) delete values[key];
    },
    async set(next) {
      Object.assign(values, next);
    },
    async setAccessLevel() {},
  };
}

function createChromeHarness({ writeClipboard = async () => ({ ok: true }) } = {}) {
  const deviceToken = `pdt_${"a".repeat(43)}`;
  const sync = createStorage();
  const local = createStorage({
    "remote:https://pinar.dev:deviceToken": deviceToken,
    "remote:https://pinar.dev:deviceTokens": { "https://pinar.dev": deviceToken },
  });
  const session = createStorage();
  const clipboard = [];
  const requests = [];
  const chrome = {
    action: {
      onClicked: eventTarget(),
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async () => {},
      setBadgeTextColor: async () => {},
    },
    commands: { onCommand: eventTarget() },
    contextMenus: { onClicked: eventTarget() },
    offscreen: { createDocument: async () => {} },
    runtime: {
      getContexts: async () => [],
      getManifest: () => ({}),
      getPlatformInfo: async () => ({ os: "mac" }),
      onInstalled: eventTarget(),
      onMessage: eventTarget(),
      onStartup: eventTarget(),
      sendMessage: async (message) => {
        clipboard.push(message);
        return writeClipboard(message, clipboard.length);
      },
    },
    scripting: {
      executeScript: async () => [],
    },
    storage: { local, onChanged: eventTarget(), session, sync },
    tabs: {
      captureVisibleTab: async () => "data:image/png;base64,AA==",
      onRemoved: eventTarget(),
      onUpdated: eventTarget(),
      query: async () => [],
      sendMessage: async () => ({ ok: true }),
    },
  };
  return { chrome, clipboard, deviceToken, local, requests, session, sync };
}

function configureCopySettings(harness, { handoffMode, storageMode }) {
  Object.assign(harness.sync.values, {
    cloudUrl: "https://pinar.dev",
    copyOnFinishBatch: "prompt",
    copyViewerContent: true,
    enableHistory: true,
    handoffMode,
    includeScreenshot: true,
    includeViewer: true,
    language: "",
    sensitiveQueryKeys: "",
    storageMode,
    voicePostProcessing: false,
  });
  harness.session.values.captureBatch = null;
  harness.local.values.captureDestinations = {};
  harness.clipboard.length = 0;
  harness.requests.length = 0;
}

function requestPath(input) {
  return new URL(String(input)).pathname;
}

function parseVisualContext(plain) {
  const match = plain.match(/```pinar-visual-context\n([\s\S]*?)\n```/);
  assert.ok(match, "clipboard payload includes a pinar-visual-context block");
  return JSON.parse(match[1]);
}

describe("viewer Markdown handoff", () => {
  test("streams UTF-8 Markdown within the byte budget", async () => {
    // Mutation captured: decoding each chunk independently corrupts a multibyte character split across chunks.
    const encoded = new TextEncoder().encode("# Café\n\nEmoji: 🧪");
    const cafeSplit = new TextEncoder().encode("# Caf").byteLength + 1;
    const emojiStart = new TextEncoder().encode("# Café\n\nEmoji: ").byteLength;
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoded.slice(0, cafeSplit));
        controller.enqueue(encoded.slice(cafeSplit, emojiStart + 2));
        controller.enqueue(encoded.slice(emojiStart + 2));
        controller.close();
      },
    }));

    assert.equal(await readBoundedResponseText(response, encoded.byteLength), "# Café\n\nEmoji: 🧪");
  });

  test("rejects Content-Length before reading an oversized response", async () => {
    // Mutation captured: removing the early Content-Length guard allows an oversized body to enter the clipboard path.
    let cancelled = false;
    const response = new Response(new ReadableStream({
      start() {},
      cancel() {
        cancelled = true;
      },
    }), { headers: { "content-length": "999" } });

    await assert.rejects(readBoundedResponseText(response, 8), /viewer_content_too_large/);
    assert.equal(cancelled, true);
  });

  test("cancels a stream on byte-budget overflow and falls back to compact context", async () => {
    // Mutation captured: continuing after overflow buffers unbounded Markdown instead of preserving the compact handoff.
    let cancelled = false;
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(9));
      },
      cancel() {
        cancelled = true;
      },
    }));

    const failed = await readOptionalViewerMarkdown(response, 8);
    assert.deepEqual(failed, { content: null, warning: "viewer_content_unavailable" });
    assert.equal(cancelled, true);

    const payload = formatClipboardPayload({
      captureId: "capture-fallback",
      page: { title: "App", url: "https://app.example.test" },
      pins: [{ comment: "Keep this handoff", id: "pin-fallback" }],
      viewerContent: failed.content,
      warnings: [failed.warning],
    });
    assert.match(payload.plain, /```pinar-visual-context/);
    assert.match(payload.plain, /viewer_content_unavailable/);
    assert.doesNotMatch(payload.plain, /BEGIN PINAR VIEWER MARKDOWN/);
  });

  test("uses the default one MiB limit for opt-in Markdown", () => {
    assert.equal(MAX_VIEWER_MARKDOWN_BYTES, 1024 * 1024);
  });

  test("uses the stored opt-in only after a successful saved capture", () => {
    // Mutation captured: fetching before save would copy Markdown for a capture that was never persisted.
    const copyBundle = sourceBetween("async function copyBundle", "async function ensureOffscreen");
    assert.match(copyBundle, /const copyViewerContent = remotePrefs\?\.copyViewerContent \?\? settings\.copyViewerContent === true/);
    assert.match(copyBundle, /if \(copyViewerContent\)/);
    assert.match(copyBundle, /if \(!includeViewer \|\| !savedResult\)/);
    assert.match(copyBundle, /viewerContent = await fetchSavedViewerMarkdown\(settings, id\)/);
    assert.match(copyBundle, /warnings: \[\.\.\.new Set\(\[\.\.\.warnings, "viewer_content_unavailable"\]\)\]/);
    assert.match(copyBundle, /savedResult = await saveShot\([\s\S]*?fetchSavedViewerMarkdown/);
    assert.match(copyBundle, /formatClipboardPayload\([\s\S]*?viewerContent,/);
  });

  test("fetches private Markdown through the existing authenticated local and remote paths", () => {
    // Mutation captured: putting a capability or device token in the Markdown URL bypasses the auth wrappers.
    const fetcher = sourceBetween("async function fetchSavedViewerMarkdown", "async function fetchDestinationTree");
    const remote = sourceBetween("async function remoteFetch", "function audioBlobFromDataUrl");
    const local = sourceBetween("async function localFetch", "async function fetchSavedViewerMarkdown");
    assert.match(fetcher, /localFetch\(base, path, \{ cache: "no-store", redirect: "error" \}\)/);
    assert.match(fetcher, /remoteFetch\(cloudEndpoint\(settings\), path, \{ cache: "no-store", redirect: "error" \}\)/);
    assert.match(fetcher, /`\/v\/\$\{encodeURIComponent\(captureId\)\}\.md`/);
    assert.doesNotMatch(fetcher, /[?&](?:token|capability)=/i);
    assert.match(remote, /headers: \{[\s\S]*\.\.\.deviceAuthHeaders\(deviceToken\)/);
    assert.match(local, /"x-pinar-capability": token/);
    assert.match(backgroundSource, /MAX_VIEWER_MARKDOWN_BYTES/);
    assert.match(fetcher, /readOptionalViewerMarkdown\(response, MAX_VIEWER_MARKDOWN_BYTES\)/);
  });

  test("fails an exclusive Markdown handoff instead of falling back to compact context", () => {
    // Mutation captured: a preliminary/fallback write could report success with Visual Context even though Markdown-only was selected.
    const copyBundle = sourceBetween("async function copyBundle", "async function ensureOffscreen");
    assert.match(copyBundle, /copyViewerContent \? null : await publishClipboard\(null, null\)/);
    assert.match(copyBundle, /catch \(error\) \{[\s\S]*?error: String\(error\),[\s\S]*?ok: false/);
    assert.match(copyBundle, /const final = await publishClipboard\(shot, viewerUrl, viewerContent\)/);
    assert.match(copyBundle, /if \(copyViewerContent \|\| final\.ok \|\| !published\?\.ok\) published = final;/);
    assert.doesNotMatch(copyBundle, /deviceToken|x-pinar-capability|[?&]token=/i);
  });

  test("runs copyBundle through authenticated remote and local fetches with exact full and compact clipboard payloads", async () => {
    // Mutation captured: skipping the saved-result guard or the authenticated fetch would either fetch an unsaved Markdown document or lose the capture on an optional failure.
    const harness = createChromeHarness();
    const originalChrome = globalThis.chrome;
    const originalFetch = globalThis.fetch;
    const remoteMarkdown = "# Viewer Markdown\n\n## Pin 1\nKeep context";
    let scenario = "remote";
    globalThis.chrome = harness.chrome;
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const path = requestPath(url);
      const headers = init.headers || {};
      harness.requests.push({ headers, path, url });
      if (scenario === "remote") {
        if (path === "/api/preferences") {
          return new Response(JSON.stringify({
            captureDestination: { collectionId: "collection-1", projectId: "project-1" },
            copyViewerContent: true,
            handoffMode: "full",
            includeScreenshot: true,
            includeViewer: true,
          }), { headers: { "content-type": "application/json" } });
        }
        if (path === "/api/project-tree") {
          return new Response(JSON.stringify({ tree: { projects: [{ collections: [{ id: "collection-1", isProtected: true }], id: "project-1" }] } }), { headers: { "content-type": "application/json" } });
        }
        if (path === "/api/shots") {
          return new Response(JSON.stringify({
            destination: { collectionId: "collection-1", projectId: "project-1" },
            path: "/shots/capture-integration.png",
            shotUrl: "https://pinar.dev/shots/capture-integration.png",
          }), { headers: { "content-type": "application/json" } });
        }
        if (path === "/v/capture-integration.md") return new Response(remoteMarkdown);
      } else {
        if (path === "/api/health") {
          return new Response(JSON.stringify({ ok: true, service: "pinar" }), { headers: { "content-type": "application/json" } });
        }
        if (path === "/api/local/capability") {
          return new Response(JSON.stringify({ token: "local-capability" }), { headers: { "content-type": "application/json" } });
        }
        if (path === "/api/preferences") {
          return new Response(JSON.stringify({
            captureDestination: { collectionId: "collection-1", projectId: "project-1" },
            copyViewerContent: true,
            handoffMode: "compact",
            includeScreenshot: true,
            includeViewer: true,
          }), { headers: { "content-type": "application/json" } });
        }
        if (path === "/api/project-tree") {
          return new Response(JSON.stringify({ tree: { projects: [{ collections: [{ id: "collection-1", isProtected: true }], id: "project-1" }] } }), { headers: { "content-type": "application/json" } });
        }
        if (path === "/api/shots") {
          return new Response(JSON.stringify({
            destination: { collectionId: "collection-1", projectId: "project-1" },
            path: "/shots/capture-local.png",
          }), { headers: { "content-type": "application/json" } });
        }
        if (path === "/v/capture-local.md") return new Response("unavailable", { status: 503 });
      }
      throw new Error(`unexpected test fetch: ${url}`);
    };

    try {
      const { copyBundle } = await import(`./background.js?viewer-content-integration=${Date.now()}`);
      configureCopySettings(harness, { handoffMode: "full", storageMode: "cloud" });
      const message = {
        captureId: "capture-integration",
        createdAt: "2026-09-26T12:00:00.000Z",
        fields: [],
        page: { title: "Example", url: "https://example.test/path" },
        pins: [{ comment: "Fix heading", coords: { x: 10, y: 20 }, id: "pin-1", kind: "point", path: "main h1", text: "Title" }],
        shot: "data:image/png;base64,AA==",
        viewport: { height: 600, width: 800 },
      };
      const remoteResult = await copyBundle(message);
      assert.equal(remoteResult.ok, true);
      assert.deepEqual(remoteResult.warnings, []);
      assert.equal(harness.clipboard.length, 1, "Markdown-only writes exactly once after the document is saved and fetched");
      const remoteClipboard = harness.clipboard.at(-1);
      assert.equal(remoteClipboard.type, "clipboard:write");
      assert.equal(remoteClipboard.plain, remoteMarkdown);
      assert.equal(remoteClipboard.html, `<pre>${remoteMarkdown}</pre>`);
      assert.doesNotMatch(remoteClipboard.plain, /pinar-visual-context/);
      assert.doesNotMatch(remoteClipboard.plain, /BEGIN PINAR VIEWER MARKDOWN/);
      const remoteRequests = harness.requests.filter(({ path }) => ["/api/preferences", "/api/project-tree", "/api/shots", "/v/capture-integration.md"].includes(path));
      assert.ok(remoteRequests.length >= 4);
      for (const request of remoteRequests) {
        assert.equal(request.headers.authorization, `Bearer ${harness.deviceToken}`);
      }
      assert.ok(
        harness.requests.findIndex(({ path }) => path === "/api/shots")
          < harness.requests.findIndex(({ path }) => path === "/v/capture-integration.md"),
        "viewer Markdown is fetched only after the saved capture response",
      );
      assert.equal(remoteRequests.find(({ path }) => path === "/v/capture-integration.md").url, "https://pinar.dev/v/capture-integration.md");

      scenario = "local";
      configureCopySettings(harness, { handoffMode: "compact", storageMode: "local" });
      const localResult = await copyBundle({ ...message, captureId: "capture-local" });
      assert.equal(localResult.ok, false);
      assert.match(localResult.error, /viewer_content_503/);
      assert.deepEqual(localResult.warnings, ["viewer_content_unavailable"]);
      assert.equal(harness.clipboard.length, 0, "a failed Markdown fetch does not leave compact Visual Context on the clipboard");
      const localRequests = harness.requests.filter(({ path }) => ["/api/preferences", "/api/project-tree", "/api/shots", "/v/capture-local.md"].includes(path));
      assert.ok(localRequests.length >= 4);
      for (const request of localRequests) {
        assert.equal(request.headers["x-pinar-capability"], "local-capability");
      }
      assert.equal(localRequests.find(({ path }) => path === "/v/capture-local.md").url, "http://127.0.0.1:17373/v/capture-local.md");
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.chrome = originalChrome;
    }
  });

  test("reports a failed final Markdown clipboard write without an earlier successful fallback", async () => {
    const harness = createChromeHarness({ writeClipboard: async () => ({ error: "clipboard denied", ok: false }) });
    const originalChrome = globalThis.chrome;
    const originalFetch = globalThis.fetch;
    globalThis.chrome = harness.chrome;
    globalThis.fetch = async (input) => {
      const path = requestPath(input);
      if (path === "/api/preferences") return new Response(JSON.stringify({
        captureDestination: { collectionId: "collection-1", projectId: "project-1" },
        copyViewerContent: true,
        handoffMode: "full",
        includeScreenshot: true,
        includeViewer: true,
      }), { headers: { "content-type": "application/json" } });
      if (path === "/api/project-tree") return new Response(JSON.stringify({ tree: { projects: [{ collections: [{ id: "collection-1", isProtected: true }], id: "project-1" }] } }), { headers: { "content-type": "application/json" } });
      if (path === "/api/shots") return new Response(JSON.stringify({ path: "/shots/capture-write-failure.png" }), { headers: { "content-type": "application/json" } });
      if (path === "/v/capture-write-failure.md") return new Response("# Saved viewer Markdown");
      throw new Error(`unexpected test fetch: ${String(input)}`);
    };

    try {
      const { copyBundle } = await import(`./background.js?viewer-content-write-failure=${Date.now()}`);
      configureCopySettings(harness, { handoffMode: "full", storageMode: "cloud" });
      const result = await copyBundle({
        captureId: "capture-write-failure",
        fields: [],
        page: { title: "Example", url: "https://example.test/path" },
        pins: [{ comment: "Retry me", id: "pin-1", kind: "point" }],
        shot: "data:image/png;base64,AA==",
      });
      assert.equal(result.ok, false);
      assert.match(result.error, /clipboard denied/);
      assert.equal(harness.clipboard.length, 1, "only the failed final Markdown write is attempted");
      assert.equal(harness.clipboard[0].plain, "# Saved viewer Markdown");
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.chrome = originalChrome;
    }
  });
});
