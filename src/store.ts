import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Bundle, Draft, NewPin, PageContext, Pin, State, Status } from "./types";

const emptyDraft = (): Draft => ({
  pins: [],
  title: "",
  url: "",
  viewport: { dpr: 1, height: 0, width: 0 },
});

const emptyState = (): State => ({
  draft: emptyDraft(),
  sent: [],
});

function isBundle(item: unknown): item is Bundle {
  return Boolean(item && typeof item === "object" && "pins" in item && "sentAt" in item);
}

function asQueue(sent: unknown): Bundle[] {
  if (Array.isArray(sent)) return sent.filter(isBundle);
  if (isBundle(sent)) return [sent];
  return [];
}

export function createStore(root: string) {
  const statePath = join(root, "state.json");
  const shotsDir = join(root, "shots");

  async function load(): Promise<State> {
    try {
      const raw = await readFile(statePath, "utf8");
      const parsed = JSON.parse(raw) as State;
      if (!parsed || typeof parsed !== "object" || !parsed.draft) return emptyState();
      return {
        draft: {
          pins: Array.isArray(parsed.draft.pins) ? parsed.draft.pins : [],
          title: parsed.draft.title ?? "",
          url: parsed.draft.url ?? "",
          viewport: parsed.draft.viewport ?? { dpr: 1, height: 0, width: 0 },
        },
        sent: asQueue(parsed.sent),
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return emptyState();
      }
      throw error;
    }
  }

  async function persist(state: State): Promise<void> {
    await mkdir(root, { recursive: true });
    const tmp = `${statePath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`);
    await rename(tmp, statePath);
  }

  async function writeShot(name: string, png: Uint8Array): Promise<string> {
    await mkdir(shotsDir, { recursive: true });
    const path = join(shotsDir, name);
    await writeFile(path, png);
    return path;
  }

  return {
    root,

    async status(): Promise<Status> {
      const state = await load();
      const head = state.sent[0];
      return {
        draftCount: state.draft.pins.length,
        hasSent: state.sent.length > 0,
        queued: state.sent.length,
        sentCount: head?.pins.length ?? 0,
        title: head?.title || state.draft.title,
        url: head?.url || state.draft.url,
      };
    },

    async getDraft(): Promise<Draft> {
      return (await load()).draft;
    },

    async setPage(page: PageContext): Promise<Draft> {
      const state = await load();
      state.draft.title = page.title;
      state.draft.url = page.url;
      state.draft.viewport = page.viewport;
      await persist(state);
      return state.draft;
    },

    async replaceDraft(page: PageContext, inputs: NewPin[]): Promise<Draft> {
      const state = await load();
      state.draft = {
        pins: inputs.map((input) => ({
          anchor: input.anchor,
          box: input.box,
          comment: input.comment.trim(),
          createdAt: new Date().toISOString(),
          id: crypto.randomUUID(),
          kind: input.kind,
          label: input.label,
          path: input.path,
          selector: input.selector,
          text: input.text,
        })),
        title: page.title,
        url: page.url,
        viewport: page.viewport,
      };
      await persist(state);
      return state.draft;
    },

    async addPin(input: NewPin): Promise<Pin> {
      const state = await load();
      const pin: Pin = {
        anchor: input.anchor,
        box: input.box,
        comment: input.comment.trim(),
        createdAt: new Date().toISOString(),
        id: crypto.randomUUID(),
        kind: input.kind,
        label: input.label,
        path: input.path,
        selector: input.selector,
        text: input.text,
      };
      state.draft.pins.push(pin);
      await persist(state);
      return pin;
    },

    async removePin(id: string): Promise<boolean> {
      const state = await load();
      const next = state.draft.pins.filter((pin) => pin.id !== id);
      if (next.length === state.draft.pins.length) return false;
      state.draft.pins = next;
      await persist(state);
      return true;
    },

    async send(input: {
      pinCrops?: Record<string, Uint8Array>;
      viewportPng?: Uint8Array;
    } = {}): Promise<Bundle> {
      const state = await load();
      if (state.draft.pins.length === 0) {
        throw new Error("Nothing to send: draft has no pins");
      }
      const sentAt = new Date().toISOString();
      const pins = await Promise.all(
        state.draft.pins.map(async (pin) => {
          const crop = input.pinCrops?.[pin.id];
          if (!crop) return { ...pin };
          return { ...pin, screenshotPath: await writeShot(`${pin.id}.png`, crop) };
        }),
      );
      const sent: Bundle = {
        pins,
        sentAt,
        title: state.draft.title,
        url: state.draft.url,
        viewport: state.draft.viewport,
        viewportScreenshotPath: input.viewportPng
          ? await writeShot(`viewport-${sentAt.replaceAll(":", "")}.png`, input.viewportPng)
          : undefined,
      };
      state.sent.push(sent);
      await persist(state);
      return sent;
    },

    async peek(): Promise<Bundle | null> {
      return (await load()).sent[0] ?? null;
    },

    async take(): Promise<Bundle | null> {
      const state = await load();
      const sent = state.sent.shift() ?? null;
      if (!sent) return null;
      await persist(state);
      return sent;
    },

    async clearDraft(): Promise<void> {
      const state = await load();
      state.draft = emptyDraft();
      await persist(state);
    },

    async reset(): Promise<void> {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export type Store = ReturnType<typeof createStore>;