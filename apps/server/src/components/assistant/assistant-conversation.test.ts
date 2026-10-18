// Review finding 1 and 2 (rev-f1): conversation switching must isolate the
// in-flight stream, and turn errors must keep their HTTP error code and the
// network distinction. The scenarios below reuse the reviewer's probe
// (rev-f1-20261016T233144.probe.sdk.ts): a real SDK Chat plus a real
// DefaultChatTransport, with a controllable SSE stream that keeps delivering
// events even after the switch.
import { describe, expect, test } from "bun:test";
import {
  assistantByokErrorFromChatError,
  assistantErrorFromChatError,
  assistantErrorMessageKey,
  assistantMessageAsk,
  assistantMessageProposals,
  type AssistantPublicProposal,
  type AssistantThreadDetail,
} from "./assistant-client";
import {
  byokErrorPart,
  createAssistantConversation,
  openAssistantConversation,
  startAssistantConversation,
  stopAssistantConversation,
  type AssistantConversation,
  type AssistantConversationHooks,
  type AssistantConversationStore,
} from "./assistant-conversation";

interface StreamedConversation {
  close: () => void;
  conversation: AssistantConversation;
  emit: (chunk: Record<string, unknown>) => void;
  send: Promise<void>;
}

/**
 * A conversation whose turn stream is a controllable SSE response, exactly
 * the shape the reviewer's probe used: the fetch never closes on its own, so
 * events emitted after the switch are "late" events.
 */
function startStreamingConversation(
  hooks: AssistantConversationHooks,
  generation: number,
): StreamedConversation {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const conversation = createAssistantConversation({
    chatId: "assistant:new:0",
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(streamController) {
            controller = streamController;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    generation,
    hooks,
    messages: [],
    threadId: null,
  });
  const send = conversation.chat.sendMessage({ text: "question A" });
  return {
    close: () => controller.close(),
    conversation,
    emit: (chunk) => {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
    },
    send,
  };
}

function textParts(conversation: AssistantConversation): string[] {
  return conversation.chat.messages.flatMap((message) =>
    message.parts
      .filter((part): part is { text: string; type: "text" } => part.type === "text")
      .map((part) => part.text),
  );
}

describe("switching conversations isolates the in-flight stream (real SDK Chat)", () => {
  test("a late delta of a switched-away stream never reaches the new conversation", async () => {
    const cell = { current: 0 };
    let activeThreadId: string | null = null;
    const hooks: AssistantConversationHooks = {
      generation: cell,
      onActiveThreadCreated: (id) => {
        activeThreadId = id;
      },
      onThreadEntry: () => undefined,
    };
    const a = startStreamingConversation(hooks, 0);
    const store: AssistantConversationStore = {
      current: a.conversation,
      hooks,
      newThreadCountRef: { current: 0 },
      requestedThreadRef: { current: null },
    };

    await Bun.sleep(20);
    a.emit({ messageId: "answerA", type: "start" });
    a.emit({ data: { id: "ath_A", title: "A" }, type: "data-thread" });
    a.emit({ id: "t", type: "text-start" });
    a.emit({ delta: "first A", id: "t", type: "text-delta" });
    await Bun.sleep(20);
    expect(activeThreadId).toBe("ath_A"); // while conversation A was active

    // The panel's "new conversation" switch: stop first, then the fresh chat.
    const next = await startAssistantConversation(store);
    activeThreadId = null; // the panel resets the active thread id

    // A's stream delivers a late delta after the switch.
    a.emit({ delta: " late A", id: "t", type: "text-delta" });
    a.emit({ id: "t", type: "text-end" });
    a.emit({ type: "finish" });
    a.close();
    await a.send;

    // The new conversation is still empty and its thread id is still null.
    expect(next.chatId).toBe("assistant:new:1");
    expect(next.threadId.current).toBeNull();
    expect(next.chat.messages).toEqual([]);
    expect(activeThreadId).toBeNull();
    // The old answer stays on the old conversation, without the late delta.
    const answerA = a.conversation.chat.messages.find((message) => message.id === "answerA");
    expect(
      answerA?.parts
        .filter((part): part is { text: string; type: "text" } => part.type === "text")
        .map((part) => part.text),
    ).toEqual(["first A"]);
  });

  test("a data-thread that arrives after the switch does not re-associate the active thread id", async () => {
    const cell = { current: 0 };
    let activeThreadId: string | null = null;
    const threadEntries: Array<{ id: string; title: string }> = [];
    const hooks: AssistantConversationHooks = {
      generation: cell,
      onActiveThreadCreated: (id) => {
        activeThreadId = id;
      },
      onThreadEntry: (entry) => {
        threadEntries.push({ id: entry.id, title: entry.title });
      },
    };
    // Conversation A is created with generation 0; the panel has since
    // switched (the active generation is now 1) while A's stream was still
    // delivering its first parts.
    const a = startStreamingConversation(hooks, 0);
    await Bun.sleep(20);
    cell.current = 1;
    a.emit({ messageId: "answerA", type: "start" });
    a.emit({ data: { id: "ath_A", title: "A" }, type: "data-thread" });
    a.emit({ id: "t", type: "text-start" });
    a.emit({ delta: "first A", id: "t", type: "text-delta" });
    a.emit({ id: "t", type: "text-end" });
    a.emit({ type: "finish" });
    a.close();
    await a.send;

    // The generation guard drops the stale data-thread for the panel, while
    // the conversation itself still knows its own thread id.
    expect(activeThreadId).toBeNull();
    expect(threadEntries).toEqual([]);
    expect(a.conversation.threadId.current).toBe("ath_A");
  });

  test("opening a stored conversation while A streams: a late delta of A never reaches B", async () => {
    const cell = { current: 0 };
    let activeThreadId: string | null = null;
    const hooks: AssistantConversationHooks = {
      generation: cell,
      onActiveThreadCreated: (id) => {
        activeThreadId = id;
      },
      onThreadEntry: () => undefined,
    };
    const a = startStreamingConversation(hooks, 0);
    const store: AssistantConversationStore = {
      current: a.conversation,
      hooks,
      newThreadCountRef: { current: 0 },
      requestedThreadRef: { current: null },
    };

    await Bun.sleep(20);
    a.emit({ messageId: "answerA", type: "start" });
    a.emit({ id: "t", type: "text-start" });
    a.emit({ delta: "first A", id: "t", type: "text-delta" });
    await Bun.sleep(20);

    const detailB: AssistantThreadDetail = {
      messages: [
        {
          ask: null,
          createdAt: "2026-10-01T00:00:00.000Z",
          errorCode: null,
          id: "amg_1",
          role: "user",
          status: "final",
          text: "hello B",
          threadId: "ath_B",
        },
        {
          ask: null,
          createdAt: "2026-10-01T00:00:01.000Z",
          errorCode: null,
          id: "amg_2",
          role: "assistant",
          status: "final",
          text: "hi there",
          threadId: "ath_B",
        },
      ],
      proposals: [],
      thread: {
        createdAt: "2026-10-01T00:00:00.000Z",
        id: "ath_B",
        title: "B",
        updatedAt: "2026-10-01T00:00:01.000Z",
      },
    };
    const result = await openAssistantConversation(store, "ath_B", async () => detailB);
    expect(result.kind).toBe("switched");
    const b = result.conversation;
    activeThreadId = "ath_B"; // the panel

    // A's stream delivers a late delta after the switch.
    a.emit({ delta: " late A", id: "t", type: "text-delta" });
    a.emit({ id: "t", type: "text-end" });
    a.emit({ type: "finish" });
    a.close();
    await a.send;

    // B keeps exactly its stored messages: nothing of A was attached.
    expect(b.chatId).toBe("assistant:ath_B");
    expect(b.threadId.current).toBe("ath_B");
    expect(cell.current).toBe(1);
    expect(textParts(b)).toEqual(["hello B", "hi there"]);
    expect(activeThreadId).toBe("ath_B");
  });

  test("out-of-order thread answers: a late response for an earlier open is discarded", async () => {
    const cell = { current: 0 };
    const hooks: AssistantConversationHooks = {
      generation: cell,
      onActiveThreadCreated: () => undefined,
      onThreadEntry: () => undefined,
    };
    const a = startStreamingConversation(hooks, 0);
    const store: AssistantConversationStore = {
      current: a.conversation,
      hooks,
      newThreadCountRef: { current: 0 },
      requestedThreadRef: { current: null },
    };

    const detailC: AssistantThreadDetail = {
      messages: [
        {
          ask: null,
          createdAt: "2026-10-02T00:00:00.000Z",
          errorCode: null,
          id: "amg_9",
          role: "user",
          status: "final",
          text: "hi C",
          threadId: "ath_C",
        },
      ],
      proposals: [],
      thread: {
        createdAt: "2026-10-02T00:00:00.000Z",
        id: "ath_C",
        title: "C",
        updatedAt: "2026-10-02T00:00:00.000Z",
      },
    };
    let resolveB: () => void = () => undefined;
    const gateB = new Promise<void>((resolve) => {
      resolveB = resolve;
    });
    const fetchThread = (id: string): Promise<AssistantThreadDetail | null> =>
      id === "ath_B"
        ? gateB.then(() => ({ ...detailC, thread: { ...detailC.thread, id: "ath_B", title: "B" } }))
        : Promise.resolve(detailC);

    // Open B, then C before B's answer arrives.
    const openB = openAssistantConversation(store, "ath_B", fetchThread);
    const openC = openAssistantConversation(store, "ath_C", fetchThread);
    await Bun.sleep(10);
    resolveB();
    const [resultB, resultC] = await Promise.all([openB, openC]);

    expect(resultB.kind).toBe("superseded");
    expect(resultC.kind).toBe("switched");
    expect(resultC.conversation.chatId).toBe("assistant:ath_C");
    expect(resultC.conversation.threadId.current).toBe("ath_C");
    expect(textParts(resultC.conversation)).toEqual(["hi C"]);
    // Only the winning open bumped the generation.
    expect(cell.current).toBe(1);
  });
});

describe("turn errors through the real DefaultChatTransport", () => {
  async function captureTurnError(
    fetchImpl: typeof globalThis.fetch,
  ): Promise<Error> {
    const cell = { current: 0 };
    const errors: Error[] = [];
    const conversation = createAssistantConversation({
      chatId: "assistant:new:0",
      fetch: fetchImpl,
      generation: 0,
      hooks: {
        generation: cell,
        onTurnError: (error) => {
          errors.push(error);
        },
      },
      messages: [],
      threadId: null,
    });
    // The transport delivers the JSON error body as the error message
    // (APICallError); the SDK surfaces it through onError without rejecting
    // sendMessage.
    await conversation.chat.sendMessage({ text: "q" });
    expect(errors).toHaveLength(1);
    return errors[0];
  }

  test("429 with code assistant_rate_limited maps to assistant.errorRateLimited", async () => {
    const error = await captureTurnError(async () => new Response(JSON.stringify({
      code: "assistant_rate_limited",
      error: "Too many requests",
    }), { status: 429 }));
    expect(assistantErrorFromChatError(error)).toBe("assistant_rate_limited");
    expect(assistantErrorMessageKey(assistantErrorFromChatError(error))).toBe("assistant.errorRateLimited");
  });

  test("403 with code assistant_requires_pro maps to assistant.requiresPro", async () => {
    const error = await captureTurnError(async () => new Response(JSON.stringify({
      code: "assistant_requires_pro",
      error: "Pro required",
    }), { status: 403 }));
    expect(assistantErrorFromChatError(error)).toBe("assistant_requires_pro");
    expect(assistantErrorMessageKey(assistantErrorFromChatError(error))).toBe("assistant.requiresPro");
  });

  test("a rejected fetch maps to assistant.errorNetwork", async () => {
    const error = await captureTurnError(async () => {
      throw new TypeError("fetch failed");
    });
    expect(assistantErrorFromChatError(error)).toBe("network");
    expect(assistantErrorMessageKey(assistantErrorFromChatError(error))).toBe("assistant.errorNetwork");
  });

  test("a non-JSON error body falls back to assistant.errorFailed", async () => {
    const error = await captureTurnError(async () => new Response("internal error", { status: 500 }));
    expect(assistantErrorFromChatError(error)).toBe("unknown");
    expect(assistantErrorMessageKey(assistantErrorFromChatError(error))).toBe("assistant.errorFailed");
  });
});

describe("assistantErrorFromChatError", () => {
  test("extracts the string code of a JSON error body", () => {
    expect(
      assistantErrorFromChatError(new Error('{"error":"Too many requests","code":"assistant_rate_limited"}')),
    ).toBe("assistant_rate_limited");
  });

  test("classifies fetch rejections as network, in the forms the transport really uses", () => {
    // Node/Chromium, Firefox and Safari rejections.
    expect(assistantErrorFromChatError(new TypeError("fetch failed"))).toBe("network");
    expect(
      assistantErrorFromChatError(new TypeError("NetworkError when attempting to fetch resource.")),
    ).toBe("network");
    expect(assistantErrorFromChatError(new TypeError("load failed"))).toBe("network");
    expect(assistantErrorFromChatError(new Error("Failed to fetch"))).toBe("network");
  });

  test("anything else is unknown (never the raw error text)", () => {
    expect(assistantErrorFromChatError(new Error("internal error"))).toBe("unknown");
    expect(assistantErrorFromChatError(new Error('{"code":429}'))).toBe("unknown");
    expect(assistantErrorFromChatError(new Error('"just a string"'))).toBe("unknown");
  });
});

describe("in-stream error codes (real Chat + DefaultChatTransport)", () => {
  // The reviewer's probe (s4-stream-error.probe.ts) scenario: an SSE stream
  // `start` + `error` part. The SDK delivers the part to onError as
  // `new Error(errorText)`, so the code arrives as the whole message.
  const cases: Array<[code: string, key: string]> = [
    ["ASSISTANT_TURN_TIMEOUT", "assistant.errorTimeout"],
    ["ASSISTANT_TURN_INCOMPLETE", "assistant.errorIncomplete"],
    ["ASSISTANT_STREAM_FAILED", "assistant.errorFailed"],
  ];

  for (const [code, key] of cases) {
    test(`a stream error part ${code} maps to ${key}`, async () => {
      const cell = { current: 0 };
      const errors: Error[] = [];
      const encoder = new TextEncoder();
      const conversation = createAssistantConversation({
        chatId: "assistant:new:0",
        fetch: async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                for (const chunk of [{ type: "start" }, { errorText: code, type: "error" }]) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                }
                controller.close();
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
        generation: 0,
        hooks: {
          generation: cell,
          onTurnError: (error) => {
            errors.push(error);
          },
        },
        messages: [],
        threadId: null,
      });
      await conversation.chat.sendMessage({ text: "q" });
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe(code);
      expect(assistantErrorFromChatError(errors[0])).toBe(code);
      expect(assistantErrorMessageKey(assistantErrorFromChatError(errors[0]))).toBe(key);
    });
  }
});

describe("stopping the current conversation's stream on unmount", () => {
  test("stopAssistantConversation stops a real Chat that is streaming", async () => {
    const cell = { current: 0 };
    const hooks: AssistantConversationHooks = {
      generation: cell,
      onActiveThreadCreated: () => undefined,
      onThreadEntry: () => undefined,
    };
    const a = startStreamingConversation(hooks, 0);
    await Bun.sleep(20);
    a.emit({ messageId: "answerA", type: "start" });
    a.emit({ id: "t", type: "text-start" });
    a.emit({ delta: "first", id: "t", type: "text-delta" });
    await Bun.sleep(20);
    expect(a.conversation.chat.status).toBe("streaming");
    // The panel's unmount cleanup.
    stopAssistantConversation(a.conversation);
    a.close();
    await a.send;
    expect(a.conversation.chat.status).toBe("ready");
  });
});

describe("proposal and ask parts through the real Chat + DefaultChatTransport", () => {
  const streamedProposal: AssistantPublicProposal = {
    createdAt: "2026-10-01T00:00:00.000Z",
    display: { action: "move_sessions", params: { collection: "Design", count: 3 } },
    errorCode: null,
    executedAt: null,
    expiresAt: "2026-10-01T00:10:00.000Z",
    id: "apr_STREAMEDPROPOSALXXXXXXX",
    messageId: "answerP",
    risk: "reversible",
    status: "proposed",
    threadId: "ath_P",
    tool: "pinar.move_sessions",
    undoExpiresAt: null,
  };

  function conversationStreaming(chunks: Array<Record<string, unknown>>): AssistantConversation {
    const encoder = new TextEncoder();
    return createAssistantConversation({
      chatId: "assistant:new:0",
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of chunks) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
      generation: 0,
      hooks: { generation: { current: 0 }, onActiveThreadCreated: () => undefined, onThreadEntry: () => undefined },
      messages: [],
      threadId: null,
    });
  }

  test("a data-proposal part stays on the assistant message of the turn", async () => {
    const conversation = conversationStreaming([
      { messageId: "answerP", type: "start" },
      { data: { id: "ath_P", title: "Move" }, type: "data-thread" },
      { id: "t", type: "text-start" },
      { delta: "I proposed moving 3 sessions.", id: "t", type: "text-delta" },
      { id: "t", type: "text-end" },
      { data: streamedProposal, type: "data-proposal" },
      { type: "finish" },
    ]);
    await conversation.chat.sendMessage({ text: "move them to Design" });
    const answer = conversation.chat.messages.at(-1);
    expect(answer?.role).toBe("assistant");
    expect(answer?.id).toBe("answerP");
    expect(answer?.parts.filter((part) => part.type === "data-proposal")).toEqual([
      { data: streamedProposal, type: "data-proposal" },
    ]);
    expect(answer === undefined ? [] : assistantMessageProposals(answer)).toEqual([streamedProposal]);
    expect(conversation.threadId.current).toBe("ath_P");
  });

  test("a data-ask part leaves the question and its options on the assistant message", async () => {
    const ask = { options: ["Design", "Inbox", "Archive"], question: "Which collection?" };
    const conversation = conversationStreaming([
      { messageId: "answerQ", type: "start" },
      { data: ask, type: "data-ask" },
      { type: "finish" },
    ]);
    await conversation.chat.sendMessage({ text: "move it" });
    const answer = conversation.chat.messages.at(-1);
    expect(answer?.role).toBe("assistant");
    expect(answer === undefined ? null : assistantMessageAsk(answer)).toEqual(ask);
  });

  test("opening a stored conversation seeds the proposals and the ask under their messages", async () => {
    const hooks: AssistantConversationHooks = {
      generation: { current: 0 },
      onActiveThreadCreated: () => undefined,
      onThreadEntry: () => undefined,
    };
    const ask = { options: ["Design", "Inbox"], question: "Which collection?" };
    const stored = { ...streamedProposal, messageId: "amg_2", status: "executed" as const };
    const store: AssistantConversationStore = {
      current: createAssistantConversation({ chatId: "assistant:new:0", generation: 0, hooks, messages: [], threadId: null }),
      hooks,
      newThreadCountRef: { current: 0 },
      requestedThreadRef: { current: null },
    };
    const detail: AssistantThreadDetail = {
      messages: [
        { ask: null, createdAt: "2026-10-01T00:00:00.000Z", errorCode: null, id: "amg_1", role: "user", status: "final", text: "move them", threadId: "ath_P" },
        { ask: null, createdAt: "2026-10-01T00:00:01.000Z", errorCode: null, id: "amg_2", role: "assistant", status: "final", text: "Proposed.", threadId: "ath_P" },
        { ask, createdAt: "2026-10-01T00:00:02.000Z", errorCode: null, id: "amg_3", role: "assistant", status: "final", text: "Which collection?", threadId: "ath_P" },
      ],
      proposals: [stored],
      thread: { createdAt: "2026-10-01T00:00:00.000Z", id: "ath_P", title: "Move", updatedAt: "2026-10-01T00:00:02.000Z" },
    };
    const result = await openAssistantConversation(store, "ath_P", async () => detail);
    expect(result.kind).toBe("switched");
    if (result.kind !== "switched") return;
    const [user, proposed, asked] = result.conversation.chat.messages;
    expect(assistantMessageProposals(user)).toEqual([]);
    expect(assistantMessageProposals(proposed)).toEqual([stored]);
    expect(assistantMessageAsk(proposed)).toBeNull();
    expect(assistantMessageAsk(asked)).toEqual(ask);
    expect(assistantMessageProposals(asked)).toEqual([]);
  });
});

describe("byok_error turns (F5/S3: the cause part, the 429 and the useCredits body)", () => {
  test("a data-byok-error part before the error part reaches onTurnError with the info", async () => {
    const cell = { current: 0 };
    const seen: Array<{ byok: unknown; error: Error }> = [];
    const encoder = new TextEncoder();
    const conversation = createAssistantConversation({
      chatId: "assistant:new:0",
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of [
                { messageId: "answerB", type: "start" },
                { data: { canUseCredits: true, cause: "key_rejected", retryAfter: 15 }, type: "data-byok-error" },
                { errorText: "byok_error", type: "error" },
              ]) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
      generation: 0,
      hooks: {
        generation: cell,
        onTurnError: (error, byok) => {
          seen.push({ byok, error });
        },
      },
      messages: [],
      threadId: null,
    });
    await conversation.chat.sendMessage({ text: "q" });
    expect(seen).toHaveLength(1);
    expect(assistantErrorFromChatError(seen[0].error)).toBe("byok_error");
    expect(seen[0].byok).toEqual({ canUseCredits: true, cause: "key_rejected", retryAfter: 15 });
  });

  test("the pre-stream 429 byok_error arrives as the error body and onTurnError carries no part", async () => {
    const cell = { current: 0 };
    const seen: Array<{ byok: unknown; error: Error }> = [];
    const conversation = createAssistantConversation({
      chatId: "assistant:new:0",
      fetch: async () =>
        new Response(
          JSON.stringify({ canUseCredits: true, cause: "rate_limited", code: "byok_error", retryAfter: 30 }),
          { headers: { "content-type": "application/json" }, status: 429 },
        ),
      generation: 0,
      hooks: {
        generation: cell,
        onTurnError: (error, byok) => {
          seen.push({ byok, error });
        },
      },
      messages: [],
      threadId: null,
    });
    await conversation.chat.sendMessage({ text: "q" });
    expect(seen).toHaveLength(1);
    expect(assistantErrorFromChatError(seen[0].error)).toBe("byok_error");
    // Without a part the cell stays null: the panel falls back to the body.
    expect(seen[0].byok).toBeNull();
    expect(assistantByokErrorFromChatError(seen[0].error)).toEqual({
      canUseCredits: true,
      cause: "rate_limited",
      retryAfter: 30,
    });
  });

  test("a malformed data-byok-error part is dropped only without a cause (an unknown cause keeps the generic text later)", () => {
    expect(byokErrorPart({ canUseCredits: true })).toBeNull();
    expect(byokErrorPart({ cause: "" })).toBeNull();
    expect(byokErrorPart(null)).toBeNull();
    // The part data is the server's: a readable cause always survives, and a
    // negative or missing retryAfter is dropped (the line never renders).
    expect(byokErrorPart({ cause: "not_a_cause", retryAfter: -1 })).toEqual({
      canUseCredits: true,
      cause: "not_a_cause",
      retryAfter: null,
    });
    expect(byokErrorPart({ cause: "timeout" })).toEqual({ canUseCredits: true, cause: "timeout", retryAfter: null });
  });

  test("useCredits rides only the send that asked for it", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const cell = { current: 0 };
    const encoder = new TextEncoder();
    const conversation = createAssistantConversation({
      chatId: "assistant:new:0",
      fetch: async (_input, init) => {
        const sent = JSON.parse(String((init as { body?: string }).body));
        bodies.push(sent);
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of [{ messageId: `answer${bodies.length}`, type: "start" }, { type: "finish" }]) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      },
      generation: 0,
      hooks: { generation: cell },
      messages: [],
      threadId: null,
    });
    await conversation.chat.sendMessage({ text: "first" });
    await conversation.chat.sendMessage({ text: "second, with credits" }, { body: { useCredits: true } });
    await conversation.chat.sendMessage({ text: "third" });
    expect(bodies).toHaveLength(3);
    expect(bodies[0].useCredits).toBeUndefined();
    expect(bodies[0].text).toBe("first");
    expect(bodies[1].useCredits).toBe(true);
    expect(bodies[1].text).toBe("second, with credits");
    // The next send goes back to the account's normal routing.
    expect(bodies[2].useCredits).toBeUndefined();
  });

  test("a new send resets the byok part of the previous turn", async () => {
    const cell = { current: 0 };
    const encoder = new TextEncoder();
    let turn = 0;
    const conversation = createAssistantConversation({
      chatId: "assistant:new:0",
      fetch: async () => {
        turn += 1;
        const chunks = turn === 1
          ? [{ messageId: "a1", type: "start" }, { data: { cause: "unavailable" }, type: "data-byok-error" }, { errorText: "byok_error", type: "error" }]
          : [{ messageId: "a2", type: "start" }, { type: "finish" }];
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of chunks) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      },
      generation: 0,
      hooks: { generation: cell },
      messages: [],
      threadId: null,
    });
    await conversation.chat.sendMessage({ text: "first" });
    expect(conversation.byokError.current).toEqual({ canUseCredits: true, cause: "unavailable", retryAfter: null });
    await conversation.chat.sendMessage({ text: "second" });
    expect(conversation.byokError.current).toBeNull();
  });
});
