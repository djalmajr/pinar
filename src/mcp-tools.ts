import { emptyTakeMessage } from "./bundle";
import type { Handlers } from "./handlers";

export const TAKE_DESCRIPTION = [
  "Read and consume the visual feedback the user sent from the AI Feedback Chrome extension.",
  "Call this when the user says they annotated a page, left comments/pins, or asks you to address on-page feedback.",
  "Returns markdown plus local screenshot file paths. Consumes the oldest waiting send (FIFO). Call again while status queued > 0.",
].join(" ");

export const STATUS_DESCRIPTION =
  "Show whether the Chrome extension has draft pins or a sent bundle waiting.";

export const PEEK_DESCRIPTION =
  "Read the oldest waiting visual-feedback bundle without consuming it.";

export async function takeText(handlers: Handlers): Promise<string> {
  const result = await handlers.take();
  return result.waiting ? result.markdown : emptyTakeMessage();
}

export async function peekText(handlers: Handlers): Promise<string> {
  const result = await handlers.peek();
  return result.waiting ? result.markdown : emptyTakeMessage();
}

export async function statusText(handlers: Handlers): Promise<string> {
  const status = await handlers.status();
  return [
    `draftPins: ${status.draftCount}`,
    `sentWaiting: ${status.hasSent}`,
    `queued: ${status.queued}`,
    `sentPins: ${status.sentCount}`,
    `url: ${status.url || "(none)"}`,
    `title: ${status.title || "(none)"}`,
  ].join("\n");
}