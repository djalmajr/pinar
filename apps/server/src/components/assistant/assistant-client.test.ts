import { afterAll, describe, expect, mock, test } from "bun:test";
import {
  assistantErrorMessageKey,
  buildTurnRequestBody,
  deleteAssistantThread,
  fetchAssistantStatus,
  fetchAssistantThread,
  fetchAssistantThreads,
  threadMessagesToUiMessages,
  type AssistantMessage,
  type AssistantUIMessage,
} from "./assistant-client";

const originalFetch = globalThis.fetch;

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(handler: (input: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = mock(handler) as typeof fetch;
}

function uiMessage(
  message: Partial<AssistantUIMessage> & {
    id: string;
    parts: AssistantUIMessage["parts"];
    role: "assistant" | "user";
  },
): AssistantUIMessage {
  return message as AssistantUIMessage;
}

describe("buildTurnRequestBody", () => {
  test("sends only the last user text without a thread", () => {
    const messages: AssistantUIMessage[] = [
      uiMessage({ id: "m1", parts: [{ text: "first", type: "text" }], role: "user" }),
      uiMessage({ id: "m2", parts: [{ text: "answer", type: "text" }], role: "assistant" }),
      uiMessage({ id: "m3", parts: [{ text: "second", type: "text" }], role: "user" }),
    ];
    expect(buildTurnRequestBody(null, messages)).toEqual({ text: "second" });
    expect(buildTurnRequestBody(undefined, messages)).toEqual({ text: "second" });
  });

  test("carries the threadId of an existing conversation", () => {
    const messages: AssistantUIMessage[] = [
      uiMessage({ id: "m1", parts: [{ text: "hi", type: "text" }], role: "user" }),
    ];
    expect(buildTurnRequestBody("ath_123", messages)).toEqual({ text: "hi", threadId: "ath_123" });
  });

  test("joins the text parts of the last user message", () => {
    const messages: AssistantUIMessage[] = [
      uiMessage({
        id: "m1",
        parts: [
          { text: "part one ", type: "text" },
          { text: "part two", type: "text" },
        ],
        role: "user",
      }),
    ];
    expect(buildTurnRequestBody(null, messages)).toEqual({ text: "part one part two" });
  });

  test("ignores trailing assistant messages when locating the last user message", () => {
    const messages: AssistantUIMessage[] = [
      uiMessage({ id: "m1", parts: [{ text: "question", type: "text" }], role: "user" }),
      uiMessage({ id: "m2", parts: [{ text: "answer", type: "text" }], role: "assistant" }),
    ];
    expect(buildTurnRequestBody(null, messages)).toEqual({ text: "question" });
  });

  test("returns an empty text when there is no user message", () => {
    expect(buildTurnRequestBody(null, [])).toEqual({ text: "" });
  });
});

describe("assistantErrorMessageKey", () => {
  test("maps every contract code", () => {
    expect(assistantErrorMessageKey("ASSISTANT_TURN_TIMEOUT")).toBe("assistant.errorTimeout");
    expect(assistantErrorMessageKey("ASSISTANT_TURN_INCOMPLETE")).toBe("assistant.errorIncomplete");
    expect(assistantErrorMessageKey("ASSISTANT_STREAM_FAILED")).toBe("assistant.errorFailed");
    expect(assistantErrorMessageKey("assistant_unavailable")).toBe("assistant.errorFailed");
    expect(assistantErrorMessageKey("assistant_rate_limited")).toBe("assistant.errorRateLimited");
    expect(assistantErrorMessageKey("assistant_requires_pro")).toBe("assistant.requiresPro");
  });

  test("unknown codes and empty input fall back to the generic failure note", () => {
    expect(assistantErrorMessageKey("SOMETHING_ELSE")).toBe("assistant.errorFailed");
    expect(assistantErrorMessageKey("")).toBe("assistant.errorFailed");
    expect(assistantErrorMessageKey(null)).toBe("assistant.errorFailed");
    expect(assistantErrorMessageKey(undefined)).toBe("assistant.errorFailed");
  });
});

describe("threadMessagesToUiMessages", () => {
  test("maps final messages to single text parts", () => {
    const messages: AssistantMessage[] = [
      {
        createdAt: "2026-10-01T00:00:00.000Z",
        errorCode: null,
        id: "amg_1",
        role: "user",
        status: "final",
        text: "hello",
        threadId: "ath_1",
      },
      {
        createdAt: "2026-10-01T00:00:01.000Z",
        errorCode: null,
        id: "amg_2",
        role: "assistant",
        status: "final",
        text: "hi there",
        threadId: "ath_1",
      },
    ];
    expect(threadMessagesToUiMessages(messages)).toEqual([
      { id: "amg_1", parts: [{ text: "hello", type: "text" }], role: "user" },
      { id: "amg_2", parts: [{ text: "hi there", type: "text" }], role: "assistant" },
    ]);
  });

  test("a stored error becomes an assistant message without text and with errorCode metadata", () => {
    const messages: AssistantMessage[] = [
      {
        createdAt: "2026-10-01T00:00:00.000Z",
        errorCode: "ASSISTANT_TURN_TIMEOUT",
        id: "amg_3",
        role: "assistant",
        status: "error",
        text: "",
        threadId: "ath_1",
      },
    ];
    expect(threadMessagesToUiMessages(messages)).toEqual([
      {
        id: "amg_3",
        metadata: { errorCode: "ASSISTANT_TURN_TIMEOUT" },
        parts: [],
        role: "assistant",
      },
    ]);
  });
});

describe("assistant fetch functions", () => {
  test("fetchAssistantStatus: 200 returns the parsed status", async () => {
    stubFetch((input) => {
      if (input !== "/api/assistant/status") throw new Error(`unexpected: ${input}`);
      return jsonResponse({ available: true, reason: null, surface: "local" });
    });
    await expect(fetchAssistantStatus()).resolves.toEqual({
      available: true,
      reason: null,
      surface: "local",
    });
  });

  test("fetchAssistantStatus: 404 before the route lands returns null", async () => {
    stubFetch(() => jsonResponse({ error: "not found" }, 404));
    await expect(fetchAssistantStatus()).resolves.toBeNull();
  });

  test("fetchAssistantStatus: a network failure rejects", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(fetchAssistantStatus()).rejects.toThrow("fetch failed");
  });

  test("fetchAssistantThreads: 200 returns the list", async () => {
    const threads = [{
      createdAt: "2026-10-01T00:00:00.000Z",
      id: "ath_1",
      title: "About pins",
      updatedAt: "2026-10-01T00:00:00.000Z",
    }];
    stubFetch((input) => {
      if (input !== "/api/assistant/threads") throw new Error(`unexpected: ${input}`);
      return jsonResponse({ threads });
    });
    await expect(fetchAssistantThreads()).resolves.toEqual(threads);
  });

  test("fetchAssistantThreads: 404 returns null and a network failure rejects", async () => {
    stubFetch(() => jsonResponse({ error: "not found" }, 404));
    await expect(fetchAssistantThreads()).resolves.toBeNull();

    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(fetchAssistantThreads()).rejects.toThrow("fetch failed");
  });

  test("fetchAssistantThreads: rejects the whole answer when one entry is malformed", async () => {
    stubFetch(() =>
      jsonResponse({ threads: [{ createdAt: "x", id: 7, title: "y", updatedAt: "z" }] }));
    await expect(fetchAssistantThreads()).resolves.toBeNull();
  });

  test("fetchAssistantThread: 200 returns thread and messages", async () => {
    stubFetch((input, init) => {
      if (input !== "/api/assistant/threads/ath_1") throw new Error(`unexpected: ${input}`);
      if (init?.method !== undefined && init.method !== "GET") throw new Error("unexpected method");
      return jsonResponse({
        messages: [{
          createdAt: "2026-10-01T00:00:00.000Z",
          errorCode: null,
          id: "amg_1",
          role: "user",
          status: "final",
          text: "hello",
          threadId: "ath_1",
        }],
        thread: {
          createdAt: "2026-10-01T00:00:00.000Z",
          id: "ath_1",
          title: "About pins",
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      });
    });
    const detail = await fetchAssistantThread("ath_1");
    expect(detail?.thread.id).toBe("ath_1");
    expect(detail?.messages).toHaveLength(1);
  });

  test("fetchAssistantThread: 404 thread_not_found returns null", async () => {
    stubFetch(() =>
      jsonResponse({ code: "thread_not_found", error: "thread not found" }, 404));
    await expect(fetchAssistantThread("ath_missing")).resolves.toBeNull();
  });

  test("deleteAssistantThread: 200 { ok: true } resolves true", async () => {
    stubFetch((input, init) => {
      if (input !== "/api/assistant/threads/ath_1") throw new Error(`unexpected: ${input}`);
      if (init?.method !== "DELETE") throw new Error("unexpected method");
      return jsonResponse({ ok: true });
    });
    await expect(deleteAssistantThread("ath_1")).resolves.toBe(true);
  });

  test("deleteAssistantThread: 404 resolves false and a network failure rejects", async () => {
    stubFetch(() =>
      jsonResponse({ code: "thread_not_found", error: "thread not found" }, 404));
    await expect(deleteAssistantThread("ath_missing")).resolves.toBe(false);

    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(deleteAssistantThread("ath_1")).rejects.toThrow("fetch failed");
  });
});
