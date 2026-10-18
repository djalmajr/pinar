// F5/S4: the BYOK endpoint subpanel. Headless rendering (same approach as
// assistant-components.test.tsx): the UI package's barrel is replaced by
// structural stand-ins, so the assertions observe the subpanel markup
// itself. t is the identity so the rendered labels are the i18n keys.
// bun test shares the module registry across the files of one process, so
// the mock carries the real module's full surface and afterAll restores it
// (same pattern as HistoryDashboard.test.tsx); the i18n module is never
// mocked, the panel takes t and language as props.
import { createElement, type ReactNode } from "react";
import { afterAll, describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ServerMessageKey, Translate } from "@/lib/i18n";

// The icon virtual modules resolve under Vite alone: every spec the app and
// the UI package reference is mocked as an empty component before the real
// @pinar/ui barrel loads (same scan as HistoryDashboard.test.tsx).
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

// bun test shares the module registry across the files of one process, so
// the @pinar/ui mock carries the real module's full surface and afterAll
// restores it (same pattern as HistoryDashboard.test.tsx); the i18n module
// is never mocked, the panel takes t and language as props.
const ui = { ...(await import("@pinar/ui")) };
mock.module("@pinar/ui", () => ({
  ...ui,
  AlertDialog: ({ children }: { children?: ReactNode }) => createElement("div", { "data-slot": "alert-dialog" }, children),
  AlertDialogAction: ({ children }: { children?: ReactNode }) =>
    createElement("button", { "data-slot": "alert-dialog-action", type: "button" }, children),
  AlertDialogCancel: ({ children }: { children?: ReactNode }) =>
    createElement("button", { "data-slot": "alert-dialog-cancel", type: "button" }, children),
  AlertDialogContent: ({ children }: { children?: ReactNode }) =>
    createElement("div", { "data-slot": "alert-dialog-content" }, children),
  AlertDialogDescription: ({ children }: { children?: ReactNode }) =>
    createElement("p", { "data-slot": "alert-dialog-description" }, children),
  AlertDialogFooter: ({ children }: { children?: ReactNode }) =>
    createElement("div", { "data-slot": "alert-dialog-footer" }, children),
  AlertDialogHeader: ({ children }: { children?: ReactNode }) =>
    createElement("div", { "data-slot": "alert-dialog-header" }, children),
  AlertDialogTitle: ({ children }: { children?: ReactNode }) =>
    createElement("h2", { "data-slot": "alert-dialog-title" }, children),
  Badge: ({ children, variant }: { children?: ReactNode; variant?: string }) =>
    createElement("span", { "data-slot": "badge", "data-variant": variant }, children),
  Button: ({
    children,
    ...rest
  }: {
    children?: ReactNode;
  } & Record<string, unknown>) =>
    createElement("button", { type: "button", ...rest }, children),
  Input: ({
    value,
    ...rest
  }: {
    value?: string;
  } & Record<string, unknown>) =>
    createElement("input", { "data-slot": "input", value, ...rest }),
  SectionHeading: ({ children }: { children?: ReactNode }) =>
    createElement("h3", { "data-slot": "section-heading" }, children),
  toast: { error: () => undefined, success: () => undefined },
}));
afterAll(() => {
  mock.module("@pinar/ui", () => ui);
});

const { ByokSettingsPanel, byokApiErrorKey, byokChangedView, byokCapabilityRow, byokHidden, byokViewFrom, BYOK_DRAFTS_EMPTY } =
  await import("./ByokSettings");

const t: Translate = (key) => key as string;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// The view GET /api/byok returns for a configured endpoint (F5/S1).
function byokView(partial?: Record<string, unknown>): Record<string, unknown> {
  return {
    baseUrl: "https://provider.example.com/v1",
    capabilities: {
      chat: { error: null, ok: true, testedAt: "2026-10-18T12:00:00.000Z" },
      embeddings: { dims: 256, error: null, ok: true, testedAt: "2026-10-18T12:00:05.000Z" },
      tools: { error: null, ok: true, testedAt: "2026-10-18T12:00:00.000Z" },
      transcription: { error: "model_not_found", ok: false, testedAt: "2026-10-18T12:00:10.000Z" },
      vision: { error: null, ok: null, testedAt: null },
    },
    configured: true,
    keyLast4: "1234",
    models: { chat: "gpt-x", embedding: "emb-1", transcription: null },
    updatedAt: "2026-10-18T12:00:10.000Z",
    ...partial,
  };
}

const savedView = byokViewFrom(byokView())!;
const drafts = { baseUrl: "https://provider.example.com/v1", chatModel: "gpt-x", embeddingModel: "emb-1", transcriptionModel: "" };

function renderPanel(overrides: Record<string, unknown> = {}) {
  const markup = renderToStaticMarkup(createElement(ByokSettingsPanel, {
    busy: "idle",
    drafts,
    error: null,
    keyDraft: "",
    keyEditing: false,
    language: "en",
    onChangeKey: () => undefined,
    onDraftsChange: () => undefined,
    onKeyDraftChange: () => undefined,
    onRemove: () => undefined,
    onSave: () => undefined,
    onTest: () => undefined,
    t,
    view: savedView,
    ...overrides,
  }));
  return markup;
}

describe("byok view parsing (the shape the UI trusts)", () => {
  test("a valid configured view parses with the capabilities and the last four key characters", () => {
    expect(savedView.configured).toBe(true);
    expect(savedView.keyLast4).toBe("1234");
    expect(savedView.baseUrl).toBe("https://provider.example.com/v1");
    expect(savedView.capabilities.embeddings.dims).toBe(256);
    expect(savedView.models).toEqual({ chat: "gpt-x", embedding: "emb-1", transcription: null });
  });

  test("an unconfigured view parses with the null fields", () => {
    const view = byokViewFrom(byokView({ baseUrl: null, capabilities: {
      chat: { error: null, ok: null, testedAt: null },
      embeddings: { dims: null, error: null, ok: null, testedAt: null },
      tools: { error: null, ok: null, testedAt: null },
      transcription: { error: null, ok: null, testedAt: null },
      vision: { error: null, ok: null, testedAt: null },
    }, configured: false, keyLast4: null, models: { chat: null, embedding: null, transcription: null }, updatedAt: null }));
    expect(view?.configured).toBe(false);
    expect(view?.keyLast4).toBeNull();
    expect(view?.models).toEqual({ chat: null, embedding: null, transcription: null });
  });

  test("anything malformed or an error body is null (the subpanel degrades to hidden)", () => {
    for (const value of [
      null,
      undefined,
      "text",
      42,
      { code: "byok_unavailable", error: "BYOK is not available in this deployment" },
      { code: "byok_not_configured" },
      byokView({ configured: "yes" }),
      { configured: true },
    ]) {
      expect(byokViewFrom(value)).toBeNull();
    }
  });
});

describe("byokHidden (S4 availability: the subpanel does not appear)", () => {
  test("a 503 byok_unavailable hides the subpanel", () => {
    expect(byokHidden(response({ code: "byok_unavailable", error: "unavailable" }, 503), { code: "byok_unavailable" })).toBe(true);
  });

  test("any other failed answer hides it too (non-Pro, network error bodies)", () => {
    expect(byokHidden(response({ code: "byok_requires_pro" }, 402), { code: "byok_requires_pro" })).toBe(true);
    expect(byokHidden(response({ error: "not found" }, 404), { error: "not found" })).toBe(true);
  });

  test("a 200 with a valid view shows it, and a 200 with a malformed body hides it", () => {
    expect(byokHidden(response(byokView()), byokView())).toBe(false);
    expect(byokHidden(response({ configured: true }), { configured: true })).toBe(true);
  });
});

describe("byokCapabilityRow (the origin of every capability)", () => {
  const part = (ok: boolean | null, error: string | null = null, testedAt: string | null = "2026-10-18T12:00:00.000Z") =>
    ({ error, ok, testedAt });

  test("chat with tools passes the parts [tools, chat]: both ok is the endpoint", () => {
    expect(byokCapabilityRow([part(true), part(true)])).toEqual({ cause: null, source: "endpoint", testedAt: "2026-10-18T12:00:00.000Z" });
    // A failure keeps the same cause on both parts; the first failing cause wins.
    expect(byokCapabilityRow([part(false, "model_not_found"), part(false, "model_not_found")])).toEqual({
      cause: "model_not_found",
      source: "credits",
      testedAt: "2026-10-18T12:00:00.000Z",
    });
    expect(byokCapabilityRow([part(true), part(false, "key_rejected")]).cause).toBe("key_rejected");
  });

  test("a failed capability rides the Pinar credits with its cause", () => {
    expect(byokCapabilityRow([part(false, "rate_limited")]).source).toBe("credits");
    expect(byokCapabilityRow([part(false, "rate_limited")]).cause).toBe("rate_limited");
    // A failed part without a readable cause still rides the credits (no cause text).
    expect(byokCapabilityRow([part(false, null)]).cause).toBeNull();
  });

  test("no result anywhere is untested", () => {
    expect(byokCapabilityRow([part(null, null, null), part(null, null, null)])).toEqual({ cause: null, source: "untested", testedAt: null });
  });
});

describe("byok error codes (each one has its own text)", () => {
  const codes: Array<[code: string | null | undefined, key: ServerMessageKey]> = [
    ["api_key_required", "byok.errorApiKeyRequired"],
    ["byok_changed", "byok.errorChanged"],
    ["byok_not_configured", "byok.errorNotConfigured"],
    ["byok_requires_pro", "byok.errorRequiresPro"],
    ["byok_test_limited", "byok.errorTestLimited"],
    ["byok_unavailable", "byok.errorUnavailable"],
    ["invalid_api_key", "byok.errorInvalidApiKey"],
    ["invalid_base_url", "byok.errorInvalidBaseUrl"],
    ["invalid_model", "byok.errorInvalidModel"],
    ["something_else", "byok.errorUnknown"],
    [null, "byok.errorUnknown"],
    [undefined, "byok.errorUnknown"],
  ];
  test("every /api/byok code maps to its own key and the unknown codes fall back", () => {
    for (const [code, key] of codes) expect(byokApiErrorKey(code)).toBe(key);
  });

  test("a byok_changed answer carries the current view (the subpanel reloads it)", () => {
    expect(byokChangedView({ code: "byok_changed", view: byokView() })?.configured).toBe(true);
    expect(byokChangedView({ code: "byok_changed" })).toBeNull();
    expect(byokChangedView({ code: "byok_test_limited" })).toBeNull();
  });
});

describe("ByokSettingsPanel states (headless)", () => {
  test("empty (no endpoint yet): the empty note, the form and no remove button", () => {
    const markup = renderPanel({ view: null, drafts: BYOK_DRAFTS_EMPTY });
    expect(markup).toContain("byok.empty");
    expect(markup).toContain("byok.heading");
    // The two contract sentences (S4: what passes the test uses the endpoint
    // without credits; the provider is chosen and contracted by the user).
    expect(markup).toContain("byok.description");
    expect(markup).toContain("byok.providerNote");
    expect(markup).not.toContain("byok.remove");
    expect(markup).not.toContain("byok.sourceEndpoint");
    // The key field starts as an empty password input.
    expect(markup).toContain('type="password"');
    expect(markup).toContain('value=""');
  });

  test("saved: the masked key with its change button and the remove button", () => {
    const markup = renderPanel();
    expect(markup).toContain("••••1234");
    expect(markup).toContain("byok.changeKey");
    expect(markup).toContain("byok.remove");
    expect(markup).toContain("settings.aiTestConnection");
    // The never-leak rule: only the last four characters reach the markup.
    expect(markup).not.toContain("sk-secret");
  });

  test("key editing: the input goes back to a draft and the change button goes away", () => {
    const markup = renderPanel({ keyDraft: "", keyEditing: true });
    expect(markup).not.toContain("byok.changeKey");
    expect(markup).toContain('type="password"');
  });

  test("testing: the spinner state on both actions and the disabled test button", () => {
    const markup = renderPanel({ busy: "testing" });
    expect(markup).toContain("settings.aiTesting");
    expect(markup).not.toContain("settings.aiTestConnection");
  });

  test("mixed capabilities: the endpoint badge, the credits badge with its cause, the untested one, and the test date", () => {
    const tWithValues: Translate = (key, values) => (values?.date ? `${key}:${values.date}` : key);
    const markup = renderPanel({ t: tWithValues });
    // chat with tools: tools ok + chat ok → the endpoint.
    const toolsBadge = 'data-variant="successSoft">byok.sourceEndpoint';
    expect(markup).toContain(toolsBadge);
    // vision: untested → "not tested".
    expect(markup).toContain('data-variant="secondary">byok.sourceUntested');
    // embeddings: ok → the endpoint; transcription: failed → the credits with the cause.
    expect(markup).toContain("byok.cause.model_not_found");
    expect(markup).toContain('data-variant="outline">byok.sourceCredits');
    // The test date (the first testedAt in the view, formatted by the panel).
    expect(markup).toContain(
      `byok.lastTested:${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date("2026-10-18T12:00:00.000Z"))}`,
    );
  });

  test("each error is its own text, in the polite region", () => {
    for (const error of [
      "byok.errorChanged",
      "byok.errorTestLimited",
      "byok.errorInvalidBaseUrl",
      "byok.errorInvalidApiKey",
      "byok.errorInvalidModel",
      "byok.errorApiKeyRequired",
      "byok.errorRequiresPro",
      "byok.errorUnavailable",
      "byok.errorNotConfigured",
    ]) {
      const markup = renderPanel({ error });
      expect(markup).toContain(`aria-live="polite"`);
      expect(markup).toContain(error);
    }
  });

  test("the model fields are all three and optional (the placeholder text says so)", () => {
    const markup = renderPanel();
    expect(markup).toContain("byok.chatModel");
    expect(markup).toContain("byok.embeddingModel");
    expect(markup).toContain("settings.aiTranscriptionModel");
    expect(markup).toContain("byok.modelDescription");
  });
});
