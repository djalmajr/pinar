// The tool steps of an assistant turn, as the Skia's Trace shows them
// (skedly skia-trace.tsx and skia-message-list.tsx): one step per tool part,
// with a friendly label and never the tool name, its arguments or its output.
// The model's reasoning is never shown (the turn sends no reasoning parts).
// No React here.
import { getToolName, isToolUIPart } from "ai";
import type { ServerMessageKey } from "@/lib/i18n";
import type { AssistantUIMessage } from "./assistant-client";

export interface AssistantTraceStep {
  /** Stable per part: `${messageId}:${toolCallId}`. */
  id: string;
  label: AssistantStepLabelKey;
  status: "done" | "error" | "running";
}

export type AssistantStepLabelKey = Extract<ServerMessageKey, `assistant.step.${string}` | "assistant.working">;

// What the turn is doing while the chat works (the Skia's
// getSkiaWorkingState): null when the chat is not submitted or streaming —
// ready, error and a stopped turn —, `tool` while a tool part of the turn has
// no output yet (it wins over text: a lookup after some text still shows
// activity), `writing` once the turn has text, `thinking` before either.
export type AssistantWorkingState = "thinking" | "tool" | "writing" | null;

/** Wait without visible progress before the slow notice (the Skia's SKIA_SLOW_WORKING_MS). */
export const ASSISTANT_SLOW_WORKING_MS = 20_000;

const READ_STEP_LABELS: Readonly<Record<string, AssistantStepLabelKey>> = {
  pinar_get_batch_markdown: "assistant.step.get_batch_markdown",
  pinar_get_collection_markdown: "assistant.step.get_collection_markdown",
  pinar_get_pin: "assistant.step.get_pin",
  pinar_get_project_markdown: "assistant.step.get_project_markdown",
  pinar_get_session_markdown: "assistant.step.get_session_markdown",
  pinar_list_batches: "assistant.step.list_batches",
  pinar_list_collections: "assistant.step.list_collections",
  pinar_list_pin_comments: "assistant.step.list_pin_comments",
  pinar_list_pins: "assistant.step.list_pins",
  pinar_list_projects: "assistant.step.list_projects",
  pinar_list_sessions: "assistant.step.list_sessions",
  pinar_pins_search: "assistant.step.pins_search",
};

/**
 * The label of one tool part. Reads have their own label; a write tool
 * becomes a proposal card, so its step says it is preparing one; any other
 * tool falls back to "Consultando…". `pinar_ask` is not a step: its question
 * and options are the answer itself.
 */
export function assistantStepLabel(toolName: string): AssistantStepLabelKey | null {
  if (toolName === "pinar_ask") return null;
  const read = READ_STEP_LABELS[toolName];
  if (read !== undefined) return read;
  if (/^pinar_(?:add|conclude|create|delete|edit|finish|move|publish|rename|reopen|reorder|revoke|update)_/.test(toolName)) {
    return "assistant.step.propose";
  }
  return "assistant.working";
}

function lastUserIndex(messages: readonly Pick<AssistantUIMessage, "role">[]): number {
  return messages.findLastIndex((message) => message.role === "user");
}

/**
 * The steps of the messages of one turn, in order. A part with output is
 * done, an `output-error` part failed. A part still without output is
 * running only while the turn is live: once the turn ended (an answer, an
 * error, Stop, a reopened thread) it was interrupted and shows as not
 * completed (`ended`), never as still running.
 */
export function assistantTurnTraceSteps(
  messages: readonly AssistantUIMessage[],
  { ended = false }: { ended?: boolean } = {},
): AssistantTraceStep[] {
  const steps: AssistantTraceStep[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      const label = assistantStepLabel(getToolName(part));
      if (label === null) continue;
      const status: AssistantTraceStep["status"] =
        part.state === "output-available"
          ? "done"
          : part.state === "output-error" || part.state === "output-denied" || ended
            ? "error"
            : "running";
      steps.push({ id: `${message.id}:${part.toolCallId}`, label, status });
    }
  }
  return steps;
}

export function assistantWorkingState(
  chatStatus: string,
  messages: readonly AssistantUIMessage[],
): AssistantWorkingState {
  if (chatStatus !== "submitted" && chatStatus !== "streaming") return null;
  const turn = messages.slice(lastUserIndex(messages) + 1);
  const toolRunning = turn.some((message) =>
    message.parts.some((part) => isToolUIPart(part) && (part.state === "input-streaming" || part.state === "input-available")),
  );
  if (toolRunning) return "tool";
  const hasText = turn.some(
    (message) => message.role === "assistant" && message.parts.some((part) => part.type === "text" && part.text.trim() !== ""),
  );
  return hasText ? "writing" : "thinking";
}

/**
 * What changes when the turn shows progress: each part of the current turn,
 * its state and its text length. The slow notice restarts when it changes.
 */
export function assistantTurnProgressKey(messages: readonly AssistantUIMessage[]): string {
  return messages
    .slice(lastUserIndex(messages) + 1)
    .map((message) => {
      const parts = message.parts
        .map((part) => {
          const state = "state" in part ? String(part.state) : "";
          const size = "text" in part ? String(part.text.length) : "";
          return `${part.type}.${state}.${size}`;
        })
        .join(",");
      return `${message.id}:${parts}`;
    })
    .join("|");
}

/**
 * The collapsed "N passos" of every turn that ended, by the id of the turn's
 * last assistant message. The turn in flight is left out while the chat
 * works: its steps are on the live Trace.
 */
export function assistantCollapsedTraces(
  messages: readonly AssistantUIMessage[],
  working: boolean,
): Map<string, AssistantTraceStep[]> {
  const traces = new Map<string, AssistantTraceStep[]>();
  const starts: number[] = [];
  messages.forEach((message, index) => {
    if (message.role === "user") starts.push(index);
  });
  // Messages before the first question (none in practice) form no turn.
  for (let turn = 0; turn < starts.length; turn += 1) {
    const start = starts[turn];
    const end = turn + 1 < starts.length ? starts[turn + 1] : messages.length;
    if (turn === starts.length - 1 && working) continue;
    const steps = assistantTurnTraceSteps(messages.slice(start + 1, end), { ended: true });
    if (steps.length === 0) continue;
    for (let index = end - 1; index > start; index -= 1) {
      if (messages[index].role === "assistant") {
        traces.set(messages[index].id, steps);
        break;
      }
    }
  }
  return traces;
}

/**
 * The message that carries "Resposta interrompida" after Stop (or an
 * abort), as the Skia's stopResponse: the turn's assistant message when it
 * already has text; nothing when it only shows a proposal or a question
 * (they stay as they are); otherwise the question itself.
 */
export function assistantInterruptedMessageId(messages: readonly AssistantUIMessage[]): string | null {
  const userIndex = lastUserIndex(messages);
  if (userIndex === -1) return null;
  for (let index = messages.length - 1; index > userIndex; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    if (message.parts.some((part) => part.type === "text" && part.text.trim() !== "")) return message.id;
    if (message.parts.some((part) => part.type === "data-proposal" || part.type === "data-ask")) return null;
    break;
  }
  return messages[userIndex].id;
}

/** The timers the slow notice uses; tests inject a manual clock. */
export interface SlowFlagScheduler<Timer> {
  clearTimeout: (timer: Timer) => void;
  setTimeout: (callback: () => void, delay: number) => Timer;
}

/**
 * One wait of the slow notice: `onChange(false)` at once, then
 * `onChange(true)` after `delayMs` while it is still active. Returns the
 * cancel, run on every progress and when the wait ends. One timer per
 * wait: nothing repeats every second.
 */
export function watchSlowFlag<Timer>(
  active: boolean,
  delayMs: number,
  onChange: (slow: boolean) => void,
  scheduler: SlowFlagScheduler<Timer>,
): () => void {
  onChange(false);
  if (!active) return () => undefined;
  const timer = scheduler.setTimeout(() => onChange(true), delayMs);
  return () => scheduler.clearTimeout(timer);
}
