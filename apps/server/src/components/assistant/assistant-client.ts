// HTTP client for the assistant contract (sections 1 and 2 of
// ai-assistant-f1-contract.md; proposals and asks from sections 1.2, 1.6 and
// 3 of ai-assistant-f2-contract.md). No React here. Local types mirror the
// store contract; the server routes arrive in a parallel slice, so every
// read degrades to null (hidden/empty UI) instead of throwing on non-2xx
// answers, while genuine network failures reject. The proposal actions never
// reject: they resolve to `{ ok: false, code }`.
import { isRecord, readResponseRecord } from "@/lib/api-data";
import type { TextUIPart, UIMessage } from "ai";

export type AssistantReason = "disabled" | "not_configured" | "requires_pro" | null;

export interface AssistantStatus {
  available: boolean;
  /** F5/S3: the BYOK route of the account (chat with tools ok); kept for the future, nothing visible depends on it yet. */
  byok?: { chat: boolean };
  reason: AssistantReason;
  surface: "cloud" | "local";
}

export interface AssistantThread {
  createdAt: string;
  id: string;
  title: string;
  updatedAt: string;
}

export type AssistantRole = "assistant" | "user";
export type AssistantMessageStatus = "error" | "final";

/** A `pinar_ask` question: 2 to 5 options the user can pick as the next message. */
export interface AssistantAsk {
  options: string[];
  question: string;
}

export interface AssistantMessage {
  ask: AssistantAsk | null;
  createdAt: string;
  errorCode: string | null;
  id: string;
  role: AssistantRole;
  status: AssistantMessageStatus;
  text: string;
  threadId: string;
}

export const ASSISTANT_PROPOSAL_ACTIONS = [
  "create_project",
  "rename_project",
  "reorder_projects",
  "delete_project",
  "create_collection",
  "rename_collection",
  "reorder_collections",
  "delete_collection",
  "move_session",
  "move_sessions",
  "reorder_sessions",
  "create_session",
  "update_session",
  "delete_session",
  "create_batch",
  "rename_batch",
  "finish_batch",
  "delete_batch",
  "create_pin",
  "edit_pin_note",
  "delete_pin",
  "conclude_pin",
  "reopen_pin",
  "add_pin_comment",
  "edit_pin_comment",
  "delete_pin_comment",
  "publish_share",
  "revoke_share",
] as const;

/** The MCP tool name without `pinar.`; the card text is `assistant.proposal.<action>`. */
export type AssistantProposalAction = (typeof ASSISTANT_PROPOSAL_ACTIONS)[number];

/** The `kind` param of the share actions, translated by `assistant.resource.<kind>`. */
export const ASSISTANT_RESOURCE_TYPES = ["batch", "collection", "project", "session"] as const;
export type AssistantResourceType = (typeof ASSISTANT_RESOURCE_TYPES)[number];

export type AssistantProposalStatus =
  | "proposed"
  | "executing"
  | "executed"
  | "failed"
  | "rejected"
  | "expired"
  | "undoing"
  | "undone";

export type AssistantProposalErrorCode =
  | "proposal_stale"
  | "proposal_failed"
  | "proposal_unknown_outcome"
  | "undo_stale"
  | "undo_failed";

export type AssistantProposalRisk = "reversible" | "irreversible" | "external";

export interface AssistantProposalDisplay {
  action: AssistantProposalAction;
  params: Record<string, string | number>;
}

/** What crosses HTTP and the stream: never args, fingerprint, undo or result. */
export interface AssistantPublicProposal {
  createdAt: string;
  display: AssistantProposalDisplay;
  errorCode: AssistantProposalErrorCode | null;
  executedAt: string | null;
  expiresAt: string;
  id: string;
  messageId: string;
  risk: AssistantProposalRisk;
  status: AssistantProposalStatus;
  threadId: string;
  tool: string;
  undoExpiresAt: string | null;
}

/**
 * UIMessage with the assistant metadata the panel uses: a stored error
 * message carries `{ errorCode }` (the AssistantErrorCode from the stream).
 */
export interface AssistantUIMessage extends UIMessage {
  metadata?: { errorCode?: string } | null;
}

export type AssistantErrorKey =
  | "assistant.errorIncomplete"
  | "assistant.errorFailed"
  | "assistant.errorNetwork"
  | "assistant.errorNoCredits"
  | "assistant.errorRateLimited"
  | "assistant.errorTimeout"
  | "assistant.requiresPro"
  | "byok.errorGeneric";

/**
 * The BYOK failure info the UI shows (F5 contract §5): the cause code of the
 * common table, the Retry-After in seconds when there is one and the credits
 * offer. It crosses the turn as a `data-byok-error` part (mid-stream) or in
 * the pre-stream 429 JSON body; the provider's body and the key never do.
 */
export interface AssistantByokErrorInfo {
  canUseCredits: boolean;
  cause: string;
  retryAfter: number | null;
}

function isAssistantThread(value: unknown): value is AssistantThread {
  return isRecord(value)
    && typeof value.createdAt === "string"
    && typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.updatedAt === "string";
}

const ASSISTANT_ASK_MIN_OPTIONS = 2;
const ASSISTANT_ASK_MAX_OPTIONS = 5;

/** `{ question, options }` with a non-empty question and 2 to 5 non-empty options. */
export function isAssistantAsk(value: unknown): value is AssistantAsk {
  return isRecord(value)
    && typeof value.question === "string"
    && value.question !== ""
    && Array.isArray(value.options)
    && value.options.length >= ASSISTANT_ASK_MIN_OPTIONS
    && value.options.length <= ASSISTANT_ASK_MAX_OPTIONS
    && value.options.every((option) => typeof option === "string" && option !== "");
}

const PROPOSAL_ACTIONS: ReadonlySet<string> = new Set(ASSISTANT_PROPOSAL_ACTIONS);
const PROPOSAL_STATUSES: ReadonlySet<string> = new Set<AssistantProposalStatus>([
  "proposed",
  "executing",
  "executed",
  "failed",
  "rejected",
  "expired",
  "undoing",
  "undone",
]);
const PROPOSAL_ERROR_CODES: ReadonlySet<string> = new Set<AssistantProposalErrorCode>([
  "proposal_stale",
  "proposal_failed",
  "proposal_unknown_outcome",
  "undo_stale",
  "undo_failed",
]);
const PROPOSAL_RISKS: ReadonlySet<string> = new Set<AssistantProposalRisk>([
  "reversible",
  "irreversible",
  "external",
]);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isProposalDisplay(value: unknown): value is AssistantProposalDisplay {
  return isRecord(value)
    && typeof value.action === "string"
    && PROPOSAL_ACTIONS.has(value.action)
    && isRecord(value.params)
    && Object.values(value.params).every((param) =>
      typeof param === "string" || (typeof param === "number" && Number.isFinite(param)));
}

/** The public proposal shape of contract 1.2; an unknown action, status or code is invalid. */
export function isAssistantPublicProposal(value: unknown): value is AssistantPublicProposal {
  return isRecord(value)
    && typeof value.createdAt === "string"
    && isProposalDisplay(value.display)
    && (value.errorCode === null
      || (typeof value.errorCode === "string" && PROPOSAL_ERROR_CODES.has(value.errorCode)))
    && isNullableString(value.executedAt)
    && typeof value.expiresAt === "string"
    && typeof value.id === "string"
    && value.id !== ""
    && typeof value.messageId === "string"
    && typeof value.risk === "string"
    && PROPOSAL_RISKS.has(value.risk)
    && typeof value.status === "string"
    && PROPOSAL_STATUSES.has(value.status)
    && typeof value.threadId === "string"
    && typeof value.tool === "string"
    && isNullableString(value.undoExpiresAt);
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
  return isRecord(value)
    && (value.ask === null || isAssistantAsk(value.ask))
    && typeof value.createdAt === "string"
    && (value.errorCode === null || typeof value.errorCode === "string")
    && typeof value.id === "string"
    && (value.role === "assistant" || value.role === "user")
    && (value.status === "error" || value.status === "final")
    && typeof value.text === "string"
    && typeof value.threadId === "string";
}

function isAssistantStatus(value: unknown): value is AssistantStatus {
  if (!isRecord(value)) return false;
  const byok = value.byok;
  return typeof value.available === "boolean"
    && (value.reason === "disabled"
      || value.reason === "not_configured"
      || value.reason === "requires_pro"
      || value.reason === null)
    && (value.surface === "cloud" || value.surface === "local")
    && (byok === undefined || (isRecord(byok) && typeof byok.chat === "boolean"));
}

/**
 * `GET /api/assistant/status`. Returns the parsed status on a valid 2xx
 * answer and null on an error answer (404 before the route lands, 401, ...)
 * or an invalid body. Network failures reject. The F5/S3 `byok` block (when
 * the server carries it) is kept as is for the future.
 */
export async function fetchAssistantStatus(): Promise<AssistantStatus | null> {
  const response = await fetch("/api/assistant/status");
  const data = await readResponseRecord(response);
  if (!response.ok || data === null || !isAssistantStatus(data)) return null;
  return {
    available: data.available,
    byok: data.byok !== undefined ? { chat: data.byok.chat } : undefined,
    reason: data.reason,
    surface: data.surface,
  };
}

/** `GET /api/assistant/threads`. null on error answers or an invalid list. */
export async function fetchAssistantThreads(): Promise<AssistantThread[] | null> {
  const response = await fetch("/api/assistant/threads");
  const data = await readResponseRecord(response);
  if (!response.ok || data === null || !Array.isArray(data.threads)) return null;
  if (!data.threads.every(isAssistantThread)) return null;
  return data.threads;
}

export interface AssistantThreadDetail {
  messages: AssistantMessage[];
  /** The thread's proposals, createdAt asc then id asc. */
  proposals: AssistantPublicProposal[];
  thread: AssistantThread;
}

/**
 * `GET /api/assistant/threads/:id`. null on 404 or an invalid body: one
 * malformed message or proposal rejects the whole answer.
 */
export async function fetchAssistantThread(id: string): Promise<AssistantThreadDetail | null> {
  const response = await fetch(`/api/assistant/threads/${encodeURIComponent(id)}`);
  const data = await readResponseRecord(response);
  if (!response.ok || data === null || !isAssistantThread(data.thread)) return null;
  if (!Array.isArray(data.messages) || !data.messages.every(isAssistantMessage)) return null;
  if (!Array.isArray(data.proposals) || !data.proposals.every(isAssistantPublicProposal)) return null;
  return { messages: data.messages, proposals: data.proposals, thread: data.thread };
}

export type AssistantProposalActionKind = "confirm" | "reject" | "undo";

/**
 * A proposal action answer. `code` is the `code` of the JSON error body,
 * `"network"` when the request never got an answer, or `"unknown"` for an
 * answer without a code (or a 2xx answer whose proposal is invalid).
 */
export type AssistantProposalActionResult =
  | { ok: true; proposal: AssistantPublicProposal }
  | { code: string; ok: false };

async function postAssistantProposalAction(
  kind: AssistantProposalActionKind,
  id: string,
): Promise<AssistantProposalActionResult> {
  let response: Response;
  let data: Record<string, unknown> | null;
  try {
    response = await fetch(`/api/assistant/proposals/${encodeURIComponent(id)}/${kind}`, { method: "POST" });
    data = await readResponseRecord(response);
  } catch {
    // No answer, or the answer broke off while its body was read.
    return { code: "network", ok: false };
  }
  if (!response.ok) {
    const code = data !== null && typeof data.code === "string" && data.code !== "" ? data.code : "unknown";
    return { code, ok: false };
  }
  // The answer must be the proposal that was asked for.
  if (data === null || !isAssistantPublicProposal(data.proposal) || data.proposal.id !== id) {
    return { code: "unknown", ok: false };
  }
  return { ok: true, proposal: data.proposal };
}

/** `POST /api/assistant/proposals/:id/confirm`: 200 is `executed` or `failed` with its errorCode. */
export function confirmAssistantProposal(id: string): Promise<AssistantProposalActionResult> {
  return postAssistantProposalAction("confirm", id);
}

/** `POST /api/assistant/proposals/:id/reject`: 200 is `rejected`. */
export function rejectAssistantProposal(id: string): Promise<AssistantProposalActionResult> {
  return postAssistantProposalAction("reject", id);
}

/** `POST /api/assistant/proposals/:id/undo`: 200 is `undone`, or `executed` with `undo_failed`. */
export function undoAssistantProposal(id: string): Promise<AssistantProposalActionResult> {
  return postAssistantProposalAction("undo", id);
}

const PROPOSAL_ACTION_REQUESTS: Record<
  AssistantProposalActionKind,
  (id: string) => Promise<AssistantProposalActionResult>
> = {
  confirm: confirmAssistantProposal,
  reject: rejectAssistantProposal,
  undo: undoAssistantProposal,
};

/** The 409 codes of contract section 3: the proposal moved on, its real state is in the thread. */
const PROPOSAL_CONFLICT_CODES: ReadonlySet<string> = new Set([
  "proposal_expired",
  "proposal_in_progress",
  "proposal_not_pending",
  "undo_stale",
  "undo_unavailable",
]);

export interface AssistantProposalActionOutcome {
  /** Set when the card must show a note next to the proposal state. */
  errorKey: AssistantProposalErrorKey | null;
  /** The most recent state of the proposal the client knows. */
  proposal: AssistantPublicProposal;
}

/**
 * Run one card action and settle the card state (contract section 4): the
 * proposal of the answer replaces the card's; a 409 fetches the thread again
 * and shows the real state of the proposal there; anything else (or a 409
 * whose refetch fails) keeps the proposal and shows the mapped error key.
 */
export async function runAssistantProposalAction(
  kind: AssistantProposalActionKind,
  proposal: AssistantPublicProposal,
): Promise<AssistantProposalActionOutcome> {
  const result = await PROPOSAL_ACTION_REQUESTS[kind](proposal.id);
  if (result.ok) return { errorKey: null, proposal: result.proposal };
  if (PROPOSAL_CONFLICT_CODES.has(result.code)) {
    const detail = await fetchAssistantThread(proposal.threadId).catch(() => null);
    const current = detail?.proposals.find((item) => item.id === proposal.id);
    if (current !== undefined) return { errorKey: null, proposal: current };
  }
  return { errorKey: assistantProposalErrorKey(result.code), proposal };
}

/** `DELETE /api/assistant/threads/:id`. false when the thread is gone or the answer is not `ok`. */
export async function deleteAssistantThread(id: string): Promise<boolean> {
  const response = await fetch(`/api/assistant/threads/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) return false;
  const data = await readResponseRecord(response);
  return data !== null && data.ok === true;
}

/**
 * Body for `POST /api/assistant/turn`: the text of the last user message
 * (its text parts joined) plus the threadId of an existing conversation.
 */
export function buildTurnRequestBody(
  threadId: string | null | undefined,
  messages: readonly AssistantUIMessage[],
): { threadId?: string; text: string } {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const body: { threadId?: string; text: string } = {
      text: message.parts
        .filter((part): part is TextUIPart => part.type === "text")
        .map((part) => part.text)
        .join(""),
    };
    if (threadId) body.threadId = threadId;
    return body;
  }
  return { text: "" };
}

/**
 * Error code → i18n key (contract section 4). Stream failures deliver only
 * the AssistantErrorCode as the error text; out-of-stream JSON errors use
 * the snake_case codes. `"network"` (see assistantErrorFromChatError) uses
 * the network note; unknown codes and `ASSISTANT_STREAM_FAILED` /
 * `assistant_unavailable` fall back to the generic failure note.
 */
export function assistantErrorMessageKey(code: string | null | undefined): AssistantErrorKey {
  switch (code) {
    case "ASSISTANT_TURN_INCOMPLETE":
      return "assistant.errorIncomplete";
    case "ASSISTANT_TURN_TIMEOUT":
      return "assistant.errorTimeout";
    case "assistant_rate_limited":
      return "assistant.errorRateLimited";
    case "assistant_requires_pro":
      return "assistant.requiresPro";
    case "byok_error":
      return "byok.errorGeneric";
    case "insufficient_ai_credits":
      return "assistant.errorNoCredits";
    case "network":
      return "assistant.errorNetwork";
    default:
      return "assistant.errorFailed";
  }
}

export type AssistantProposalErrorKey =
  | "assistant.errorFailed"
  | "assistant.errorNetwork"
  | "assistant.proposalExpired"
  | "assistant.proposalFailed"
  | "assistant.proposalStale"
  | "assistant.proposalUnknownOutcome"
  | "assistant.requiresPro"
  | "assistant.undoFailed"
  | "assistant.undoStale";

/**
 * Proposal code → i18n key (contract sections 3 and 4.1). Covers both the
 * `errorCode` of a stored proposal and the `code` of a proposal action
 * answer; `"network"` uses the network note. The remaining conflict codes
 * (`proposal_not_pending`, `proposal_in_progress`, `undo_unavailable`) are
 * normally replaced by the refetched state; they, `proposal_not_found`,
 * `assistant_unavailable` and unknown codes fall back to the generic note.
 */
export function assistantProposalErrorKey(code: string | null | undefined): AssistantProposalErrorKey {
  switch (code) {
    case "proposal_stale":
      return "assistant.proposalStale";
    case "proposal_failed":
      return "assistant.proposalFailed";
    case "proposal_unknown_outcome":
      return "assistant.proposalUnknownOutcome";
    case "undo_stale":
      return "assistant.undoStale";
    case "undo_failed":
      return "assistant.undoFailed";
    case "proposal_expired":
      return "assistant.proposalExpired";
    case "assistant_requires_pro":
      return "assistant.requiresPro";
    case "network":
      return "assistant.errorNetwork";
    default:
      return "assistant.errorFailed";
  }
}

/**
 * Classify a chat error before mapping it to an i18n key. In-stream
 * failures arrive as `{ type: "error", errorText }` parts and the Chat
 * delivers them as `new Error(errorText)`, so an AssistantErrorCode that is
 * the whole message names the contract error; the transport turns a
 * non-2xx answer into an APICallError whose message is the raw response
 * body, so a string `code` in that JSON body names the contract error; a
 * fetch rejection is a network failure; anything else is unknown. Only
 * these values are returned, never the raw error text.
 */
const STREAM_ERROR_CODES = new Set([
  "ASSISTANT_STREAM_FAILED",
  "ASSISTANT_TURN_INCOMPLETE",
  "ASSISTANT_TURN_TIMEOUT",
  // F5/S3: the BYOK failure of a turn: the fatal part carries the caller's
  // code, after the data-byok-error part that explains the cause.
  "byok_error",
]);

export function assistantErrorFromChatError(error: Error): string {
  if (STREAM_ERROR_CODES.has(error.message)) return error.message;
  const code = readErrorBodyCode(error.message);
  if (code !== null) return code;
  if (isAssistantNetworkError(error)) return "network";
  return "unknown";
}

/**
 * The balance and the price of a turn refused for lack of credits (F4
 * contract §2: 402 `insufficient_ai_credits` with `aiCredits.balance` and
 * `creditsRequired`), read from the JSON body the transport puts in the
 * error message; null for any other error or a malformed body.
 */
export function assistantCreditsFromChatError(error: Error): { balance: number; required: number } | null {
  try {
    const body: unknown = JSON.parse(error.message);
    if (!isRecord(body) || body.code !== "insufficient_ai_credits" || !isRecord(body.aiCredits)) return null;
    const balance = body.aiCredits.balance;
    const required = body.creditsRequired;
    if (typeof balance !== "number" || !Number.isInteger(balance) || balance < 0) return null;
    if (typeof required !== "number" || !Number.isInteger(required) || required <= 0) return null;
    return { balance, required };
  } catch {
    return null;
  }
}

function readErrorBodyCode(message: string): string | null {
  try {
    const body: unknown = JSON.parse(message);
    if (isRecord(body) && typeof body.code === "string" && body.code !== "") {
      return body.code;
    }
  } catch {
    // Not a JSON body: the message does not carry an API answer code.
  }
  return null;
}

/**
 * The byok_error of a pre-stream JSON answer (the 429 concurrency cap, F5
 * contract §5): the cause and the Retry-After, read from the body the
 * transport puts in the error message; null for any other error or a body
 * without a cause. The mid-stream cause rides the `data-byok-error` part
 * instead (assistant-conversation reads it).
 */
export function assistantByokErrorFromChatError(error: Error): AssistantByokErrorInfo | null {
  try {
    const body: unknown = JSON.parse(error.message);
    if (!isRecord(body) || body.code !== "byok_error" || typeof body.cause !== "string" || body.cause === "") {
      return null;
    }
    const retryAfter = typeof body.retryAfter === "number" && Number.isFinite(body.retryAfter) && body.retryAfter > 0
      ? body.retryAfter
      : null;
    return {
      canUseCredits: typeof body.canUseCredits === "boolean" ? body.canUseCredits : true,
      cause: body.cause,
      retryAfter,
    };
  } catch {
    return null;
  }
}

function isAssistantNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase();
  if (error instanceof TypeError) {
    // Node/Chromium "fetch failed"; Firefox "NetworkError when attempting
    // to fetch resource."; Safari "load failed".
    return message.includes("fetch") || message.includes("network") || message === "load failed";
  }
  return message === "fetch failed" || message === "failed to fetch" || message === "networkerror";
}

/**
 * Stored messages → UI messages. A message with `status: "error"` becomes an
 * assistant message without text and with `{ errorCode }` metadata, so the
 * panel renders the translated error note and the retry action. The stored
 * `ask` and the thread proposals become the same `data-ask` and
 * `data-proposal` parts the turn stream delivers, so a reopened conversation
 * renders like a streamed one: each proposal goes under the message with
 * its `messageId` (a proposal without one is not shown).
 */
export function threadMessagesToUiMessages(
  messages: readonly AssistantMessage[],
  proposals: readonly AssistantPublicProposal[],
): AssistantUIMessage[] {
  return messages.map((message) => {
    const proposalParts: AssistantUIMessage["parts"] = message.role === "assistant"
      ? proposals
        .filter((proposal) => proposal.messageId === message.id)
        .map((proposal) => ({ data: proposal, type: "data-proposal" }))
      : [];
    if (message.status === "error") {
      return {
        id: message.id,
        metadata: { errorCode: message.errorCode ?? undefined },
        parts: proposalParts,
        role: "assistant",
      };
    }
    const parts: AssistantUIMessage["parts"] = [{ text: message.text, type: "text" }];
    if (message.role === "assistant" && message.ask !== null) {
      parts.push({ data: message.ask, type: "data-ask" });
    }
    parts.push(...proposalParts);
    return { id: message.id, parts, role: message.role };
  });
}

/**
 * The proposals of a message, from its `data-proposal` parts: invalid data is
 * skipped and a later part for the same id replaces the earlier one, in the
 * order the ids first appeared.
 */
export function assistantMessageProposals(message: AssistantUIMessage): AssistantPublicProposal[] {
  const byId = new Map<string, AssistantPublicProposal>();
  for (const part of message.parts) {
    if (part.type !== "data-proposal" || !("data" in part)) continue;
    if (isAssistantPublicProposal(part.data)) byId.set(part.data.id, part.data);
  }
  return [...byId.values()];
}

/** The question of a message, from its last valid `data-ask` part. */
export function assistantMessageAsk(message: AssistantUIMessage): AssistantAsk | null {
  let ask: AssistantAsk | null = null;
  for (const part of message.parts) {
    if (part.type !== "data-ask" || !("data" in part)) continue;
    if (isAssistantAsk(part.data)) ask = part.data;
  }
  return ask;
}
