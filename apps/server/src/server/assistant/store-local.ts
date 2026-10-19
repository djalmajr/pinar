import type {
  AssistantMessage,
  AssistantProposalRecord,
  AssistantStore,
  AssistantThread,
  AssistantTransitionProposalInput,
} from "./store";

/**
 * Structural shape of the synchronous assistant methods on `apps/cli/src/history.mjs`
 * (`SqliteHistoryDb` and `JsonHistoryDb`). Both return and accept the camelCase
 * contract objects from `store.ts`.
 */
export interface LocalAssistantDatabase {
  appendAssistantMessage(message: AssistantMessage): void;
  createAssistantProposal(record: AssistantProposalRecord): void;
  createAssistantThread(input: { id: string; now: string; title: string }): AssistantThread;
  deleteAssistantThread(id: string): boolean;
  getAssistantProposal(id: string): AssistantProposalRecord | null;
  getAssistantThread(id: string): AssistantThread | null;
  listAssistantMessages(threadId: string, input: { limit: number }): AssistantMessage[];
  listAssistantProposals(threadId: string): AssistantProposalRecord[];
  listAssistantThreads(input: { limit: number; offset: number }): AssistantThread[];
  transitionAssistantProposal(input: AssistantTransitionProposalInput): AssistantProposalRecord | null;
}

/** Adapts the synchronous local history db to the `AssistantStore` promise interface. */
export function localAssistantStore(db: LocalAssistantDatabase): AssistantStore {
  return {
    async appendMessage(message) {
      db.appendAssistantMessage(message);
    },
    async createProposal(record) {
      db.createAssistantProposal(record);
    },
    async createThread(input) {
      return db.createAssistantThread(input);
    },
    async deleteThread(id) {
      return db.deleteAssistantThread(id);
    },
    async getProposal(id) {
      return db.getAssistantProposal(id);
    },
    async getThread(id) {
      return db.getAssistantThread(id);
    },
    async listMessages(threadId, input) {
      return db.listAssistantMessages(threadId, input);
    },
    async listProposals(threadId) {
      return db.listAssistantProposals(threadId);
    },
    async listThreads(input) {
      return db.listAssistantThreads(input);
    },
    async transitionProposal(input) {
      return db.transitionAssistantProposal(input);
    },
  };
}
