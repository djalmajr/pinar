import { describe, expect, test } from "bun:test";
import * as React from "react";
import type { ReactElement } from "react";
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

type ContextValue = ReturnType<typeof useDeliveryPreferences>;
type Deps = readonly unknown[] | undefined;

// The repo has no DOM test environment and the server render keeps no state,
// so these tests run the real provider under a minimal hooks dispatcher. It
// sits in React's slot for the active dispatcher only while the provider
// function runs: state, refs, memos and effects live in plain slots, effects
// run after each render, and every render returns the context value the
// provider builds. The i18n context answers English with a stable setter.
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown };
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
const i18n = { language: "en", setLanguage: () => undefined };

function hostProvider() {
  const slots: unknown[] = [];
  const pendingEffects: Array<() => void> = [];
  const cleanups = new Map<number, () => void>();
  let cursor = 0;
  const changed = (previous: Deps, next: Deps) =>
    previous === undefined || next === undefined || next.some((value, index) => !Object.is(value, previous[index]));
  function memo<T>(factory: () => T, deps: Deps): T {
    const index = cursor++;
    const previous = slots[index] as { deps: Deps; value: T } | undefined;
    if (previous && !changed(previous.deps, deps)) return previous.value;
    const value = factory();
    slots[index] = { deps, value };
    return value;
  }
  const dispatcher = {
    useCallback: <T,>(callback: T, deps: Deps) => memo(() => callback, deps),
    useContext: () => i18n,
    useEffect: (effect: () => void | (() => void), deps: Deps) => {
      const index = cursor++;
      const previous = slots[index] as { deps: Deps } | undefined;
      if (previous && !changed(previous.deps, deps)) return;
      slots[index] = { deps };
      pendingEffects.push(() => {
        cleanups.get(index)?.();
        const cleanup = effect();
        if (typeof cleanup === "function") cleanups.set(index, cleanup);
      });
    },
    useMemo: <T,>(factory: () => T, deps: Deps) => memo(factory, deps),
    useRef: <T,>(initial: T) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index] as { current: T };
    },
    useState: <T,>(initial: T | (() => T)) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      const setState = (next: T | ((current: T) => T)) => {
        slots[index] = typeof next === "function" ? (next as (current: T) => T)(slots[index] as T) : next;
      };
      return [slots[index] as T, setState] as const;
    },
  };
  return {
    render(): ContextValue {
      cursor = 0;
      const previous = reactInternals.H;
      reactInternals.H = dispatcher;
      let element: ReactElement<{ value: ContextValue }>;
      try {
        element = DeliveryPreferencesProvider({ children: null }) as ReactElement<{ value: ContextValue }>;
      } finally {
        reactInternals.H = previous;
      }
      for (const effect of pendingEffects.splice(0)) effect();
      return element.props.value;
    },
    unmount() {
      for (const cleanup of cleanups.values()) cleanup();
      cleanups.clear();
    },
  };
}

// fetch answers only when the test says so, in the order the test picks.
function deferredFetch() {
  const calls: Array<{ method: string; resolve: (response: Response) => void }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve) => calls.push({ method: init?.method ?? "GET", resolve }))) as typeof fetch;
  return {
    answer(index: number, body: Record<string, unknown>) {
      const call = calls[index];
      if (!call) throw new Error(`no request #${index}; sent: ${calls.map((item) => item.method).join(", ")}`);
      call.resolve(Response.json({ ...DEFAULT_DELIVERY_PREFERENCES, ok: true, ...body }));
    },
    methods: () => calls.map((call) => call.method),
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

describe("delivery preferences: reads and patches keep their order", () => {
  test("a read that started before a patch never overwrites what the patch saved", async () => {
    const server = deferredFetch();
    const host = hostProvider();
    try {
      // Mount: the first read answers "off".
      let value = host.render();
      server.answer(0, { autoCaptureDestination: false });
      await new Promise((resolve) => setTimeout(resolve, 0));
      value = host.render();
      expect(value.available).toBe(true);
      expect(value.autoCaptureDestination).toBe(false);

      // A refresh is pending when the person turns the switch on.
      const staleRead = value.refresh();
      const write = value.patch({ autoCaptureDestination: true });
      expect(server.methods()).toEqual(["GET", "GET", "PATCH"]);
      server.answer(2, { autoCaptureDestination: true });
      await write;
      expect(host.render().autoCaptureDestination).toBe(true);

      // The refresh answers last, with what it read before the write.
      server.answer(1, { autoCaptureDestination: false });
      await staleRead;
      value = host.render();
      expect(value.autoCaptureDestination).toBe(true);
      expect(value.available).toBe(true);
    } finally {
      host.unmount();
      server.restore();
    }
  });

  test("control: between two reads the newest wins, whichever answers first", async () => {
    const server = deferredFetch();
    const host = hostProvider();
    try {
      let value = host.render();
      server.answer(0, { autoCaptureDestination: false });
      await new Promise((resolve) => setTimeout(resolve, 0));
      value = host.render();

      // The newer read answers first; the older one, later, is dropped.
      const older = value.refresh();
      const newer = value.refresh();
      server.answer(2, { autoCaptureDestination: true });
      await newer;
      server.answer(1, { autoCaptureDestination: false });
      await older;
      expect(host.render().autoCaptureDestination).toBe(true);

      // The older read answers first; the newer one still decides.
      const first = host.render().refresh();
      const second = host.render().refresh();
      server.answer(3, { autoCaptureDestination: true });
      await first;
      server.answer(4, { autoCaptureDestination: false });
      await second;
      expect(host.render().autoCaptureDestination).toBe(false);
      expect(server.methods()).toEqual(["GET", "GET", "GET", "GET", "GET"]);
    } finally {
      host.unmount();
      server.restore();
    }
  });

  test("control: a read sent after a patch still updates the state", async () => {
    const server = deferredFetch();
    const host = hostProvider();
    try {
      host.render();
      server.answer(0, { autoCaptureDestination: false });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const write = host.render().patch({ autoCaptureDestination: true });
      server.answer(1, { autoCaptureDestination: true });
      await write;
      const read = host.render().refresh();
      server.answer(2, { autoCaptureDestination: true, autoCaptureDestinationAvailable: false });
      await read;
      const value = host.render();
      expect(value.autoCaptureDestination).toBe(true);
      expect(value.autoCaptureDestinationAvailable).toBe(false);
      expect(server.methods()).toEqual(["GET", "PATCH", "GET"]);
    } finally {
      host.unmount();
      server.restore();
    }
  });
});
