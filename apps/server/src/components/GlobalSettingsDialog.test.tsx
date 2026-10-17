import { type ComponentProps, createElement, type ReactNode } from "react";
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_DELIVERY_PREFERENCES, type DeliveryPreferences, type ProjectTreeProject } from "@pinar/shared";
import { ServerI18nProvider } from "@/lib/i18n";
import enUi from "@/lib/ui-locales/en";

// Headless rendering of the real components (same approach as
// lib/auth-session-ssr.test.tsx): only the icon virtual modules, which
// resolve under Vite alone, become empty components. Bun's module mocks are
// shared by every file of the run, so the two modules wrapped here keep their
// real exports, only observe the props, and are put back after this file.
const ROOTS = [new URL("..", import.meta.url).pathname, new URL("../../../../packages/ui/src", import.meta.url).pathname];
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

const ui = { ...(await import("@pinar/ui")) };
type SwitchProps = ComponentProps<typeof ui.Switch>;
type CascaderProps = ComponentProps<typeof ui.Cascader>;
type ButtonProps = ComponentProps<typeof ui.Button>;
const switches = new Map<string, SwitchProps>();
const cascaders = new Map<string, CascaderProps>();
const buttons: ButtonProps[] = [];
// A dialog portal renders nothing on the server, so its parts become plain
// containers for this file and the whole settings body is in the markup.
const container = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
mock.module("@pinar/ui", () => ({
  ...ui,
  Button: (props: ButtonProps) => {
    buttons.push(props);
    return createElement(ui.Button, props);
  },
  Dialog: container,
  DialogClose: container,
  DialogContent: container,
  DialogDescription: container,
  DialogTitle: container,
  Cascader: (props: CascaderProps) => {
    cascaders.set(props["aria-label"], props);
    return createElement(ui.Cascader, props);
  },
  Switch: (props: SwitchProps) => {
    switches.set(String(props["aria-label"]), props);
    return createElement(ui.Switch, props);
  },
}));

type PreferencesValue = DeliveryPreferences & {
  autoCaptureDestinationAvailable: boolean;
  available: boolean;
  patch: (partial: Partial<DeliveryPreferences>) => Promise<void>;
  refresh: () => Promise<void>;
};
const deliveryPreferences = { ...(await import("@/lib/delivery-preferences")) };
const patches: Array<Partial<DeliveryPreferences>> = [];
let preferences: PreferencesValue | null = null;
mock.module("@/lib/delivery-preferences", () => ({
  ...deliveryPreferences,
  useDeliveryPreferences: () => preferences ?? deliveryPreferences.useDeliveryPreferences(),
}));

afterAll(() => {
  mock.module("@pinar/ui", () => ui);
  mock.module("@/lib/delivery-preferences", () => deliveryPreferences);
});

const { CaptureDestinationSettings, GlobalSettingsDialog } = await import("./GlobalSettingsDialog");

const STAMP = { createdAt: "2026-10-17T00:00:00.000Z", ownerId: "owner", updatedAt: "2026-10-17T00:00:00.000Z" };
const PROJECTS: ProjectTreeProject[] = [{
  ...STAMP,
  collections: [
    { ...STAMP, id: "inbox", isProtected: true, name: "Inbox", parentId: null, position: 0, projectId: "personal", sessions: [] },
    { ...STAMP, id: "design", isProtected: false, name: "Design", parentId: null, position: 1, projectId: "personal", sessions: [] },
  ],
  icon: "folder",
  id: "personal",
  isProtected: true,
  name: "Personal",
  position: 0,
}];

const AUTO_LABEL = enUi["settings.autoCaptureDestination"];
const DESTINATION_LABEL = enUi["settings.captureDestination"];
const UNAVAILABLE = enUi["settings.autoCaptureDestinationUnavailable"];
const INBOX_FALLBACK = enUi["settings.autoCaptureDestinationInboxFallback"];

function render(overrides: Partial<DeliveryPreferences & { autoCaptureDestinationAvailable: boolean; available: boolean }> = {}) {
  preferences = {
    ...DEFAULT_DELIVERY_PREFERENCES,
    autoCaptureDestinationAvailable: true,
    available: true,
    ...overrides,
    patch: async (partial) => {
      patches.push(partial);
    },
    refresh: async () => {},
  };
  switches.clear();
  cascaders.clear();
  const html = renderToStaticMarkup(
    <ServerI18nProvider initialLanguage="en" initialMessages={enUi}>
      <CaptureDestinationSettings projects={PROJECTS} />
    </ServerI18nProvider>,
  );
  const toggle = switches.get(AUTO_LABEL);
  const destination = cascaders.get(DESTINATION_LABEL);
  if (!toggle || !destination) throw new Error("the section rendered without its two controls");
  // The real trigger carries the disabled attribute, not only a style.
  const trigger = html.match(new RegExp(`<button[^>]*aria-label="${DESTINATION_LABEL}"[^>]*>`))?.[0] ?? "";
  return { destination, destinationDisabledAttribute: / disabled=""/.test(trigger), html, toggle };
}

afterEach(() => {
  patches.length = 0;
  preferences = null;
});

describe("Settings → Capture: automatic collection", () => {
  test("the switch saves the setting through the preferences patch", () => {
    const off = render();
    expect(off.toggle.checked).toBe(false);
    off.toggle.onCheckedChange?.(true, {} as Parameters<NonNullable<SwitchProps["onCheckedChange"]>>[1]);
    expect(patches).toEqual([{ autoCaptureDestination: true }]);

    const on = render({ autoCaptureDestination: true });
    on.toggle.onCheckedChange?.(false, {} as Parameters<NonNullable<SwitchProps["onCheckedChange"]>>[1]);
    expect(patches).toEqual([{ autoCaptureDestination: true }, { autoCaptureDestination: false }]);
  });

  test("on, the destination selector is disabled; off, it stays editable", () => {
    const on = render({ autoCaptureDestination: true });
    expect(on.toggle.checked).toBe(true);
    expect(on.destination.disabled).toBe(true);
    expect(on.destinationDisabledAttribute).toBe(true);

    const off = render({ autoCaptureDestination: false });
    expect(off.toggle.checked).toBe(false);
    expect(off.destination.disabled).toBe(false);
    expect(off.destinationDisabledAttribute).toBe(false);
  });

  // The switch shows the saved setting in every state; the selector is locked
  // whenever the setting is on, since the server keeps filing automatically.
  test("unavailable and off: the switch cannot be turned on, with the reason; the selector stays editable", () => {
    const { destination, html, toggle } = render({ autoCaptureDestination: false, autoCaptureDestinationAvailable: false });
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(true);
    expect(destination.disabled).toBe(false);
    expect(html).toContain(UNAVAILABLE);
    expect(html).not.toContain(INBOX_FALLBACK);
  });

  test("unavailable and on: the switch shows on and can only be turned off; the selector stays locked", () => {
    const { destination, destinationDisabledAttribute, html, toggle } = render({ autoCaptureDestination: true, autoCaptureDestinationAvailable: false });
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(false);
    expect(destination.disabled).toBe(true);
    expect(destinationDisabledAttribute).toBe(true);
    expect(html).toContain(INBOX_FALLBACK);
    expect(html).not.toContain(UNAVAILABLE);
    toggle.onCheckedChange?.(false, {} as Parameters<NonNullable<SwitchProps["onCheckedChange"]>>[1]);
    expect(patches).toEqual([{ autoCaptureDestination: false }]);
  });

  test("available and off: the switch can be turned on and the selector stays editable", () => {
    const { destination, html, toggle } = render({ autoCaptureDestination: false, autoCaptureDestinationAvailable: true });
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(false);
    expect(destination.disabled).toBe(false);
    expect(html).not.toContain(UNAVAILABLE);
    expect(html).not.toContain(INBOX_FALLBACK);
  });

  test("available and on: the switch shows on and the selector is locked", () => {
    const { destination, html, toggle } = render({ autoCaptureDestination: true, autoCaptureDestinationAvailable: true });
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(false);
    expect(destination.disabled).toBe(true);
    expect(html).not.toContain(UNAVAILABLE);
    expect(html).not.toContain(INBOX_FALLBACK);
  });

  test("preferences that did not load keep both controls disabled", () => {
    const { destination, toggle } = render({ available: false });
    expect(toggle.disabled).toBe(true);
    expect(destination.disabled).toBe(true);
  });
});

describe("Settings → AI: saving reads the preferences again", () => {
  const ENV = import.meta.env as Record<string, unknown>;
  const savedRuntime = ENV.VITE_PINAR_RUNTIME;
  const realFetch = globalThis.fetch;
  const requests: Array<{ method: string; url: string }> = [];
  let refreshes = 0;

  // The fetch of this file alone: it answers the AI settings PATCH and never
  // reaches a server.
  function answerAiSettings(status: number, body: unknown) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ method: init?.method ?? "GET", url: String(input) });
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
    }) as typeof fetch;
  }

  // The real Save button of the local AI section, rendered with the real dialog.
  function saveButton() {
    ENV.VITE_PINAR_RUNTIME = "local";
    preferences = {
      ...DEFAULT_DELIVERY_PREFERENCES,
      autoCaptureDestinationAvailable: false,
      available: true,
      patch: async () => {},
      refresh: async () => {
        refreshes += 1;
      },
    };
    buttons.length = 0;
    renderToStaticMarkup(
      <ServerI18nProvider initialLanguage="en" initialMessages={enUi}>
        <GlobalSettingsDialog open onOpenChange={() => {}} />
      </ServerI18nProvider>,
    );
    const save = buttons.find((props) => props.children === enUi["settings.aiSave"]);
    if (!save?.onClick) throw new Error("the AI section rendered no Save button");
    return () => save.onClick?.({} as Parameters<NonNullable<ButtonProps["onClick"]>>[0]);
  }

  // The click starts the save without returning it: let its awaits run.
  async function settle() {
    for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  afterEach(() => {
    globalThis.fetch = realFetch;
    ENV.VITE_PINAR_RUNTIME = savedRuntime;
    requests.length = 0;
    refreshes = 0;
  });

  test("a save that succeeds refreshes the preferences once", async () => {
    answerAiSettings(200, { hasApiKey: false, ok: true });
    saveButton()();
    await settle();
    expect(requests).toEqual([{ method: "PATCH", url: "/api/ai/settings" }]);
    expect(refreshes).toBe(1);
  });

  test("a save that fails does not refresh them", async () => {
    answerAiSettings(400, { error: "Endpoint unreachable" });
    saveButton()();
    await settle();
    expect(requests).toEqual([{ method: "PATCH", url: "/api/ai/settings" }]);
    expect(refreshes).toBe(0);
  });
});
