import { afterAll, describe, expect, mock, test } from "bun:test";
import { formatMessage } from "@/lib/i18n";
import englishMessages from "@/lib/ui-locales/en";
import {
  ASSISTANT_PROPOSAL_ACTIONS,
  ASSISTANT_RESOURCE_TYPES,
  assistantCreditsFromChatError,
  assistantErrorFromChatError,
  assistantErrorMessageKey,
  assistantMessageAsk,
  assistantMessageProposals,
  assistantProposalErrorKey,
  buildTurnRequestBody,
  confirmAssistantProposal,
  deleteAssistantThread,
  fetchAssistantStatus,
  fetchAssistantThread,
  fetchAssistantThreads,
  rejectAssistantProposal,
  runAssistantProposalAction,
  threadMessagesToUiMessages,
  undoAssistantProposal,
  type AssistantMessage,
  type AssistantProposalAction,
  type AssistantPublicProposal,
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
    expect(assistantErrorMessageKey("insufficient_ai_credits")).toBe("assistant.errorNoCredits");
  });

  test("unknown codes and empty input fall back to the generic failure note", () => {
    expect(assistantErrorMessageKey("SOMETHING_ELSE")).toBe("assistant.errorFailed");
    expect(assistantErrorMessageKey("")).toBe("assistant.errorFailed");
    expect(assistantErrorMessageKey(null)).toBe("assistant.errorFailed");
    expect(assistantErrorMessageKey(undefined)).toBe("assistant.errorFailed");
  });
});

describe("assistantCreditsFromChatError", () => {
  const body402 = { aiCredits: { balance: 2, nextExpiryAt: null }, code: "insufficient_ai_credits", creditsRequired: 3, error: "Not enough AI credits" };

  test("reads the balance and the price of the 402 body the transport puts in the message", () => {
    const error = new Error(JSON.stringify(body402));
    expect(assistantErrorFromChatError(error)).toBe("insufficient_ai_credits");
    expect(assistantCreditsFromChatError(error)).toEqual({ balance: 2, required: 3 });
  });

  test("the note renders the balance and the price in the 7 languages", async () => {
    for (const language of ["de", "en", "es", "fr", "ja", "pt", "zh"] as const) {
      const messages = (await import(`@/lib/ui-locales/${language}`)).default as typeof englishMessages;
      const note = formatMessage(messages["assistant.errorNoCredits"], language, { count: 2, required: 3 });
      expect(note).toContain("2");
      expect(note).toContain("3");
      expect(note).not.toMatch(/[{}#]/);
      expect(messages["assistant.buyCredits"].length).toBeGreaterThan(0);
      expect(messages["settings.aiUsageAssistantTurn"].length).toBeGreaterThan(0);
    }
    expect(formatMessage(englishMessages["assistant.errorNoCredits"], "en", { count: 1, required: 3 }))
      .toBe("Not enough AI credits: a message uses 3 and you have 1 credit left.");
  });

  test("anything else is null: other codes, malformed numbers, plain text", () => {
    const cases = [
      { ...body402, code: "assistant_rate_limited" },
      { ...body402, aiCredits: { balance: "2" } },
      { ...body402, aiCredits: { balance: -1 } },
      { ...body402, aiCredits: { balance: 1.5 } },
      { ...body402, creditsRequired: 0 },
      { ...body402, aiCredits: null },
    ];
    for (const body of cases) expect(assistantCreditsFromChatError(new Error(JSON.stringify(body)))).toBeNull();
    expect(assistantCreditsFromChatError(new Error("ASSISTANT_STREAM_FAILED"))).toBeNull();
    expect(assistantCreditsFromChatError(new Error("not json {"))).toBeNull();
  });
});

describe("threadMessagesToUiMessages", () => {
  test("maps final messages to single text parts", () => {
    const messages: AssistantMessage[] = [
      {
        ask: null,
        createdAt: "2026-10-01T00:00:00.000Z",
        errorCode: null,
        id: "amg_1",
        role: "user",
        status: "final",
        text: "hello",
        threadId: "ath_1",
      },
      {
        ask: null,
        createdAt: "2026-10-01T00:00:01.000Z",
        errorCode: null,
        id: "amg_2",
        role: "assistant",
        status: "final",
        text: "hi there",
        threadId: "ath_1",
      },
    ];
    expect(threadMessagesToUiMessages(messages, [])).toEqual([
      { id: "amg_1", parts: [{ text: "hello", type: "text" }], role: "user" },
      { id: "amg_2", parts: [{ text: "hi there", type: "text" }], role: "assistant" },
    ]);
  });

  test("a stored error becomes an assistant message without text and with errorCode metadata", () => {
    const messages: AssistantMessage[] = [
      {
        ask: null,
        createdAt: "2026-10-01T00:00:00.000Z",
        errorCode: "ASSISTANT_TURN_TIMEOUT",
        id: "amg_3",
        role: "assistant",
        status: "error",
        text: "",
        threadId: "ath_1",
      },
    ];
    expect(threadMessagesToUiMessages(messages, [])).toEqual([
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
          ask: null,
          createdAt: "2026-10-01T00:00:00.000Z",
          errorCode: null,
          id: "amg_1",
          role: "user",
          status: "final",
          text: "hello",
          threadId: "ath_1",
        }],
        proposals: [],
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

const PROPOSAL_ID = "apr_ABCDEFGHIJKLMNOPQRSTUVWX";

function proposal(overrides: Partial<AssistantPublicProposal> = {}): AssistantPublicProposal {
  return {
    createdAt: "2026-10-01T00:00:00.000Z",
    display: { action: "move_session", params: { collection: "Design", session: "Checkout" } },
    errorCode: null,
    executedAt: null,
    expiresAt: "2026-10-01T00:10:00.000Z",
    id: PROPOSAL_ID,
    messageId: "amg_2",
    risk: "reversible",
    status: "proposed",
    threadId: "ath_1",
    tool: "pinar.move_session",
    undoExpiresAt: null,
    ...overrides,
  };
}

function threadBody(proposals: unknown[], messages: unknown[] = []) {
  return {
    messages,
    proposals,
    thread: {
      createdAt: "2026-10-01T00:00:00.000Z",
      id: "ath_1",
      title: "About pins",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  };
}

function storedMessage(overrides: Partial<AssistantMessage>): AssistantMessage {
  return {
    ask: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    errorCode: null,
    id: "amg_1",
    role: "user",
    status: "final",
    text: "hello",
    threadId: "ath_1",
    ...overrides,
  };
}

describe("proposal actions (fetch stubbed)", () => {
  test("confirm: 200 { proposal } resolves ok with the proposal, by POST to the confirm route", async () => {
    const executed = proposal({ executedAt: "2026-10-01T00:01:00.000Z", status: "executed" });
    const calls: Array<{ input: string; method: string | undefined }> = [];
    stubFetch((input, init) => {
      calls.push({ input, method: init?.method });
      return jsonResponse({ proposal: executed });
    });
    await expect(confirmAssistantProposal(PROPOSAL_ID)).resolves.toEqual({ ok: true, proposal: executed });
    expect(calls).toEqual([{ input: `/api/assistant/proposals/${PROPOSAL_ID}/confirm`, method: "POST" }]);
  });

  test("reject and undo post to their own routes", async () => {
    const calls: string[] = [];
    stubFetch((input, init) => {
      calls.push(`${init?.method} ${input}`);
      return jsonResponse({ proposal: proposal({ status: input.endsWith("/reject") ? "rejected" : "undone" }) });
    });
    const rejected = await rejectAssistantProposal(PROPOSAL_ID);
    const undone = await undoAssistantProposal(PROPOSAL_ID);
    expect(rejected.ok && rejected.proposal.status).toBe("rejected");
    expect(undone.ok && undone.proposal.status).toBe("undone");
    expect(calls).toEqual([
      `POST /api/assistant/proposals/${PROPOSAL_ID}/reject`,
      `POST /api/assistant/proposals/${PROPOSAL_ID}/undo`,
    ]);
  });

  test("409 proposal_expired resolves { ok: false, code } from the JSON error body", async () => {
    stubFetch(() => jsonResponse({ code: "proposal_expired", error: "Proposal expired" }, 409));
    await expect(confirmAssistantProposal(PROPOSAL_ID)).resolves.toEqual({ code: "proposal_expired", ok: false });
  });

  test("a rejected fetch resolves code network (never rejects)", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(confirmAssistantProposal(PROPOSAL_ID)).resolves.toEqual({ code: "network", ok: false });
    await expect(rejectAssistantProposal(PROPOSAL_ID)).resolves.toEqual({ code: "network", ok: false });
    await expect(undoAssistantProposal(PROPOSAL_ID)).resolves.toEqual({ code: "network", ok: false });
  });

  test("an error answer without a code, or a 2xx answer with an invalid or other proposal, is unknown", async () => {
    stubFetch(() => new Response("internal error", { status: 500 }));
    await expect(confirmAssistantProposal(PROPOSAL_ID)).resolves.toEqual({ code: "unknown", ok: false });

    stubFetch(() => jsonResponse({ proposal: { ...proposal(), status: "done" } }));
    await expect(confirmAssistantProposal(PROPOSAL_ID)).resolves.toEqual({ code: "unknown", ok: false });

    stubFetch(() => jsonResponse({ proposal: proposal({ id: "apr_OTHERPROPOSALIDXXXXXXXXX" }) }));
    await expect(confirmAssistantProposal(PROPOSAL_ID)).resolves.toEqual({ code: "unknown", ok: false });

    stubFetch(() => jsonResponse({
      proposal: proposal({ display: { action: "drop_everything" as AssistantProposalAction, params: {} } }),
    }));
    await expect(confirmAssistantProposal(PROPOSAL_ID)).resolves.toEqual({ code: "unknown", ok: false });
  });

  test("the id is encoded into the route path", async () => {
    const calls: string[] = [];
    stubFetch((input) => {
      calls.push(input);
      return jsonResponse({ code: "proposal_not_found" }, 404);
    });
    await expect(confirmAssistantProposal("../threads/ath_1")).resolves.toEqual({
      code: "proposal_not_found",
      ok: false,
    });
    expect(calls).toEqual(["/api/assistant/proposals/..%2Fthreads%2Fath_1/confirm"]);
  });
});

describe("assistantProposalErrorKey", () => {
  test("maps every proposal errorCode and action code", () => {
    expect(assistantProposalErrorKey("proposal_stale")).toBe("assistant.proposalStale");
    expect(assistantProposalErrorKey("proposal_failed")).toBe("assistant.proposalFailed");
    expect(assistantProposalErrorKey("proposal_unknown_outcome")).toBe("assistant.proposalUnknownOutcome");
    expect(assistantProposalErrorKey("undo_stale")).toBe("assistant.undoStale");
    expect(assistantProposalErrorKey("undo_failed")).toBe("assistant.undoFailed");
    expect(assistantProposalErrorKey("proposal_expired")).toBe("assistant.proposalExpired");
    expect(assistantProposalErrorKey("assistant_requires_pro")).toBe("assistant.requiresPro");
    expect(assistantProposalErrorKey("network")).toBe("assistant.errorNetwork");
  });

  test("not found, the other conflicts, unavailable and unknown codes fall back to the generic note", () => {
    for (const code of [
      "proposal_not_found",
      "proposal_not_pending",
      "proposal_in_progress",
      "undo_unavailable",
      "assistant_unavailable",
      "unknown",
      "",
      null,
      undefined,
    ]) {
      expect(assistantProposalErrorKey(code)).toBe("assistant.errorFailed");
    }
  });
});

describe("runAssistantProposalAction", () => {
  test("200: the answer's proposal replaces the card's, without a note", async () => {
    const executed = proposal({ status: "executed", undoExpiresAt: "2026-10-01T00:11:00.000Z" });
    stubFetch(() => jsonResponse({ proposal: executed }));
    await expect(runAssistantProposalAction("confirm", proposal())).resolves.toEqual({
      errorKey: null,
      proposal: executed,
    });
  });

  test("409: fetches the thread again (after the action) and uses the proposal state from there", async () => {
    const calls: string[] = [];
    const expired = proposal({ status: "expired" });
    stubFetch((input, init) => {
      calls.push(`${init?.method ?? "GET"} ${input}`);
      if (input.startsWith("/api/assistant/proposals/")) {
        return jsonResponse({ code: "proposal_expired", error: "expired" }, 409);
      }
      return jsonResponse(threadBody([proposal({ id: "apr_SOMEOTHERPROPOSALXXXXXXX" }), expired]));
    });
    await expect(runAssistantProposalAction("confirm", proposal())).resolves.toEqual({
      errorKey: null,
      proposal: expired,
    });
    expect(calls).toEqual([
      `POST /api/assistant/proposals/${PROPOSAL_ID}/confirm`,
      "GET /api/assistant/threads/ath_1",
    ]);
  });

  test("409 whose refetch fails or lacks the proposal: keeps the proposal and shows the code's key", async () => {
    stubFetch((input) => {
      if (input.startsWith("/api/assistant/proposals/")) {
        return jsonResponse({ code: "undo_stale" }, 409);
      }
      throw new TypeError("fetch failed");
    });
    const card = proposal({ status: "executed", undoExpiresAt: "2026-10-01T00:11:00.000Z" });
    await expect(runAssistantProposalAction("undo", card)).resolves.toEqual({
      errorKey: "assistant.undoStale",
      proposal: card,
    });

    stubFetch((input) => input.startsWith("/api/assistant/proposals/")
      ? jsonResponse({ code: "proposal_expired" }, 409)
      : jsonResponse(threadBody([])));
    await expect(runAssistantProposalAction("confirm", proposal())).resolves.toEqual({
      errorKey: "assistant.proposalExpired",
      proposal: proposal(),
    });
  });

  test("404 and network failures do not refetch: the card keeps its state with the mapped note", async () => {
    const calls: string[] = [];
    stubFetch((input) => {
      calls.push(input);
      return jsonResponse({ code: "proposal_not_found" }, 404);
    });
    await expect(runAssistantProposalAction("reject", proposal())).resolves.toEqual({
      errorKey: "assistant.errorFailed",
      proposal: proposal(),
    });
    expect(calls).toEqual([`/api/assistant/proposals/${PROPOSAL_ID}/reject`]);

    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(runAssistantProposalAction("confirm", proposal())).resolves.toEqual({
      errorKey: "assistant.errorNetwork",
      proposal: proposal(),
    });
  });
});

describe("thread detail with proposals and asks", () => {
  test("fetchAssistantThread returns the proposals and each message's ask", async () => {
    const ask = { options: ["Design", "Inbox"], question: "Which collection?" };
    stubFetch(() => jsonResponse(threadBody(
      [proposal()],
      [storedMessage({}), storedMessage({ ask, id: "amg_2", role: "assistant", text: "Which collection?" })],
    )));
    const detail = await fetchAssistantThread("ath_1");
    expect(detail?.proposals).toEqual([proposal()]);
    expect(detail?.messages.map((message) => message.ask)).toEqual([null, ask]);
  });

  test("a malformed proposal, a missing proposals list or an invalid ask rejects the whole answer", async () => {
    const malformed: unknown[] = [
      threadBody([proposal(), { ...proposal(), risk: "safe" }]),
      threadBody([{ ...proposal(), errorCode: "boom" }]),
      threadBody([{ ...proposal(), display: { action: "move_session", params: { session: { id: "ses_1" } } } }]),
      { ...threadBody([]), proposals: undefined },
      threadBody([], [storedMessage({ ask: { options: ["only one"], question: "Pick" } })]),
      threadBody([], [storedMessage({ ask: { options: ["a", "b", "c", "d", "e", "f"], question: "Pick" } })]),
      threadBody([], [{ ...storedMessage({}), ask: undefined }]),
    ];
    for (const body of malformed) {
      stubFetch(() => jsonResponse(body));
      await expect(fetchAssistantThread("ath_1")).resolves.toBeNull();
    }
  });

  test("threadMessagesToUiMessages puts each proposal under the message with its messageId", () => {
    const ask = { options: ["Design", "Inbox"], question: "Which collection?" };
    const first = proposal({ messageId: "amg_2" });
    const second = proposal({ id: "apr_SECONDPROPOSALXXXXXXXXX", messageId: "amg_4" });
    const orphan = proposal({ id: "apr_ORPHANPROPOSALXXXXXXXXX", messageId: "amg_gone" });
    const messages = threadMessagesToUiMessages([
      storedMessage({ id: "amg_1" }),
      storedMessage({ ask, id: "amg_2", role: "assistant", text: "Which collection?" }),
      storedMessage({ id: "amg_3", text: "Design" }),
      storedMessage({ errorCode: "ASSISTANT_TURN_TIMEOUT", id: "amg_4", role: "assistant", status: "error", text: "" }),
    ], [first, second, orphan]);
    expect(messages).toEqual([
      { id: "amg_1", parts: [{ text: "hello", type: "text" }], role: "user" },
      {
        id: "amg_2",
        parts: [
          { text: "Which collection?", type: "text" },
          { data: ask, type: "data-ask" },
          { data: first, type: "data-proposal" },
        ],
        role: "assistant",
      },
      { id: "amg_3", parts: [{ text: "Design", type: "text" }], role: "user" },
      {
        id: "amg_4",
        metadata: { errorCode: "ASSISTANT_TURN_TIMEOUT" },
        parts: [{ data: second, type: "data-proposal" }],
        role: "assistant",
      },
    ]);
    expect(JSON.stringify(messages)).not.toContain("apr_ORPHANPROPOSAL");
  });

  test("assistantMessageProposals: a later part for the same id wins, invalid data is skipped", () => {
    const executed = proposal({ status: "executed" });
    const other = proposal({ id: "apr_SECONDPROPOSALXXXXXXXXX" });
    const message = uiMessage({
      id: "amg_2",
      parts: [
        { data: proposal(), type: "data-proposal" },
        { data: other, type: "data-proposal" },
        { data: { id: "apr_BROKEN" }, type: "data-proposal" },
        { data: executed, type: "data-proposal" },
      ],
      role: "assistant",
    });
    expect(assistantMessageProposals(message)).toEqual([executed, other]);
  });

  test("assistantMessageAsk: the last valid data-ask; options outside 2 to 5 are invalid", () => {
    const ask = { options: ["Design", "Inbox"], question: "Which collection?" };
    expect(assistantMessageAsk(uiMessage({
      id: "m",
      parts: [{ data: ask, type: "data-ask" }, { data: { options: ["x"], question: "Bad" }, type: "data-ask" }],
      role: "assistant",
    }))).toEqual(ask);
    expect(assistantMessageAsk(uiMessage({
      id: "m",
      parts: [{ data: { options: ["x"], question: "Bad" }, type: "data-ask" }],
      role: "assistant",
    }))).toBeNull();
    expect(assistantMessageAsk(uiMessage({ id: "m", parts: [{ text: "hi", type: "text" }], role: "assistant" })))
      .toBeNull();
  });
});

describe("proposal i18n keys (contract 1.3 and 4.1)", () => {
  const PLACEHOLDER = /\{(\w+)(?:,\s*plural[^}]*)?\}/g;
  // The params of each action, from the contract table 1.3.
  const CONTRACT_PARAMS: Record<AssistantProposalAction, string[]> = {
    add_pin_comment: ["body", "pin", "session"],
    conclude_pin: ["pin", "session"],
    create_batch: ["label"],
    create_collection: ["name", "project"],
    create_pin: ["comment", "session"],
    create_project: ["name"],
    create_session: ["title"],
    delete_batch: ["label"],
    delete_collection: ["name", "sessions"],
    delete_pin: ["pin", "session"],
    delete_pin_comment: ["pin", "session"],
    delete_project: ["collections", "name"],
    delete_session: ["pins", "session"],
    edit_pin_comment: ["body", "pin", "session"],
    edit_pin_note: ["comment", "pin", "session"],
    finish_batch: ["label"],
    move_session: ["collection", "session"],
    move_sessions: ["collection", "count"],
    publish_share: ["kind", "resource"],
    rename_batch: ["from", "to"],
    rename_collection: ["from", "to"],
    rename_project: ["from", "to"],
    reopen_pin: ["pin", "session"],
    reorder_collections: ["count", "project"],
    reorder_projects: ["count"],
    reorder_sessions: ["collection", "count"],
    revoke_share: ["kind", "resource"],
    update_session: ["session"],
  };

  test("the 28 actions each have a key whose placeholders are the contract params", () => {
    expect(ASSISTANT_PROPOSAL_ACTIONS).toHaveLength(28);
    const messages: Record<string, string> = englishMessages;
    for (const action of ASSISTANT_PROPOSAL_ACTIONS) {
      const message = messages[`assistant.proposal.${action}`];
      expect(typeof message).toBe("string");
      const names = [...new Set([...message.matchAll(PLACEHOLDER)].map((match) => match[1]))].sort();
      expect({ action, names }).toEqual({ action, names: CONTRACT_PARAMS[action] });
    }
  });

  test("every resource type has an assistant.resource key", () => {
    const messages: Record<string, string> = englishMessages;
    expect([...ASSISTANT_RESOURCE_TYPES]).toEqual(["batch", "collection", "project", "session"]);
    for (const kind of ASSISTANT_RESOURCE_TYPES) {
      expect(typeof messages[`assistant.resource.${kind}`]).toBe("string");
    }
  });
});
