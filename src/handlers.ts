import { emptyTakeMessage, renderBundle } from "./bundle";
import type { Store } from "./store";
import type { NewPin, PageContext } from "./types";

function decodePng(value: string | undefined): Uint8Array | undefined {
  if (!value) return undefined;
  const comma = value.indexOf(",");
  const raw = comma >= 0 ? value.slice(comma + 1) : value;
  return Uint8Array.from(Buffer.from(raw, "base64"));
}

export function createHandlers(store: Store) {
  return {
    status: () => store.status(),
    draft: () => store.getDraft(),
    setPage: (page: PageContext) => store.setPage(page),
    replaceDraft: (page: PageContext, pins: NewPin[]) => store.replaceDraft(page, pins),
    addPin: (pin: NewPin) => store.addPin(pin),
    removePin: (id: string) => store.removePin(id),
    clearDraft: () => store.clearDraft(),

    async send(input: {
      pinCrops?: Record<string, string>;
      viewportPng?: string;
    } = {}) {
      const pinCrops = input.pinCrops
        ? Object.fromEntries(
            Object.entries(input.pinCrops).flatMap(([id, value]) => {
              const png = decodePng(value);
              return png ? [[id, png] as const] : [];
            }),
          )
        : undefined;
      return store.send({
        pinCrops,
        viewportPng: decodePng(input.viewportPng),
      });
    },

    async peek() {
      const bundle = await store.peek();
      if (!bundle) {
        return { bundle: null, markdown: emptyTakeMessage(), waiting: false };
      }
      return { bundle, markdown: renderBundle(bundle), waiting: true };
    },

    async take() {
      const bundle = await store.take();
      if (!bundle) {
        return { bundle: null, markdown: emptyTakeMessage(), waiting: false };
      }
      return { bundle, markdown: renderBundle(bundle), waiting: true };
    },
  };
}

export type Handlers = ReturnType<typeof createHandlers>;