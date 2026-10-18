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
// Tools may write their own data parts (data-proposal, data-ask) through
// the `emit` the turn hands to a `tools` function: it writes to the same
// UI message stream writer, after the data-thread part. A pinar_ask call
// ends the loop on its step, and a valid one makes the outcome `final`
// with the question as the text.
//
// Errors the client sees in the stream are only the AssistantErrorCode;
// nothing from the provider (URLs, keys, messages) crosses the boundary.
// There is deliberately no console.* with provider content in this module.

import {
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  hasToolCall,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type FinishReason,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  type UIMessageStreamWriter,
} from "ai";
import { assistantTurnBilling } from "./chain";
import { ASSISTANT_ASK_TOOL, assistantAskFrom } from "./extra-tools";
import type { ProviderOptions } from "./models";
import type { AssistantPublicProposal } from "./proposals";
import { toLlmToolName } from "./tool-policy";

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

// The error the turn's own deadline raises when it aborts the call (F5/S3
// review F3): it is a timeout the caller may classify (the BYOK cause),
// while the caller's abort is a cancellation and is never a timeout. The
// class, not a message, is how the caller recognizes it.
export class AssistantTurnTimeoutError extends Error {
  constructor() {
    super("assistant turn timeout");
    this.name = "AssistantTurnTimeoutError";
  }
}

export interface AssistantTurnUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// What the turn cost and who answered (F4 contract §1), shared with the
// credits (S2). Set when the turn's steps went through the model chain
// (chain.ts assistantTurnBilling); the local app has none.
export interface AssistantTurnBilling {
  costSource: "gateway" | "table" | "appliance" | "none";
  costUsdMicros: number | null;
  fallback: boolean; // answered by a link after the first
  link: number; // index of the link that answered (0 = first)
  model: string; // "hub:model" of the link that answered
  usage: AssistantTurnUsage;
}

type AssistantAsk = { options: string[]; question: string };

export type AssistantStreamEmit = (part:
  | { data: AssistantPublicProposal; type: "data-proposal" }
  | { data: { options: string[]; question: string }; type: "data-ask" }
  | { data: Record<string, unknown>; type: `data-${string}` }) => void;

// What the stream's error part carries when the caller classifies it
// (the BYOK cause, F5/S3): the error code and one data part with the
// details, written before the error part.
export interface AssistantTurnStreamError {
  code: string;
  part?: { data: Record<string, unknown>; type: `data-${string}` };
}

// The plan's outcomes map onto two kinds: final (ask null), intentional
// stop (final with the pinar_ask question) and missing final (error
// ASSISTANT_TURN_INCOMPLETE). Each carries `billing` when the steps that
// ran report it.
export type AssistantTurnOutcome =
  | { ask: AssistantAsk | null; billing?: AssistantTurnBilling; kind: "final"; steps: number; text: string; usage: AssistantTurnUsage }
  | { billing?: AssistantTurnBilling; code: AssistantErrorCode; kind: "error"; steps: number; usage: AssistantTurnUsage };

export interface AssistantTurnInput {
  abortSignal?: AbortSignal;
  // F5/S3: the origin of the turn (the user's BYOK endpoint or Pinar's own),
  // recorded in the turn's first data part for the UI.
  source?: "byok" | "pinar";
  history: AssistantHistoryEntry[];
  maxSteps?: number;
  model: LanguageModel;
  providerOptions?: ProviderOptions;
  system: string;
  thread: { id: string; title: string };
  timeoutMs?: number;
  tools: ToolSet | ((emit: AssistantStreamEmit) => ToolSet);
  // The stream's error part: the AssistantErrorCode by default, or the
  // caller's classification (F5/S3: the BYOK cause and its data part).
  onStreamError?: (error: unknown) => AssistantTurnStreamError | undefined;
}

const ASK_TOOL_NAME = toLlmToolName(ASSISTANT_ASK_TOOL.name);

const ZERO_USAGE: AssistantTurnUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

// A "final" answer that is only a wait notice ("Vou consultar…") is not a
// final: it must stay under 200 characters AND match the notice pattern.
const WAIT_NOTICE_MAX_CHARS = 200;
const WAIT_NOTICE_PATTERN = /^(vou|deixa eu|deixe-me|um momento|aguarde|let me|one moment|i['’]ll (check|look))/i;

export function isWaitingNotice(text: string): boolean {
  return text.length < WAIT_NOTICE_MAX_CHARS && WAIT_NOTICE_PATTERN.test(text);
}

// Decides between `final`, ASSISTANT_STREAM_FAILED and
// ASSISTANT_TURN_INCOMPLETE. A provider error part resolves the
// aggregates with finishReason "error" and is a stream failure: the same
// code the client receives in the SSE (a timeout abort rejects the
// aggregates, so it is classified by the caller, not here). A valid
// pinar_ask call in the last step (`ask`) is final with the question as
// the text, whatever the finish reason. Otherwise final requires: the last
// step finished with finishReason "stop", the trimmed text is not empty,
// and the text is not only a wait notice. Hitting the step cap
// (finishReason "tool-calls"), other finish reasons and empty text all
// give ASSISTANT_TURN_INCOMPLETE.
export function classifyTurnOutcome(input: {
  ask?: AssistantAsk | null;
  finishReason: FinishReason;
  steps: number;
  text: string;
  usage: AssistantTurnUsage;
}): AssistantTurnOutcome {
  if (input.finishReason === "error") {
    return { code: "ASSISTANT_STREAM_FAILED", kind: "error", steps: input.steps, usage: input.usage };
  }
  if (input.ask) {
    return { ask: input.ask, kind: "final", steps: input.steps, text: input.ask.question, usage: input.usage };
  }
  const text = input.text.trim();
  if (input.finishReason === "stop" && text.length > 0 && !isWaitingNotice(text)) {
    return { ask: null, kind: "final", steps: input.steps, text, usage: input.usage };
  }
  return { code: "ASSISTANT_TURN_INCOMPLETE", kind: "error", steps: input.steps, usage: input.usage };
}

// The question and options of a valid pinar_ask call in the step, if any.
function askOf(step: { toolCalls: ReadonlyArray<{ input: unknown; invalid?: boolean; toolName: string }> } | undefined): AssistantAsk | null {
  for (const call of step?.toolCalls ?? []) {
    if (call.toolName !== ASK_TOOL_NAME || call.invalid) continue;
    const ask = assistantAskFrom(call.input);
    if (ask) return ask;
  }
  return null;
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
  const timeoutError = new AssistantTurnTimeoutError();
  // The deadline's timer (the callback runs later, once the turn's
  // classifications below are initialized — it never runs synchronously).
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(timeoutError);
    // The deadline never reaches the SDK's onError (the stream ends with
    // its abort part): the turn's own timer writes the error part — once,
    // and only when the caller classifies it (the BYOK cause, F5/S3). The
    // transform marks the chunk when a classified fatal part actually went
    // out, so the timer skips it then; the fatal protocol goes out once.
    // The local app and the gateway keep today's abort-only answer; a
    // client abort clears the timer, so a cancellation is never a timeout.
    if (streamErrorChunkSent) return;
    const classified = classifyStreamError(timeoutError);
    if (classified === undefined) return;
    streamErrorChunkSent = true;
    writeUiPart({ errorText: classified.code, type: "error" });
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

  // The stream's error part (F5/S3): the caller's classification (the BYOK
  // cause) writes one data part with the details before the fatal error
  // part, which then carries the caller's code (byok_error). Fatality is
  // never inferred from the onError callback: the SDK calls it for the
  // model's fatal failure AND for a tool error it formats as
  // tool-input-error / tool-output-error while the turn continues (a
  // malformed JSON argument is a JSONParseError, a chain the BYOK
  // classifier recognizes — R1 recheck). Instead, onError returns a token
  // with the part, and the transform below resolves the tokens on the SSE
  // parts that actually go out: only a fatal `error` part writes the data
  // part and the caller's code (once per turn, marking the chunk); a
  // tool-error part always goes out with the default code — no data part,
  // no chunk, the turn continues. The token never reaches the client.
  let streamErrorPartSent = false;
  // The fatal error chunk, at most once: marked when the fatal part is
  // actually written — by the transform (a classified fatal part going
  // out) or by the deadline's timer (which the SDK's onError never sees).
  // The deadline skips it when the flag is already set, so the fatal
  // protocol goes out exactly once.
  let streamErrorChunkSent = false;
  let fatalTokenCounter = 0;
  const fatalTokens = new Map<string, { defaultCode: AssistantErrorCode; streamError: AssistantTurnStreamError }>();
  const streamError = (error: unknown): string => {
    const classified = input.onStreamError?.(error);
    if (classified === undefined) return errorCodeFor();
    const token = `byok:fatal:${fatalTokenCounter += 1}`;
    fatalTokens.set(token, { defaultCode: errorCodeFor(), streamError: classified });
    return token;
  };
  // The deadline's classification (the timer above): writes the data part
  // (once per turn) and returns the code for the fatal part it writes.
  const classifyStreamError = (error: unknown): { code: string } | undefined => {
    const classified = input.onStreamError?.(error);
    if (classified === undefined) return undefined;
    if (classified.part !== undefined && !streamErrorPartSent) {
      streamErrorPartSent = true;
      emit({ data: classified.part.data, type: classified.part.type });
    }
    return { code: classified.code };
  };

  // Data parts tools emit go to the UI stream writer. createUIMessageStream
  // runs `execute` synchronously below, before any tool can run; parts that
  // would arrive earlier wait for the writer and keep their order.
  let streamWriter: UIMessageStreamWriter | null = null;
  const pendingParts: Parameters<UIMessageStreamWriter["write"]>[0][] = [];
  const writeUiPart = (part: Parameters<UIMessageStreamWriter["write"]>[0]) => {
    if (streamWriter) streamWriter.write(part);
    else pendingParts.push(part);
  };
  const emit: AssistantStreamEmit = (part) => writeUiPart(part);
  const tools = typeof input.tools === "function" ? input.tools(emit) : input.tools;

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
    // The SDK's default onError logs console.error(error): with an
    // explicit no-op the provider error (secrets, URLs, messages) never
    // reaches the logs. The other SDK callbacks in use
    // (toUIMessageStream, createUIMessageStream, consumeStream) already
    // receive explicit onError callbacks, and their SDK defaults do not
    // log.
    onError: () => {},
    providerOptions: input.providerOptions,
    stopWhen: [stepCountIs(maxSteps), hasToolCall(ASK_TOOL_NAME)],
    system: input.system,
    tools,
  });

  const rawResponse = createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({
          data: {
            id: input.thread.id,
            ...(input.source !== undefined ? { source: input.source } : {}),
            title: input.thread.title,
          },
          type: "data-thread",
        });
        streamWriter = writer;
        for (const part of pendingParts.splice(0)) writer.write(part);
        writer.merge(
          toUIMessageStream({
            onError: (error) => streamError(error),
            sendReasoning: false,
            stream: result.stream,
            tools,
          }),
        );
      },
      // Stream-level failures surface as a part whose errorText is only
      // the AssistantErrorCode; the provider error never leaks.
      onError: (error) => streamError(error),
    }),
  });
  // The UI stream's fatal-part transform (F5/S3 R1 recheck): it observes
  // the SSE parts that actually go out and resolves the tokens onError
  // returned — a fatal `error` part with a token goes out with the
  // caller's code (byok_error), after the data part (once per turn),
  // marking the chunk; a tool-error part with a token always goes out with
  // the default code — no data part, no chunk. Installed only when the
  // caller classifies (the BYOK route): the local app and the gateway
  // answer with the stream as it is, their parts unchanged.
  let response: Response = rawResponse;
  if (input.onStreamError !== undefined) {
    const fatalDecoder = new TextDecoder();
    const fatalEncoder = new TextEncoder();
    let fatalLineBuffer = "";
    const rewriteFatalLine = (line: string): string | null => {
      if (!line.startsWith("data: ")) return line;
      const payload = line.slice(6);
      if (payload === "" || payload.trim() === "[DONE]") return line;
      let part: Record<string, unknown>;
      try {
        part = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        return line;
      }
      const token = part.errorText;
      if (typeof token !== "string") return line;
      const entry = fatalTokens.get(token);
      if (entry === undefined) return line;
      fatalTokens.delete(token);
      if (part.type === "error") {
        // The fatal protocol already went out (the deadline's timer):
        // the duplicate goes nowhere.
        if (streamErrorChunkSent) return null;
        streamErrorChunkSent = true;
        let out = "";
        if (entry.streamError.part !== undefined && !streamErrorPartSent) {
          streamErrorPartSent = true;
          // Its own SSE event: the blank line ends it before the error.
          out += `data: ${JSON.stringify(entry.streamError.part)}\n\n`;
        }
        return `${out}data: ${JSON.stringify({ errorText: entry.streamError.code, type: "error" })}`;
      }
      // tool-input-error / tool-output-error (and any other part the SDK
      // formats with the code): the default code, no BYOK data part, no
      // chunk — the turn continues.
      part.errorText = entry.defaultCode;
      return `data: ${JSON.stringify(part)}`;
    };
    const fatalTransform = new TransformStream<Uint8Array, Uint8Array>({
      flush(controller) {
        // A truncated final line is not a complete part (the stream ends
        // with [DONE]); it passes through as it is.
        fatalLineBuffer += fatalDecoder.decode();
        if (fatalLineBuffer !== "") controller.enqueue(fatalEncoder.encode(fatalLineBuffer));
      },
      transform(chunk, controller) {
        fatalLineBuffer += fatalDecoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = fatalLineBuffer.indexOf("\n")) !== -1) {
          const line = fatalLineBuffer.slice(0, newline);
          fatalLineBuffer = fatalLineBuffer.slice(newline + 1);
          const rewritten = rewriteFatalLine(line);
          if (rewritten !== null) controller.enqueue(fatalEncoder.encode(`${rewritten}\n`));
        }
      },
    });
    if (rawResponse.body !== null) response = new Response(rawResponse.body.pipeThrough(fatalTransform), rawResponse);
  }

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
      const turnUsage = toAssistantUsage(usage);
      const outcome = classifyTurnOutcome({
        ask: askOf(steps.at(-1)),
        finishReason,
        steps: steps.length,
        text,
        usage: turnUsage,
      });
      const billing = assistantTurnBilling(steps, turnUsage);
      return billing ? { ...outcome, billing } : outcome;
    } catch {
      return { code: errorCodeFor(), kind: "error", steps: 0, usage: ZERO_USAGE };
    } finally {
      clearTimeout(timer);
      input.abortSignal?.removeEventListener("abort", onCallerAbort);
    }
  })();

  return { outcome, response };
}
