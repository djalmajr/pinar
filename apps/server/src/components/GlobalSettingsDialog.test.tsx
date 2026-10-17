import { type ComponentProps, createElement } from "react";
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
const switches = new Map<string, SwitchProps>();
const cascaders = new Map<string, CascaderProps>();
mock.module("@pinar/ui", () => ({
  ...ui,
  Cascader: (props: CascaderProps) => {
    cascaders.set(props["aria-label"], props);
    return createElement(ui.Cascader, props);
  },
  Switch: (props: SwitchProps) => {
    switches.set(String(props["aria-label"]), props);
    return createElement(ui.Switch, props);
  },
}));

type PreferencesValue = DeliveryPreferences & { available: boolean; patch: (partial: Partial<DeliveryPreferences>) => Promise<void> };
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

const { autoCaptureDestinationAvailable, CaptureDestinationSettings } = await import("./GlobalSettingsDialog");

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

function render({ autoAvailable = true, ...overrides }: Partial<DeliveryPreferences & { available: boolean }> & { autoAvailable?: boolean } = {}) {
  preferences = {
    ...DEFAULT_DELIVERY_PREFERENCES,
    available: true,
    ...overrides,
    patch: async (partial) => {
      patches.push(partial);
    },
  };
  switches.clear();
  cascaders.clear();
  const html = renderToStaticMarkup(
    <ServerI18nProvider initialLanguage="en" initialMessages={enUi}>
      <CaptureDestinationSettings autoAvailable={autoAvailable} projects={PROJECTS} />
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

  test("unavailable, the switch is disabled with the reason and the selector stays editable", () => {
    const unavailable = render({ autoAvailable: false, autoCaptureDestination: true });
    expect(unavailable.toggle.disabled).toBe(true);
    // Without a way to choose, the server files by the manual destination.
    expect(unavailable.toggle.checked).toBe(false);
    expect(unavailable.destination.disabled).toBe(false);
    expect(unavailable.html).toContain(UNAVAILABLE);

    const available = render({ autoAvailable: true });
    expect(available.toggle.disabled).toBe(false);
    expect(available.html).not.toContain(UNAVAILABLE);
  });

  test("preferences that did not load keep both controls disabled", () => {
    const { destination, toggle } = render({ available: false });
    expect(toggle.disabled).toBe(true);
    expect(destination.disabled).toBe(true);
  });

  test("only an explicit false from the server means unavailable", () => {
    expect(autoCaptureDestinationAvailable({ autoCaptureDestinationAvailable: false })).toBe(false);
    expect(autoCaptureDestinationAvailable({ autoCaptureDestinationAvailable: true })).toBe(true);
    // A server without the field (before the automatic filing) counts as able.
    expect(autoCaptureDestinationAvailable({ includeScreenshot: true })).toBe(true);
    expect(autoCaptureDestinationAvailable({ autoCaptureDestinationAvailable: "false" })).toBe(true);
    expect(autoCaptureDestinationAvailable({ autoCaptureDestinationAvailable: 0 })).toBe(true);
    expect(autoCaptureDestinationAvailable(null)).toBe(true);
    expect(autoCaptureDestinationAvailable("false")).toBe(true);
  });
});
