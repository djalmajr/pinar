import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_DELIVERY_PREFERENCES } from "@pinar/shared";
import { DeliveryPreferencesProvider, deliveryPreferencesFromBody, useDeliveryPreferences } from "@/lib/delivery-preferences";
import { ServerI18nProvider } from "@/lib/i18n";
import enUi from "@/lib/ui-locales/en";

const SERVER_ANSWER = { ...DEFAULT_DELIVERY_PREFERENCES, autoCaptureDestination: true, ok: true };

describe("delivery preferences: automatic destination availability", () => {
  test("reads the availability from a GET or PATCH answer of /api/preferences", () => {
    expect(deliveryPreferencesFromBody({ ...SERVER_ANSWER, autoCaptureDestinationAvailable: false })).toEqual({
      autoCaptureDestinationAvailable: false,
      preferences: { ...DEFAULT_DELIVERY_PREFERENCES, autoCaptureDestination: true },
    });
    expect(deliveryPreferencesFromBody({ ...SERVER_ANSWER, autoCaptureDestinationAvailable: true })?.autoCaptureDestinationAvailable).toBe(true);
  });

  test("an answer without the field, or with anything but false, counts as available", () => {
    expect(deliveryPreferencesFromBody(SERVER_ANSWER)?.autoCaptureDestinationAvailable).toBe(true);
    for (const value of ["false", 0, null, "no"]) {
      expect(deliveryPreferencesFromBody({ ...SERVER_ANSWER, autoCaptureDestinationAvailable: value })?.autoCaptureDestinationAvailable).toBe(true);
    }
  });

  test("a body that is not an object is no answer at all", () => {
    for (const body of [null, "false", 42, undefined]) expect(deliveryPreferencesFromBody(body)).toBeNull();
  });

  test("before the server answers, the provider reports available and the preferences as not loaded", () => {
    let seen: ReturnType<typeof useDeliveryPreferences> | null = null;
    function Probe() {
      seen = useDeliveryPreferences();
      return null;
    }
    renderToStaticMarkup(
      <ServerI18nProvider initialLanguage="en" initialMessages={enUi}>
        <DeliveryPreferencesProvider>
          <Probe />
        </DeliveryPreferencesProvider>
      </ServerI18nProvider>,
    );
    expect(seen).not.toBeNull();
    const value = seen as unknown as ReturnType<typeof useDeliveryPreferences>;
    expect(value.autoCaptureDestinationAvailable).toBe(true);
    expect(value.available).toBe(false);
    expect(value.autoCaptureDestination).toBe(false);
  });

  test("refresh reads GET /api/preferences again", async () => {
    let seen: ReturnType<typeof useDeliveryPreferences> | null = null;
    function Probe() {
      seen = useDeliveryPreferences();
      return null;
    }
    renderToStaticMarkup(
      <ServerI18nProvider initialLanguage="en" initialMessages={enUi}>
        <DeliveryPreferencesProvider>
          <Probe />
        </DeliveryPreferencesProvider>
      </ServerI18nProvider>,
    );
    const value = seen as unknown as ReturnType<typeof useDeliveryPreferences>;
    const realFetch = globalThis.fetch;
    const requests: Array<{ method: string; url: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ method: init?.method ?? "GET", url: String(input) });
      return new Response(JSON.stringify({ ...SERVER_ANSWER, autoCaptureDestinationAvailable: true }), { status: 200 });
    }) as typeof fetch;
    try {
      await value.refresh();
    } finally {
      globalThis.fetch = realFetch;
    }
    // The server render does not keep state, so this proves the read; the
    // browser e2e (capture-filing) proves the switch follows it.
    expect(requests).toEqual([{ method: "GET", url: "/api/preferences" }]);
  });
});
