// Shared terminal errors for the assistant HTTP layer, stream and panel.
export const ASSISTANT_TURN_TERMINAL_CODES = [
  "ASSISTANT_TURN_TIMEOUT",
  "ASSISTANT_TURN_INCOMPLETE",
  "ASSISTANT_STREAM_FAILED",
] as const;

export type AssistantErrorCode = (typeof ASSISTANT_TURN_TERMINAL_CODES)[number];

// Which deadline ran out (ASSISTANT_TURN_TIMEOUT): 60 s without progress,
// the 180 s cap of the model attempt, or the 240 s budget of the turn.
export type AssistantTurnTimeoutPhase = "attempt" | "inactivity" | "turn";

// A timeout names the deadline; the other codes say where the turn was: a
// tool still running, or the model.
export type AssistantTurnPhase = AssistantTurnTimeoutPhase | "model" | "tool";

const TERMINAL_PHASES: readonly AssistantTurnPhase[] = ["attempt", "inactivity", "model", "tool", "turn"];

export interface AssistantTurnTerminal {
  code: AssistantErrorCode;
  phase: AssistantTurnPhase;
  retryable: boolean;
}

export function encodeAssistantTurnTerminal(terminal: AssistantTurnTerminal): string {
  return JSON.stringify({ code: terminal.code, phase: terminal.phase, retryable: terminal.retryable });
}

function isTerminalCode(value: unknown): value is AssistantErrorCode {
  return typeof value === "string" && (ASSISTANT_TURN_TERMINAL_CODES as readonly string[]).includes(value);
}

function isTerminalPhase(value: unknown): value is AssistantTurnPhase {
  return typeof value === "string" && (TERMINAL_PHASES as readonly string[]).includes(value);
}

/**
 * The terminal event of a chat error: the in-stream errorText (the Chat
 * delivers it as `new Error(errorText)`) or the 504 body the transport puts
 * in the error message. Anything else (another JSON shape, an unknown code
 * or phase, free text) answers null and keeps the generic mapping.
 */
export function parseAssistantTurnTerminal(error: unknown): AssistantTurnTerminal | null {
  if (!(error instanceof Error)) return null;
  let body: unknown;
  try {
    body = JSON.parse(error.message);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { code, phase, retryable } = body as Record<string, unknown>;
  if (!isTerminalCode(code) || !isTerminalPhase(phase)) return null;
  return { code, phase, retryable: retryable !== false };
}
