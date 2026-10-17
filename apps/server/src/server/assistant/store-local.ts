import type { AssistantMessage, AssistantStore, AssistantThread } from "./store";

/**
 * Structural shape of the synchronous assistant methods on `apps/cli/src/history.mjs`
 * (`SqliteHistoryDb` and `JsonHistoryDb`). Both return and accept the camelCase
 * contract objects from `store.ts`.
 */
export interface LocalAssistantDatabase {
  appendAssistantMessage(message: AssistantMessage): void;
  createAssistantThread(input: { id: string; now: string; title: string }): AssistantThread;
  deleteAssistantThread(id: string): boolean;
  getAssistantThread(id: string): AssistantThread | null;
  listAssistantMessages(threadId: string, input: { limit: number }): AssistantMessage[];
  listAssistantThreads(input: { limit: number; offset: number }): AssistantThread[];
}

/** Adapts the synchronous local history db to the `AssistantStore` promise interface. */
export function localAssistantStore(db: LocalAssistantDatabase): AssistantStore {
  return {
    async appendMessage(message) {
      db.appendAssistantMessage(message);
    },
    async createThread(input) {
      return db.createAssistantThread(input);
    },
    async deleteThread(id) {
      return db.deleteAssistantThread(id);
    },
    async getThread(id) {
      return db.getAssistantThread(id);
    },
    async listMessages(threadId, input) {
      return db.listAssistantMessages(threadId, input);
    },
    async listThreads(input) {
      return db.listAssistantThreads(input);
    },
  };
}
