// One assistant conversation bound to its own SDK Chat. Switching
// conversations never reuses the previous Chat: a stream interrupted mid-way
// (late deltas, a late data-thread) still addresses the Chat it started from,
// so it can never touch the messages of another conversation.
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  buildTurnRequestBody,
  fetchAssistantThread,
  runAssistantProposalAction,
  threadMessagesToUiMessages,
  type AssistantProposalActionKind,
  type AssistantPublicProposal,
  type AssistantThreadDetail,
  type AssistantUIMessage,
} from "./assistant-client";
import type { AssistantProposalCardState } from "./AssistantMessages";

/**
 * A single assistant conversation: the real SDK Chat, the id passed to the
 * SDK (`assistant:new:<n>` or `assistant:<threadId>`), the generation it was
 * created with (bumped on every switch) and the thread id it knows
 * (null until the first turn's `data-thread`).
 */
export interface AssistantConversation {
  chat: Chat<AssistantUIMessage>;
  chatId: string;
  generation: number;
  threadId: { current: string | null };
}

/**
 * The panel hooks shared by the callbacks of every conversation. `generation`
 * is the cell the callbacks check to drop events of a conversation the user
 * already switched away from.
 */
export interface AssistantConversationHooks {
  generation: { current: number };
  /** A `data-thread` arrived on the current conversation: record the list entry. */
  onThreadEntry?: (thread: { id: string; now: string; title: string }) => void;
  /** A `data-thread` arrived on the current conversation: the active thread id changed. */
  onActiveThreadCreated?: (threadId: string) => void;
  onTurnError?: (error: Error) => void;
  /** A turn of the current conversation was aborted (Stop, or the request aborted); the messages as it left them. */
  onTurnAborted?: (messages: AssistantUIMessage[]) => void;
}

export interface AssistantConversationInit {
  chatId: string;
  generation: number;
  threadId: string | null;
  messages: AssistantUIMessage[];
  hooks: AssistantConversationHooks;
  /** The fetch used by the transport (the global fetch in production). */
  fetch?: typeof globalThis.fetch;
}

export function createAssistantConversation(init: AssistantConversationInit): AssistantConversation {
  const conversation: AssistantConversation = {
    chat: undefined as unknown as Chat<AssistantUIMessage>,
    chatId: init.chatId,
    generation: init.generation,
    threadId: { current: init.threadId },
  };
  conversation.chat = new Chat<AssistantUIMessage>({
    id: init.chatId,
    messages: init.messages,
    transport: new DefaultChatTransport<AssistantUIMessage>({
      api: "/api/assistant/turn",
      fetch: init.fetch,
      prepareSendMessagesRequest: ({ body, messages }) => {
        return {
          body: {
            ...buildTurnRequestBody(conversation.threadId.current, messages),
            ...body,
          },
        };
      },
    }),
    onData: (part) => {
      if (part.type !== "data-thread") return;
      const data = part.data;
      if (typeof data !== "object" || data === null || !("id" in data)) return;
      const id = data.id;
      if (typeof id !== "string" || id === "") return;
      const title = "title" in data && typeof data.title === "string" ? data.title : "";
      conversation.threadId.current = id;
      // This event belongs to this conversation only: a stream from a
      // switched-away conversation kept the generation it was created with,
      // so its late `data-thread` cannot re-associate the active thread id.
      if (init.hooks.generation.current !== conversation.generation) return;
      init.hooks.onActiveThreadCreated?.(id);
      init.hooks.onThreadEntry?.({ id, now: new Date().toISOString(), title });
    },
    onError: (error) => {
      if (init.hooks.generation.current !== conversation.generation) return;
      init.hooks.onTurnError?.(error);
    },
    onFinish: ({ isAbort, messages }) => {
      // An aborted turn ends without an error: the panel marks the answer
      // as interrupted. Same generation rule as onError: the stop of a
      // conversation switch belongs to the one being left.
      if (!isAbort) return;
      if (init.hooks.generation.current !== conversation.generation) return;
      init.hooks.onTurnAborted?.(messages);
    },
  });
  return conversation;
}

export interface AssistantConversationStore {
  /** The conversation being left. */
  current: AssistantConversation;
  hooks: AssistantConversationHooks;
  /** The id of the most recently requested thread open. */
  requestedThreadRef: { current: string | null };
  /** Counter for the ids of new conversations. */
  newThreadCountRef: { current: number };
}

/**
 * Switch to a fresh (empty) conversation: wait for the current stream to be
 * interrupted, then build the fresh Chat. The returned conversation is the
 * one the panel must activate. A thread open still in flight is invalidated:
 * its answer may no longer switch the panel away from the new conversation.
 */
export async function startAssistantConversation(
  store: AssistantConversationStore,
): Promise<AssistantConversation> {
  await store.current.chat.stop();
  store.requestedThreadRef.current = null;
  const generation = store.hooks.generation.current + 1;
  store.hooks.generation.current = generation;
  store.newThreadCountRef.current += 1;
  return createAssistantConversation({
    chatId: `assistant:new:${store.newThreadCountRef.current}`,
    generation,
    hooks: store.hooks,
    messages: [],
    threadId: null,
  });
}

export type OpenAssistantConversationResult =
  | { conversation: AssistantConversation; kind: "switched" }
  /** The thread is gone (404) or the answer was invalid: refresh the list. */
  | { kind: "gone" }
  /** A newer open request superseded this one: its answer is stale. */
  | { kind: "superseded" };

/**
 * Open a stored conversation: wait for the current stream to be interrupted,
 * fetch the thread, and build the fresh Chat seeded with the stored messages.
 * Out-of-order answers are discarded: only the most recently requested
 * conversation may switch.
 */
export async function openAssistantConversation(
  store: AssistantConversationStore,
  id: string,
  fetchThread: (id: string) => Promise<AssistantThreadDetail | null> = fetchAssistantThread,
): Promise<OpenAssistantConversationResult> {
  store.requestedThreadRef.current = id;
  await store.current.chat.stop();
  const loaded = await fetchThread(id);
  if (store.requestedThreadRef.current !== id) return { kind: "superseded" };
  if (loaded === null) return { kind: "gone" };
  const generation = store.hooks.generation.current + 1;
  store.hooks.generation.current = generation;
  return {
    conversation: createAssistantConversation({
      chatId: `assistant:${id}`,
      generation,
      hooks: store.hooks,
      messages: threadMessagesToUiMessages(loaded.messages, loaded.proposals),
      threadId: id,
    }),
    kind: "switched",
  };
}

/**
 * Stop the current conversation's in-flight stream. The panel's unmount
 * cleanup uses this: the SDK does not stop a Chat managed outside the hook
 * (isExternallyManaged in @ai-sdk/react), so closing the panel mid-turn must
 * interrupt the stream itself. Conversation switches already stop before
 * switching; this covers the unmount.
 */
export function stopAssistantConversation(conversation: AssistantConversation): void {
  void conversation.chat.stop();
}

/** The card states of the current conversation, per proposal id. */
export type AssistantProposalCardStates = Record<string, AssistantProposalCardState>;

/** What a card action needs from the panel. */
export interface AssistantProposalActionStore {
  /** The conversation generation cell (the one in the conversation hooks). */
  generation: { current: number };
  /** The ids of the proposals with an action in flight. */
  inFlight: Set<string>;
  setProposalStates: (update: (current: AssistantProposalCardStates) => AssistantProposalCardStates) => void;
}

/**
 * Run one card action for the current conversation. One action per proposal
 * at a time: `inFlight` drops a second click before the disabled buttons
 * render. The answer is applied only while the generation the action started
 * in is still current: after any switch (even back to the same thread, whose
 * reopening loaded fresher proposals) a late answer is discarded.
 */
export async function applyAssistantProposalAction(
  store: AssistantProposalActionStore,
  kind: AssistantProposalActionKind,
  proposal: AssistantPublicProposal,
): Promise<void> {
  if (store.inFlight.has(proposal.id)) return;
  store.inFlight.add(proposal.id);
  const generation = store.generation.current;
  store.setProposalStates((current) => ({
    ...current,
    [proposal.id]: { errorKey: null, pending: true, proposal: current[proposal.id]?.proposal ?? null },
  }));
  try {
    const outcome = await runAssistantProposalAction(kind, proposal);
    if (store.generation.current !== generation) return;
    store.setProposalStates((current) => ({
      ...current,
      [proposal.id]: { errorKey: outcome.errorKey, pending: false, proposal: outcome.proposal },
    }));
  } finally {
    store.inFlight.delete(proposal.id);
  }
}
