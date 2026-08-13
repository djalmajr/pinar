import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 17373;

export function defaultRoot(): string {
  return process.env.AI_FEEDBACK_HOME ?? join(homedir(), ".ai-feedback");
}

export function resolvePort(): number {
  const raw = process.env.AI_FEEDBACK_PORT;
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid AI_FEEDBACK_PORT: ${raw}`);
  }
  return port;
}