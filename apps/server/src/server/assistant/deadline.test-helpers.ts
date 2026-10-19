// A fake clock for the turn deadlines (deadline.ts) and a model stream the
// test feeds part by part: no test waits 60 s for real.

import type { AssistantTurnClock } from "./deadline";

export interface FakeTurnClock extends AssistantTurnClock {
  // Moves the clock forward, firing every timer due on the way, in order,
  // with the event loop settled before and after each one.
  advance(ms: number): Promise<void>;
  pending(): number;
}

// Lets the streams and promises in flight move on (a few macrotask turns).
export async function settleIo(rounds = 20): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export function fakeTurnClock(start = 1_000_000): FakeTurnClock {
  let now = start;
  let sequence = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    async advance(ms) {
      await settleIo();
      const target = now + ms;
      for (;;) {
        let nextId: number | null = null;
        let next: { at: number; callback: () => void } | null = null;
        for (const [id, timer] of timers) {
          if (timer.at > target) continue;
          if (next === null || timer.at < next.at || (timer.at === next.at && id < nextId!)) {
            nextId = id;
            next = timer;
          }
        }
        if (next === null || nextId === null) break;
        timers.delete(nextId);
        now = next.at;
        next.callback();
        await settleIo();
      }
      now = target;
      await settleIo();
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    now: () => now,
    pending: () => timers.size,
    setTimeout(callback, ms) {
      sequence += 1;
      timers.set(sequence, { at: now + Math.max(0, ms), callback });
      return sequence;
    },
  };
}

// A model stream the test writes to: each push is one v4 stream part.
export function pushableStream(): { close(): void; push(part: Record<string, unknown>): void; stream: ReadableStream<unknown> } {
  let controller!: ReadableStreamDefaultController<unknown>;
  const stream = new ReadableStream<unknown>({
    start(streamController) {
      controller = streamController;
    },
  });
  return {
    close: () => controller.close(),
    push: (part) => controller.enqueue(part),
    stream,
  };
}
