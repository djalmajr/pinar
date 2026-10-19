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
// The deadlines are deadline.ts's: 60 s of inactivity, the 180 s attempt
// cap and the turn's 240 s budget. A failed turn ends its stream with one
// typed final error part (lib/assistant-turn-terminal.ts: the
// AssistantErrorCode, the phase and retryable), or with the caller's
// classification (the BYOK cause); nothing from the provider (URLs, keys,
// messages) crosses the boundary. There is deliberately no console.* with
// provider content in this module.

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
import {
  encodeAssistantTurnTerminal,
  type AssistantErrorCode,
  type AssistantTurnPhase,
  type AssistantTurnTimeoutPhase,
} from "../../lib/assistant-turn-terminal";
import { assistantTurnBilling } from "./chain";
import {
  ASSISTANT_TURN_ATTEMPT_MAX_MS,
  ASSISTANT_TURN_INACTIVITY_MS,
  ASSISTANT_TURN_TOTAL_MAX_MS,
  AssistantTurnTimeoutError,
  createAssistantTurnBudget,
  systemTurnClock,
  type AssistantTurnBudget,
  type AssistantTurnClock,
} from "./deadline";
import { ASSISTANT_ASK_TOOL, assistantAskFrom } from "./extra-tools";
import type { ProviderOptions } from "./models";
import type { AssistantPublicProposal } from "./proposals";
import { toLlmToolName } from "./tool-policy";

export type { AssistantErrorCode } from "../../lib/assistant-turn-terminal";
export { AssistantTurnTimeoutError } from "./deadline";

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
// The inactivity window (deadline.ts); vision.ts reads it at load time as
// its own call's ceiling.
export const ASSISTANT_TURN_TIMEOUT_MS = ASSISTANT_TURN_INACTIVITY_MS;

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
  // The turn's 240 s budget, created when the request entered (http.ts);
  // without it the turn creates its own when it starts.
  budget?: AssistantTurnBudget;
  // The deadlines' clock (tests); the system clock by default.
  clock?: AssistantTurnClock;
  // F5/S3: the origin of the turn (the user's BYOK endpoint or Pinar's own),
  // recorded in the turn's first data part for the UI.
  source?: "byok" | "pinar";
  history: AssistantHistoryEntry[];
  maxSteps?: number;
  model: LanguageModel;
  providerOptions?: ProviderOptions;
  system: string;
  thread: { id: string; title: string };
  // Caps every deadline (inactivity, attempt and the budget the turn
  // creates) at this value: a test seam, the production limits are
  // deadline.ts's.
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

// The deadline in an error's cause chain (the chain refuses a fallback the
// budget cannot hold with the `turn` timeout; the SDK may wrap it).
function turnTimeoutOf(error: unknown): AssistantTurnTimeoutError | null {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof AssistantTurnTimeoutError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export function runAssistantTurn(input: AssistantTurnInput): {
  outcome: Promise<AssistantTurnOutcome>;
  response: Response;
} {
  const maxSteps = input.maxSteps ?? ASSISTANT_MAX_STEPS;
  const clock = input.budget?.clock ?? input.clock ?? systemTurnClock;
  const capped = (limit: number) => (input.timeoutMs === undefined ? limit : Math.min(limit, input.timeoutMs));
  const inactivityMs = capped(ASSISTANT_TURN_INACTIVITY_MS);
  const attemptMaxMs = capped(ASSISTANT_TURN_ATTEMPT_MAX_MS);
  // The request's budget (http.ts), or the turn's own, which it disposes.
  const ownBudget = input.budget === undefined ? createAssistantTurnBudget(clock, capped(ASSISTANT_TURN_TOTAL_MAX_MS)) : null;
  const budget = input.budget ?? ownBudget!;

  // The deadlines (deadline.ts), on one abort signal with the caller's.
  // The first limit that runs out aborts the call with an
  // AssistantTurnTimeoutError carrying its phase, the marker that turns a
  // failed turn into ASSISTANT_TURN_TIMEOUT. The caller's abort stops every
  // timer, so a cancellation is never a timeout. The timer callbacks run
  // later, once the turn below is initialized — never synchronously.
  const controller = new AbortController();
  let timeoutPhase: AssistantTurnTimeoutPhase | null = null;
  let timersStopped = false;
  let toolsInFlight = 0;
  let inactivityHandle: unknown = null;
  const clearInactivity = () => {
    if (inactivityHandle !== null) clock.clearTimeout(inactivityHandle);
    inactivityHandle = null;
  };
  // Inactivity: rearmed by every stream part (raw provider chunks included)
  // and by the chain's held parts (budget.markProgress); paused while a
  // tool runs, which stays under the attempt cap and the budget.
  const armInactivity = () => {
    clearInactivity();
    if (timersStopped || toolsInFlight > 0) return;
    inactivityHandle = clock.setTimeout(() => fireTimeout("inactivity"), inactivityMs);
  };
  // The attempt's cap: 180 s, or what is left of the turn's budget when
  // that is less (then the phase is the turn's).
  const turnRemainingMs = budget.remainingMs();
  const capHandle = clock.setTimeout(
    () => fireTimeout(turnRemainingMs <= attemptMaxMs ? "turn" : "attempt"),
    Math.min(attemptMaxMs, turnRemainingMs),
  );
  const stopTimers = () => {
    timersStopped = true;
    clearInactivity();
    clock.clearTimeout(capHandle);
  };
  const offProgress = budget.onProgress(armInactivity);
  const fireTimeout = (phase: AssistantTurnTimeoutPhase) => {
    if (timeoutPhase !== null || controller.signal.aborted) return;
    timeoutPhase = phase;
    stopTimers();
    const timeoutError = new AssistantTurnTimeoutError(phase);
    controller.abort(timeoutError);
    // The deadline never reaches the SDK's onError (the stream ends with
    // its abort part): the turn writes the final error part itself — once.
    // The transform marks the chunk when a fatal part already went out, so
    // the timer skips it then. With the caller's classification (the BYOK
    // cause, F5/S3) the part is the caller's; otherwise the typed terminal.
    if (streamErrorChunkSent) return;
    streamErrorChunkSent = true;
    const classified = classifyStreamError(timeoutError);
    writeUiPart({
      errorText: classified?.code ?? encodeAssistantTurnTerminal({ code: "ASSISTANT_TURN_TIMEOUT", phase, retryable: true }),
      type: "error",
    });
  };
  armInactivity();
  const onCallerAbort = () => {
    stopTimers();
    controller.abort(input.abortSignal?.reason);
  };
  if (input.abortSignal?.aborted) {
    onCallerAbort();
  } else {
    input.abortSignal?.addEventListener("abort", onCallerAbort, { once: true });
  }
  // A deadline seen on the error path (the chain's refused fallback): the
  // stream is already failing, so it only names the timeout.
  const noteTimeoutOf = (error: unknown) => {
    const timeout = turnTimeoutOf(error);
    if (timeout === null || timeoutPhase !== null) return;
    timeoutPhase = timeout.phase;
    stopTimers();
  };

  const errorCodeFor = (): AssistantErrorCode =>
    timeoutPhase !== null ? "ASSISTANT_TURN_TIMEOUT" : "ASSISTANT_STREAM_FAILED";
  // A timeout names its limit; any other failure says where the turn was.
  const phaseFor = (): AssistantTurnPhase => timeoutPhase ?? (toolsInFlight > 0 ? "tool" : "model");

  // The stream's error parts. Fatality is never inferred from the onError
  // callback: the SDK calls it for the model's fatal failure AND for a tool
  // error it formats as tool-input-error / tool-output-error while the turn
  // continues (a malformed JSON argument is a JSONParseError, a chain the
  // BYOK classifier recognizes — R1 recheck). Instead, onError returns a
  // token, and the transform below resolves the tokens on the SSE parts
  // that actually go out: only a fatal `error` part becomes the final error
  // (once per turn, marking the chunk) — the typed terminal, or with the
  // caller's classification (F5/S3: the BYOK cause) its data part and its
  // code (byok_error); a tool-error part always goes out with the default
  // code — no data part, no chunk, the turn continues. The token never
  // reaches the client.
  let streamErrorPartSent = false;
  // The final error chunk, at most once: marked when it is actually
  // written — by the transform (a fatal part going out), by a deadline's
  // timer (which the SDK's onError never sees) or by the missing final at
  // the end of the stream.
  let streamErrorChunkSent = false;
  let fatalTokenCounter = 0;
  const fatalTokens = new Map<string, { defaultCode: AssistantErrorCode; phase: AssistantTurnPhase; streamError: AssistantTurnStreamError | undefined }>();
  const streamError = (error: unknown): string => {
    noteTimeoutOf(error);
    const classified = input.onStreamError?.(error);
    const token = `${classified === undefined ? "turn" : "byok"}:fatal:${fatalTokenCounter += 1}`;
    fatalTokens.set(token, { defaultCode: errorCodeFor(), phase: phaseFor(), streamError: classified });
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

  // The settled outcome, for the missing final's part at the end of the
  // stream (the outcome itself is built below).
  let resolveStreamOutcome!: (outcome: AssistantTurnOutcome) => void;
  const streamOutcome = new Promise<AssistantTurnOutcome>((resolve) => {
    resolveStreamOutcome = resolve;
  });

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
    // Raw provider chunks prove progress (reasoning the SDK does not map
    // included) for the inactivity deadline; the UI stream drops them.
    includeRawChunks: true,
    maxRetries: 0,
    messages,
    model: input.model,
    onChunk: () => armInactivity(),
    // The SDK's default onError logs console.error(error): with an
    // explicit callback that only looks for the turn's deadline, the
    // provider error (secrets, URLs, messages) never reaches the logs. The
    // other SDK callbacks in use (toUIMessageStream, createUIMessageStream,
    // consumeStream) already receive explicit onError callbacks, and their
    // SDK defaults do not log.
    onError: ({ error }) => noteTimeoutOf(error),
    onToolExecutionEnd: () => {
      toolsInFlight = Math.max(0, toolsInFlight - 1);
      armInactivity();
    },
    onToolExecutionStart: () => {
      toolsInFlight += 1;
      armInactivity();
    },
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
        // A missing final ends with its own typed part, unless a final
        // error already went out (the deadline's, a fatal part).
        const settled = await streamOutcome;
        if (settled.kind === "error" && settled.code === "ASSISTANT_TURN_INCOMPLETE" && !streamErrorChunkSent) {
          streamErrorChunkSent = true;
          writer.write({
            errorText: encodeAssistantTurnTerminal({ code: "ASSISTANT_TURN_INCOMPLETE", phase: "model", retryable: true }),
            type: "error",
          });
        }
      },
      // Stream-level failures surface through the same token; the provider
      // error never leaks.
      onError: (error) => streamError(error),
    }),
  });
  // The UI stream's fatal-part transform (F5/S3 R1 recheck): it observes
  // the SSE parts that actually go out and resolves the tokens onError
  // returned — a fatal `error` part with a token goes out as the final
  // error (the typed terminal, or the caller's data part and code), once
  // per turn, marking the chunk; a tool-error part with a token always goes
  // out with the default code — no data part, no chunk.
  let response: Response = rawResponse;
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
      // The final error already went out (a deadline's timer): the
      // duplicate goes nowhere.
      if (streamErrorChunkSent) return null;
      streamErrorChunkSent = true;
      if (entry.streamError === undefined) {
        const terminal = encodeAssistantTurnTerminal({ code: entry.defaultCode, phase: entry.phase, retryable: true });
        return `data: ${JSON.stringify({ errorText: terminal, type: "error" })}`;
      }
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
      const classified = classifyTurnOutcome({
        ask: askOf(steps.at(-1)),
        finishReason,
        steps: steps.length,
        text,
        usage: turnUsage,
      });
      // A failed turn whose deadline ran out (an aggregate that resolved
      // after the abort, the chain's refused fallback) is the timeout.
      const outcome: AssistantTurnOutcome = classified.kind === "error" && timeoutPhase !== null
        ? { ...classified, code: "ASSISTANT_TURN_TIMEOUT" }
        : classified;
      const billing = assistantTurnBilling(steps, turnUsage);
      return billing ? { ...outcome, billing } : outcome;
    } catch {
      return { code: errorCodeFor(), kind: "error", steps: 0, usage: ZERO_USAGE };
    } finally {
      stopTimers();
      offProgress();
      ownBudget?.dispose();
      input.abortSignal?.removeEventListener("abort", onCallerAbort);
    }
  })();
  void outcome.then(resolveStreamOutcome);

  return { outcome, response };
}
