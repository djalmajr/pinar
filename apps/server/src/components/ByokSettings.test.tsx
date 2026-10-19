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
  // The loader renders a marker so a test can see which button spins;
  // every other icon renders nothing.
  mock.module(spec, () => ({
    default: spec === "~icons/lucide/loader-circle" ? () => createElement("i", { "data-spinner": "" }) : () => null,
  }));
}

// bun test shares the module registry across the files of one process, so
// the @pinar/ui mock carries the real module's full surface and afterAll
// restores it (same pattern as HistoryDashboard.test.tsx); the i18n module
// is never mocked, the panel takes t and language as props.
const ui = { ...(await import("@pinar/ui")) };
mock.module("@pinar/ui", () => ({
  ...ui,
  AlertDialog: ({ children }: { children?: ReactNode }) => createElement("div", { "data-slot": "alert-dialog" }, children),
  AlertDialogAction: ({ children, onClick: _onClick, variant: _variant, ...rest }: { children?: ReactNode } & Record<string, unknown>) =>
    createElement("button", { "data-slot": "alert-dialog-action", type: "button", ...rest }, children),
  AlertDialogCancel: ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) =>
    createElement("button", { "data-slot": "alert-dialog-cancel", type: "button", ...rest }, children),
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

const {
  ByokRemoveDialog,
  ByokSettingsPanel,
  byokApiErrorKey,
  byokChangedView,
  byokCapabilityRow,
  byokFormDirty,
  byokHidden,
  byokTestFailedCapabilities,
  byokViewFrom,
  BYOK_DRAFTS_EMPTY,
} = await import("./ByokSettings");

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
    busy: null,
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
    unsavedCapabilities: null,
    view: savedView,
    ...overrides,
  }));
  return markup;
}

/** The buttons of the markup: their attributes and their text (the spinner icon is mocked to nothing). */
function buttons(markup: string): Array<{ attributes: string; spinners: number; text: string }> {
  return [...markup.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map((match) => ({
    attributes: match[1] ?? "",
    spinners: spinnerCount(match[2] ?? ""),
    text: (match[2] ?? "").replace(/<[^>]*>/g, ""),
  }));
}

function spinnerCount(markup: string): number {
  return markup.match(/data-spinner/g)?.length ?? 0;
}

function button(markup: string, text: string) {
  const found = buttons(markup).filter((item) => item.text === text);
  expect(found).toHaveLength(1);
  return found[0]!;
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
    ["byok_test_failed", "byok.errorTestFailed"],
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

  test("a byok_test_failed answer carries the tested capabilities, and nothing else does", () => {
    const capabilities = byokView().capabilities;
    const parsed = byokTestFailedCapabilities({ capabilities, code: "byok_test_failed", error: "nothing saved" });
    expect(parsed?.transcription).toEqual({ error: "model_not_found", ok: false, testedAt: "2026-10-18T12:00:10.000Z" });
    expect(parsed?.embeddings.dims).toBe(256);
    expect(byokTestFailedCapabilities({ code: "byok_test_failed" })).toBeNull();
    expect(byokTestFailedCapabilities({ capabilities, code: "byok_changed" })).toBeNull();
    expect(byokTestFailedCapabilities(null)).toBeNull();
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
    // The masked tail is a text input, so the last four characters show.
    expect(markup).toMatch(/<input[^>]*type="text"[^>]*value="••••1234"/);
    expect(markup).toContain("byok.changeKey");
    expect(markup).toContain("byok.remove");
    expect(markup).toContain("settings.aiTestConnection");
    expect(markup).not.toContain("byok.testAndSave");
    // The never-leak rule: only the last four characters reach the markup.
    expect(markup).not.toContain("sk-secret");
  });

  test("key editing: the input goes back to a draft and the change button goes away", () => {
    const markup = renderPanel({ keyDraft: "", keyEditing: true });
    expect(markup).not.toContain("byok.changeKey");
    expect(markup).toContain('type="password"');
  });

  test("one action button at a time: Test and save while unsaved, Test connection when the form is the saved endpoint", () => {
    const cases: Array<[label: string, overrides: Record<string, unknown>, action: string]> = [
      ["no endpoint yet", { drafts: BYOK_DRAFTS_EMPTY, view: null }, "byok.testAndSave"],
      ["saved and unchanged", {}, "settings.aiTestConnection"],
      ["an edited URL", { drafts: { ...drafts, baseUrl: "https://other.example.com/v1" } }, "byok.testAndSave"],
      ["an edited model", { drafts: { ...drafts, transcriptionModel: "whisper-x" } }, "byok.testAndSave"],
      ["a new key typed", { keyDraft: "sk-new", keyEditing: true }, "byok.testAndSave"],
      ["Change key active", { keyEditing: true }, "byok.testAndSave"],
    ];
    for (const [label, overrides, action] of cases) {
      const markup = renderPanel(overrides);
      const other = action === "byok.testAndSave" ? "settings.aiTestConnection" : "byok.testAndSave";
      expect(markup, label).toContain(action);
      expect(markup, label).not.toContain(other);
      const actionButton = button(markup, action);
      expect(actionButton.attributes, label).toContain('type="submit"');
      expect(actionButton.attributes, label).not.toContain("disabled");
    }
    expect(byokFormDirty(savedView, drafts, "", false)).toBe(false);
    expect(byokFormDirty(null, drafts, "", false)).toBe(true);
    expect(byokFormDirty(savedView, { ...drafts, chatModel: "gpt-y" }, "", false)).toBe(true);
    expect(byokFormDirty(savedView, drafts, "sk-new", false)).toBe(true);
    expect(byokFormDirty(savedView, drafts, "", true)).toBe(true);
  });

  test("busy: only the clicked button shows the spinner and the testing label; the others are disabled with their own labels", () => {
    // Test and save (unsaved edits): its button is busy, remove and change key are disabled.
    const saving = renderPanel({ busy: "testSave", drafts: { ...drafts, chatModel: "gpt-y" } });
    expect(saving.match(/settings\.aiTesting/g)).toHaveLength(1);
    const busySave = button(saving, "settings.aiTesting");
    expect(busySave.attributes).toContain('data-action="testSave"');
    expect(busySave.attributes).toContain('aria-busy="true"');
    expect(busySave.attributes).toContain("disabled");
    expect(busySave.spinners).toBe(1);
    expect(spinnerCount(saving)).toBe(1);
    for (const label of ["byok.remove", "byok.changeKey"]) {
      const idle = button(saving, label);
      expect(idle.attributes, label).toContain("disabled");
      expect(idle.attributes, label).not.toContain("aria-busy");
      expect(idle.spinners, label).toBe(0);
    }

    // Test connection (saved, unchanged): the same rule.
    const testing = renderPanel({ busy: "test" });
    expect(testing.match(/settings\.aiTesting/g)).toHaveLength(1);
    const busyTest = button(testing, "settings.aiTesting");
    expect(busyTest.attributes).toContain('data-action="test"');
    expect(busyTest.attributes).toContain('aria-busy="true"');
    expect(busyTest.spinners).toBe(1);
    expect(spinnerCount(testing)).toBe(1);
    expect(button(testing, "byok.remove").attributes).toContain("disabled");
    expect(button(testing, "byok.remove").attributes).not.toContain("aria-busy");
    expect(button(testing, "byok.remove").spinners).toBe(0);

    // Remove: its own in-progress label; the test action keeps its label, disabled.
    const removing = renderPanel({ busy: "remove" });
    expect(removing).not.toContain("settings.aiTesting");
    expect(button(removing, "byok.removing").attributes).toContain('aria-busy="true"');
    expect(button(removing, "byok.removing").spinners).toBe(1);
    expect(spinnerCount(removing)).toBe(1);
    const idleTest = button(removing, "settings.aiTestConnection");
    expect(idleTest.attributes).toContain("disabled");
    expect(idleTest.attributes).not.toContain("aria-busy");
    expect(idleTest.spinners).toBe(0);

    // Remove with unsaved edits: "Test and save" keeps its own label, disabled.
    const removingDirty = renderPanel({ busy: "remove", drafts: { ...drafts, chatModel: "gpt-y" } });
    expect(removingDirty).not.toContain("settings.aiTesting");
    const idleSave = button(removingDirty, "byok.testAndSave");
    expect(idleSave.attributes).toContain("disabled");
    expect(idleSave.attributes).not.toContain("aria-busy");
    expect(idleSave.spinners).toBe(0);
    expect(button(removingDirty, "byok.removing").attributes).toContain('aria-busy="true"');
    expect(spinnerCount(removingDirty)).toBe(1);

    // Idle: nothing is busy and nothing is disabled.
    const idle = renderPanel();
    expect(idle).not.toContain("aria-busy");
    expect(spinnerCount(idle)).toBe(0);
    expect(button(idle, "settings.aiTestConnection").attributes).not.toContain("disabled");
  });

  test("the remove dialog follows the same rule: only its action is busy while the DELETE runs", () => {
    const render = (busy: "remove" | null) => renderToStaticMarkup(createElement(ByokRemoveDialog, {
      busy,
      onCancel: () => undefined,
      onConfirm: () => undefined,
      open: true,
      t,
    }));
    const removing = render("remove");
    expect(removing).toContain("byok.removing");
    // The action spins (its loader comes first); the cancel is only disabled.
    expect(removing).toMatch(/<button data-slot="alert-dialog-action"[^>]*aria-busy="true"[^>]*disabled=""[^>]*><i data-spinner=""><\/i>byok\.removing/);
    expect(removing).toMatch(/<button[^>]*data-slot="alert-dialog-cancel"[^>]*disabled=""[^>]*>common\.cancel<\/button>/);
    expect(spinnerCount(removing)).toBe(1);
    const idle = render(null);
    expect(idle).toContain("byok.remove");
    expect(idle).not.toContain("byok.removing");
    expect(idle).not.toContain("disabled");
    expect(spinnerCount(idle)).toBe(0);
  });

  test("an unsaved test result (422): the tested capabilities in the same list, marked as not saved", () => {
    const failed = byokTestFailedCapabilities({
      capabilities: {
        chat: { error: "key_rejected", ok: false, testedAt: "2026-10-19T09:00:00.000Z" },
        embeddings: { dims: null, error: "key_rejected", ok: false, testedAt: "2026-10-19T09:00:00.000Z" },
        tools: { error: "key_rejected", ok: false, testedAt: "2026-10-19T09:00:00.000Z" },
        transcription: { error: "model_not_configured", ok: false, testedAt: "2026-10-19T09:00:00.000Z" },
        vision: { error: "key_rejected", ok: false, testedAt: "2026-10-19T09:00:00.000Z" },
      },
      code: "byok_test_failed",
    });
    // No endpoint saved yet: the list appears only with the unsaved result.
    expect(renderPanel({ drafts: BYOK_DRAFTS_EMPTY, view: null })).not.toContain("byok.capabilities");
    const markup = renderPanel({ drafts: BYOK_DRAFTS_EMPTY, error: "byok.errorTestFailed", keyDraft: "sk-typed", keyEditing: true, unsavedCapabilities: failed, view: null });
    expect(markup).toContain("byok.capabilities");
    expect(markup).toContain("byok.unsavedResult");
    expect(markup).toContain('data-unsaved="true"');
    expect(markup).toContain("byok.cause.key_rejected");
    expect(markup).not.toContain("byok.sourceEndpoint");
    expect(markup).toContain("byok.errorTestFailed");
    // The typed key stays in its field for the retry.
    expect(markup).toMatch(/<input[^>]*type="password"[^>]*value="sk-typed"/);
    // Over a saved endpoint, the unsaved result replaces the saved one in the list.
    const over = renderPanel({ keyDraft: "sk-typed", keyEditing: true, unsavedCapabilities: failed });
    expect(over).toContain("byok.unsavedResult");
    expect(over).not.toContain("byok.sourceEndpoint");
    // Without an unsaved result there is no mark.
    expect(renderPanel()).not.toContain("byok.unsavedResult");
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
      "byok.errorTestFailed",
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

describe("byok i18n parity", () => {
  const LOCALES = ["de", "en", "es", "fr", "ja", "pt", "zh"] as const;
  const KEYS = ["byok.testAndSave", "byok.removing", "byok.unsavedResult", "byok.errorTestFailed"] as const;

  test("the new BYOK keys exist, translated, in the 7 interface languages", async () => {
    const english = (await import("@/lib/ui-locales/en")).default as Record<string, string>;
    for (const locale of LOCALES) {
      const messages = (await import(`@/lib/ui-locales/${locale}`)).default as Record<string, string>;
      expect(Object.keys(messages).sort(), locale).toEqual(Object.keys(english).sort());
      for (const key of KEYS) {
        expect(typeof messages[key], `${locale} ${key}`).toBe("string");
        expect(messages[key]!.trim().length, `${locale} ${key}`).toBeGreaterThan(0);
        if (locale !== "en") expect(messages[key], `${locale} ${key}`).not.toBe(english[key]);
      }
    }
  });

  test("invalid_api_key has a generic invalid-key text (it covers the length and the inner whitespace)", async () => {
    const expected: Record<(typeof LOCALES)[number], string> = {
      de: "Der API-Schlüssel ist ungültig.",
      en: "The API key is not valid.",
      es: "La clave API no es válida.",
      fr: "La clé API n’est pas valide.",
      ja: "API キーが無効です。",
      pt: "A chave da API não é válida.",
      zh: "API 密钥无效。",
    };
    expect(byokApiErrorKey("invalid_api_key")).toBe("byok.errorInvalidApiKey");
    for (const locale of LOCALES) {
      const messages = (await import(`@/lib/ui-locales/${locale}`)).default as Record<string, string>;
      expect(messages["byok.errorInvalidApiKey"], locale).toBe(expected[locale]);
    }
  });
});
