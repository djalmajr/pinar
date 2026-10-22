import type { AssistantTurnTimeoutPhase } from "../../lib/assistant-turn-terminal";

export const ASSISTANT_TURN_INACTIVITY_MS = 60_000;
export const ASSISTANT_TURN_ATTEMPT_MAX_MS = 180_000;
export const ASSISTANT_TURN_TOTAL_MAX_MS = 240_000;

// The useful minimum to start a fallback link: with less than that left of
// the turn's budget the next link cannot finish even a short answer (the
// first chunk takes seconds, a read takes one more step), and half the
// inactivity window covers that short path.
export const ASSISTANT_TURN_MIN_FALLBACK_MS = 30_000;

export interface AssistantTurnClock {
  clearTimeout(handle: unknown): void;
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
}

export const systemTurnClock: AssistantTurnClock = {
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
};

export class AssistantTurnTimeoutError extends Error {
  readonly phase: AssistantTurnTimeoutPhase;
  constructor(phase: AssistantTurnTimeoutPhase = "turn") {
    super("assistant turn timeout");
    this.name = "AssistantTurnTimeoutError";
    this.phase = phase;
  }
}

/**
 * The turn's 240 s budget, created on entry (the start of the HTTP request).
 * The signal aborts at the deadline: the awaits before the model race it
 * (withinAssistantTurnBudget), so a hung wait before the stream ends with
 * the `turn` timeout instead of holding the request open; a write a later
 * turn would see never races it (afterAssistantTurnWrite). `dispose` disarms
 * the timer when whoever created the budget is done with it.
 */
export interface AssistantTurnBudget {
  clock: AssistantTurnClock;
  deadlineAt: number;
  dispose(): void;
  // Progress seen where the turn cannot see it (the chain holds a link's
  // parts until it commits): it rearms the turn's inactivity clock.
  markProgress(): void;
  // The chain started another model (a fallback link): the turn rearms the
  // attempt's cap for it, so one model's cap never cuts the next one.
  markAttempt(): void;
  onAttempt(listener: () => void): () => void;
  onProgress(listener: () => void): () => void;
  remainingMs(): number;
  signal: AbortSignal;
}

export function createAssistantTurnBudget(
  clock: AssistantTurnClock = systemTurnClock,
  totalMs: number = ASSISTANT_TURN_TOTAL_MAX_MS,
): AssistantTurnBudget {
  const deadlineAt = clock.now() + totalMs;
  const controller = new AbortController();
  let handle: unknown = null;
  if (totalMs <= 0) controller.abort(new AssistantTurnTimeoutError("turn"));
  else handle = clock.setTimeout(() => controller.abort(new AssistantTurnTimeoutError("turn")), totalMs);
  const listeners = new Set<() => void>();
  const attemptListeners = new Set<() => void>();
  return {
    clock,
    deadlineAt,
    dispose: () => {
      if (handle !== null) clock.clearTimeout(handle);
      handle = null;
    },
    markAttempt: () => {
      for (const listener of attemptListeners) listener();
    },
    markProgress: () => {
      for (const listener of listeners) listener();
    },
    onAttempt: (listener) => {
      attemptListeners.add(listener);
      return () => attemptListeners.delete(listener);
    },
    onProgress: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    remainingMs: () => Math.max(0, deadlineAt - clock.now()),
    signal: controller.signal,
  };
}

/**
 * Runs `work` against the turn's budget: with the budget already spent
 * nothing starts; when it runs out while `work` is pending, the promise
 * rejects at once with the `turn` timeout. A late effect of `work` belongs
 * to the caller (it settles it through `onLate`).
 */
export function withinAssistantTurnBudget<T>(
  budget: AssistantTurnBudget,
  work: () => Promise<T>,
  onLate?: (value: T) => void,
): Promise<T> {
  if (budget.signal.aborted) return Promise.reject(new AssistantTurnTimeoutError("turn"));
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const onAbort = () => {
      if (done) return;
      done = true;
      reject(new AssistantTurnTimeoutError("turn"));
    };
    budget.signal.addEventListener("abort", onAbort, { once: true });
    work().then(
      (value) => {
        budget.signal.removeEventListener("abort", onAbort);
        if (done) {
          onLate?.(value);
          return;
        }
        done = true;
        resolve(value);
      },
      (error: unknown) => {
        budget.signal.removeEventListener("abort", onAbort);
        if (done) return;
        done = true;
        reject(error);
      },
    );
  });
}

/**
 * Runs a write a later turn would see (the thread, the user's question)
 * without racing the turn's budget: the turn waits for it to settle, with
 * success or an error, and only then reads the budget. With the budget
 * spent by then it rejects with the `turn` timeout (an error of the write
 * included), so the caller answers 504 and frees what it holds only once
 * nothing of the write is still pending. With the budget already spent the
 * write never starts. A hung write holds the turn (and its thread) for as
 * long as it hangs: no 504 leaves before it.
 */
export async function afterAssistantTurnWrite<T>(budget: AssistantTurnBudget, work: () => Promise<T>): Promise<T> {
  if (budget.signal.aborted) throw new AssistantTurnTimeoutError("turn");
  let value: T;
  try {
    value = await work();
  } catch (error) {
    if (budget.signal.aborted) throw new AssistantTurnTimeoutError("turn");
    throw error;
  }
  if (budget.signal.aborted) throw new AssistantTurnTimeoutError("turn");
  return value;
}
