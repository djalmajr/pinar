// Assistant turn runtime: history window, outcome classification and the
// streamed turn itself.
//
// runAssistantTurn runs streamText over the caller-supplied model and
// exposes the result two ways at once:
// - `response`: an AI SDK UI message stream (createUIMessageStreamResponse)
//   whose first part is { type: "data-thread", data: { id, title } };
// - `outcome`: a promise that always settles, even if the client cancels
//   the response body (a consumeStream over a second tee branch keeps the
//   model call running to the end).
//
// Errors the client sees in the stream are only the AssistantErrorCode;
// nothing from the provider (URLs, keys, messages) crosses the boundary.
// There is deliberately no console.* with provider content in this module.

import {
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type FinishReason,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import type { ProviderOptions } from "./models";

export type AssistantErrorCode =
  | "ASSISTANT_TURN_TIMEOUT"
  | "ASSISTANT_STREAM_FAILED"
  | "ASSISTANT_TURN_INCOMPLETE";

export interface AssistantHistoryEntry {
  role: "user" | "assistant";
  text: string;
}

export const ASSISTANT_WINDOW_MESSAGES = 12;
export const ASSISTANT_WINDOW_CHARS = 24_000;

// Keeps the most recent messages within both limits. The window always ends
// on the last message (the new question), which always enters, and starts
// on a "user" message.
export function buildTurnWindow(history: AssistantHistoryEntry[]): AssistantHistoryEntry[] {
  const total = history.length;
  if (total === 0) return [];
  let start = total - 1;
  let count = 1;
  let chars = history[total - 1].text.length;
  for (let index = total - 2; index >= 0; index--) {
    const entry = history[index];
    if (count >= ASSISTANT_WINDOW_MESSAGES) break;
    if (chars + entry.text.length > ASSISTANT_WINDOW_CHARS) break;
    start = index;
    count += 1;
    chars += entry.text.length;
  }
  while (start < total - 1 && history[start].role !== "user") {
    start += 1;
  }
  return history.slice(start, total);
}

export const ASSISTANT_MAX_STEPS = 8;
export const ASSISTANT_TURN_TIMEOUT_MS = 60_000;

export interface AssistantTurnUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type AssistantTurnOutcome =
  | { kind: "final"; steps: number; text: string; usage: AssistantTurnUsage }
  | { code: AssistantErrorCode; kind: "error"; steps: number; usage: AssistantTurnUsage };

export interface AssistantTurnInput {
  abortSignal?: AbortSignal;
  history: AssistantHistoryEntry[];
  maxSteps?: number;
  model: LanguageModel;
  providerOptions?: ProviderOptions;
  system: string;
  thread: { id: string; title: string };
  timeoutMs?: number;
  tools: ToolSet;
}

const ZERO_USAGE: AssistantTurnUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

// A "final" answer that is only a wait notice ("Vou consultar…") is not a
// final: it must stay under 200 characters AND match the notice pattern.
const WAIT_NOTICE_MAX_CHARS = 200;
const WAIT_NOTICE_PATTERN = /^(vou|deixa eu|deixe-me|um momento|aguarde|let me|one moment|i['’]ll (check|look))/i;

export function isWaitingNotice(text: string): boolean {
  return text.length < WAIT_NOTICE_MAX_CHARS && WAIT_NOTICE_PATTERN.test(text);
}

// Decides between `final` and ASSISTANT_TURN_INCOMPLETE. Final requires:
// the last step finished with finishReason "stop", the trimmed text is not
// empty, and the text is not only a wait notice. Hitting the step cap
// (finishReason "tool-calls"), other finish reasons and empty text all give
// ASSISTANT_TURN_INCOMPLETE.
export function classifyTurnOutcome(input: {
  finishReason: FinishReason;
  steps: number;
  text: string;
  usage: AssistantTurnUsage;
}): AssistantTurnOutcome {
  const text = input.text.trim();
  if (input.finishReason === "stop" && text.length > 0 && !isWaitingNotice(text)) {
    return { kind: "final", steps: input.steps, text, usage: input.usage };
  }
  return { code: "ASSISTANT_TURN_INCOMPLETE", kind: "error", steps: input.steps, usage: input.usage };
}

function toAssistantUsage(usage: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
}): AssistantTurnUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
  };
}

export function runAssistantTurn(input: AssistantTurnInput): {
  outcome: Promise<AssistantTurnOutcome>;
  response: Response;
} {
  const maxSteps = input.maxSteps ?? ASSISTANT_MAX_STEPS;
  const timeoutMs = input.timeoutMs ?? ASSISTANT_TURN_TIMEOUT_MS;

  // Combined abort signal: the caller's signal plus the turn timeout. The
  // timeout error is the marker that turns a failed turn into
  // ASSISTANT_TURN_TIMEOUT; the caller's abort is cleared from the timer so
  // it never re-classifies a late failure as a timeout.
  const controller = new AbortController();
  let timedOut = false;
  const timeoutError = new Error("assistant turn timeout");
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(timeoutError);
  }, timeoutMs);
  const onCallerAbort = () => {
    clearTimeout(timer);
    controller.abort(input.abortSignal?.reason);
  };
  if (input.abortSignal?.aborted) {
    onCallerAbort();
  } else {
    input.abortSignal?.addEventListener("abort", onCallerAbort, { once: true });
  }

  const errorCodeFor = (): AssistantErrorCode =>
    timedOut ? "ASSISTANT_TURN_TIMEOUT" : "ASSISTANT_STREAM_FAILED";

  const window = buildTurnWindow(input.history);
  // Each window entry becomes one model message; the discriminated union is
  // preserved so the array is a ModelMessage[].
  const messages: ModelMessage[] = window.map((entry) =>
    entry.role === "user"
      ? { content: entry.text, role: "user" }
      : { content: entry.text, role: "assistant" },
  );
  const result = streamText({
    abortSignal: controller.signal,
    maxRetries: 0,
    messages,
    model: input.model,
    providerOptions: input.providerOptions,
    stopWhen: stepCountIs(maxSteps),
    system: input.system,
    tools: input.tools,
  });

  const response = createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ data: { id: input.thread.id, title: input.thread.title }, type: "data-thread" });
        writer.merge(
          toUIMessageStream({
            onError: () => errorCodeFor(),
            sendReasoning: false,
            stream: result.stream,
            tools: input.tools,
          }),
        );
      },
      // Stream-level failures surface as a part whose errorText is only
      // the AssistantErrorCode; the provider error never leaks.
      onError: () => errorCodeFor(),
    }),
  });

  // Keep the turn running to the end even if the client cancels the
  // response body: a standalone consumeStream over its own tee branch
  // always drains the model call, so the outcome promises always settle.
  void consumeStream({ onError: () => {}, stream: result.stream });

  const outcome = (async (): Promise<AssistantTurnOutcome> => {
    try {
      const [text, finishReason, usage, steps] = await Promise.all([
        result.text,
        result.finishReason,
        result.usage,
        result.steps,
      ]);
      return classifyTurnOutcome({
        finishReason,
        steps: steps.length,
        text,
        usage: toAssistantUsage(usage),
      });
    } catch {
      return { code: errorCodeFor(), kind: "error", steps: 0, usage: ZERO_USAGE };
    } finally {
      clearTimeout(timer);
      input.abortSignal?.removeEventListener("abort", onCallerAbort);
    }
  })();

  return { outcome, response };
}
