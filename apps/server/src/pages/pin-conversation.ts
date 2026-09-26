import type { AgentExecution, PinComment } from "@pinar/shared";

export interface PinConversationMessage {
  at: string;
  author: string;
  id: string;
  kind: "agent" | "human" | "pin";
  text: string;
}

export function cardShowsConcluded(status?: string) {
  return status === "accepted";
}

function agentText(summary: string, reason?: string) {
  const detail = reason?.trim();
  if (!detail || detail === summary) return summary;
  return `${summary}\n${detail}`;
}

export function pinConversation({
  agentExecutions,
  captureCreatedAt,
  captureId,
  comments,
  pin,
  pinAuthor,
}: {
  agentExecutions: AgentExecution[];
  captureCreatedAt: string;
  captureId: string;
  comments: PinComment[];
  pin: { comment?: string; id?: string; pinId?: string };
  pinAuthor: string;
}): PinConversationMessage[] {
  const pinId = pin.pinId || pin.id || "";
  const messages: PinConversationMessage[] = [];
  const original = pin.comment?.trim();
  if (original) {
    messages.push({
      at: captureCreatedAt,
      author: pinAuthor,
      id: `pin:${pinId || "current"}`,
      kind: "pin",
      text: original,
    });
  }
  const later: PinConversationMessage[] = [];
  for (const comment of comments) {
    if (comment.captureId !== captureId || comment.pinId !== pinId) continue;
    later.push({
      at: comment.createdAt,
      author: comment.actorLabel,
      id: comment.id,
      kind: "human",
      text: comment.body,
    });
  }
  const seenExecutions = new Set<string>();
  for (const execution of agentExecutions) {
    if (execution.captureId !== captureId || seenExecutions.has(execution.id)) continue;
    const result = execution.results.find((item) => item.pinId === pinId);
    if (!result) continue;
    seenExecutions.add(execution.id);
    later.push({
      at: result.createdAt || execution.createdAt || "",
      author: execution.agent,
      id: `execution:${execution.id}`,
      kind: "agent",
      text: agentText(result.summary, result.reason),
    });
  }
  later.sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id));
  return [...messages, ...later];
}
