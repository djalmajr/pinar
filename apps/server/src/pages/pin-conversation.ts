import type { AgentExecution, PinComment } from "@pinar/shared";

export interface PinConversationMessage {
  at: string;
  author: string;
  /** Authorship id of stored comments (human or agent); absent on the note and legacy executions. */
  actorId?: string;
  /** Stored comment id; present only on real comments (human or agent), never on the note or legacy executions. */
  commentId?: string;
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
    // Real agent comments are stored comments: they keep the comment id and
    // authorship so the viewer can edit them like any other comment. Legacy
    // executions never get a commentId and are not treated as editable text.
    later.push({
      actorId: comment.actorId,
      at: comment.createdAt,
      author: comment.actorLabel,
      commentId: comment.id,
      id: comment.id,
      kind: comment.actorType === "agent" ? "agent" : "human",
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

/**
 * Viewer edit authorization for stored thread messages. Real agent comments
 * (stored comments) are editable in the local runtime, which has no login,
 * but never in the cloud, where only the human author edits. Legacy
 * executions carry no commentId and are never editable here; the original
 * note is authorized separately (canEditPins).
 */
export function canEditThreadComment(
  message: Pick<PinConversationMessage, "commentId" | "kind">,
  context: { cloud: boolean; isCommentAuthor: boolean },
): boolean {
  if (!message.commentId) return false;
  if (message.kind === "agent") return !context.cloud;
  if (!context.cloud) return true;
  return context.isCommentAuthor;
}
