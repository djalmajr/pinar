import { getPinColor } from "./pin-colors.js";
// A durable outbox shared by all annotated tabs. Browser and server operations
// are injected so failure/restart behaviour can be tested without Chrome.
export function createContinuousSession({ read, write, create, capture, save, remove, finish, publish, changed = () => {}, id = () => crypto.randomUUID() }) {
  let tail = Promise.resolve();
  const serial = (operation) => {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
  async function persist(draft) {
    await write(draft);
    await changed(draft);
  }
  async function deliver(draft) {
    for (const entry of draft.entries) {
      if (entry.status === "saved") continue;
      try {
        if (entry.deleted) await remove(entry, draft);
        else {
          if (draft.includeScreenshot && !entry.shot) throw new Error(entry.error || "screenshot_missing");
          entry.result = await save(entry, draft);
        }
        entry.status = "saved";
        entry.error = null;
      } catch (error) {
        entry.error = String(error.message || error);
        entry.status = "pending";
      }
      await persist(draft);
    }
    return draft;
  }
  return {
    read: () => serial(read),
    sync: (input) => serial(async () => {
      let draft = await read();
      if (!draft && !input.pins.length) return null;
      if (!draft) draft = { ...await create(), entries: [] };
      const ids = new Set(input.pins.map((pin) => pin.pinId || pin.id));
      for (const entry of draft.entries) {
        if (entry.source === input.source && !entry.deleted && !ids.has(entry.pin.pinId || entry.pin.id)) {
          entry.deleted = true;
          entry.status = "pending";
        }
      }
      for (const pin of input.pins) {
        const pinId = pin.pinId || pin.id;
        let entry = draft.entries.find((item) => !item.deleted && (item.pin.pinId || item.pin.id) === pinId);
        if (!entry) {
          const number = Math.max(draft.entries.length, ...draft.entries.map((item) => item.pin.number || 0)) + 1;
          entry = { captureId: id(), source: input.source, page: input.page, pin: { ...pin, number, color: getPinColor(number) }, privacy: input.privacy, warnings: input.warnings || [], createdAt: new Date().toISOString(), shot: null, status: "pending" };
          draft.entries.push(entry);
          // Persist the annotation before attempting any screenshot/network IO.
          await persist(draft);
        } else if (entry.pin.comment !== pin.comment) {
          // Never move an old annotation onto a new visual state when edited.
          entry.pin = { ...entry.pin, comment: pin.comment };
          entry.status = "pending";
        }
        if (!entry.shot && draft.includeScreenshot) {
          try {
            entry.shot = await capture(entry, input);
            if (!entry.shot) throw new Error("screenshot_missing");
          } catch (error) {
            entry.error = String(error.message || error);
          }
          entry.status = "pending";
        }
        await persist(draft);
      }
      return deliver(draft);
    }),
    retry: () => serial(async () => {
      const draft = await read();
      return draft ? deliver(draft) : null;
    }),
    attachReproduction: (tabId, reproduction) => serial(async () => {
      if (!reproduction) return;
      const draft = await read();
      const entry = draft?.entries.findLast((item) => !item.deleted && item.source.startsWith(`${tabId}:`));
      if (!entry) return;
      entry.reproduction = reproduction;
      entry.status = "pending";
      await persist(draft);
    }),
    edit: (captureId, comment) => serial(async () => {
      const draft = await read();
      const entry = draft?.entries.find((item) => item.captureId === captureId && !item.deleted);
      if (!entry || typeof comment !== "string" || !comment.trim()) throw new Error("invalid_comment");
      entry.pin = { ...entry.pin, comment: comment.trim() };
      entry.status = "pending";
      await persist(draft);
      return deliver(draft);
    }),
    remove: (captureId) => serial(async () => {
      const draft = await read();
      const entry = draft?.entries.find((item) => item.captureId === captureId);
      if (!entry) return draft;
      entry.deleted = true;
      entry.status = "pending";
      await persist(draft);
      return deliver(draft);
    }),
    finish: ({ copy = true } = {}) => serial(async () => {
      const draft = await read();
      if (!draft) return null;
      await deliver(draft);
      if (draft.entries.some((entry) => entry.status !== "saved")) throw new Error("session_pending");
      const entries = draft.entries.filter((entry) => !entry.deleted);
      if (entries.length) {
        await finish(draft);
        if (copy) await publish(draft);
      }
      // A failed finish/copy is retryable using the same IDs and evidence.
      await persist(null);
      return draft;
    }),
    discard: () => serial(async () => {
      const draft = await read();
      if (!draft) return null;
      for (const entry of draft.entries) {
        entry.deleted = true;
        entry.status = "pending";
      }
      await persist(draft);
      await deliver(draft);
      if (draft.entries.some((entry) => entry.status !== "saved")) throw new Error("session_pending");
      await persist(null);
      return draft;
    }),
    abandon: () => serial(async () => {
      const draft = await read();
      await persist(null);
      return draft;
    }),
  };
}

export function continuousSummary(draft) {
  const entries = draft?.entries.filter((entry) => !entry.deleted) || [];
  return {
    active: Boolean(draft),
    id: draft?.id,
    count: new Set(entries.map((entry) => entry.page.url)).size,
    pins: entries.length,
    nextNumber: Math.max(draft?.entries.length || 0, ...(draft?.entries || []).map((entry) => entry.pin.number || 0)) + 1,
    pending: draft?.entries.filter((entry) => entry.status !== "saved").length || 0,
    entries: entries.map(({ captureId, page, pin, status, error }) => ({ captureId, page, pinId: pin.pinId || pin.id, number: pin.number, comment: pin.comment, tag: pin.tag || pin.label, type: pin.type || pin.kind, path: pin.selector || pin.domPath || pin.path, status, error })),
  };
}

// IndexedDB avoids chrome.storage.local's small quota for pending screenshots.
// Only sanitized evidence is retained, and a successful finish removes it.
export function indexedDraftStore(indexedDB) {
  let database;
  async function db() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open("pinar-review-draft", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("drafts");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return database;
  }
  return {
    async read() {
      const database = await db();
      return new Promise((resolve, reject) => {
        const request = database.transaction("drafts").objectStore("drafts").get("active");
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    },
    async write(draft) {
      const database = await db();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction("drafts", "readwrite");
        const store = transaction.objectStore("drafts");
        if (draft) store.put(draft, "active");
        else store.delete("active");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("draft_write_failed"));
      });
    },
  };
}
