import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentExecution, PinComment } from "@pinar/shared";
import { canEditThreadComment, cardShowsConcluded, pinConversation } from "./pin-conversation";

function comment(partial: Partial<PinComment> & Pick<PinComment, "id" | "pinId" | "body" | "createdAt">): PinComment {
  return {
    actorId: "user_1",
    actorLabel: "Ada",
    actorType: "human",
    captureId: "cap_a",
    ...partial,
  };
}

function execution(id: string, pinId: string, summary: string, createdAt: string, reason?: string): AgentExecution {
  return {
    agent: "cursor",
    captureId: "cap_a",
    createdAt,
    id,
    idempotencyKey: id,
    results: [{
      createdAt,
      files: [],
      pinId,
      reason,
      status: "changed",
      summary,
    }],
  };
}

describe("pin conversation", () => {
  test("keeps each pin's comments separate and identifies people and agents", () => {
    const comments = [
      comment({ body: "Only on pin 1", createdAt: "2026-09-25T12:00:00.000Z", id: "c1", pinId: "pin_1" }),
      comment({ body: "Only on pin 2", createdAt: "2026-09-25T12:01:00.000Z", id: "c2", pinId: "pin_2" }),
    ];
    const first = pinConversation({
      agentExecutions: [execution("exec_1", "pin_1", "Raised the contrast", "2026-09-25T12:02:00.000Z", "The label was too light")],
      captureCreatedAt: "2026-09-25T11:00:00.000Z",
      captureId: "cap_a",
      comments,
      pin: { comment: "Original note", pinId: "pin_1" },
      pinAuthor: "Pin comment",
    });
    const second = pinConversation({
      agentExecutions: [execution("exec_1", "pin_1", "Raised the contrast", "2026-09-25T12:02:00.000Z")],
      captureCreatedAt: "2026-09-25T11:00:00.000Z",
      captureId: "cap_a",
      comments,
      pin: { comment: "Second note", pinId: "pin_2" },
      pinAuthor: "Pin comment",
    });

    assert.deepEqual(first.map((item) => item.text), [
      "Original note",
      "Only on pin 1",
      "Raised the contrast\nThe label was too light",
    ]);
    assert.deepEqual(first.map((item) => item.author), ["Pin comment", "Ada", "cursor"]);
    assert.equal(first.some((item) => item.text.includes("changed")), false);
    assert.deepEqual(second.map((item) => item.text), ["Second note", "Only on pin 2"]);
  });

  test("shows one message per execution and only a concluded card badge", () => {
    const repeated = execution("exec_1", "pin_1", "Raised the contrast", "2026-09-25T12:02:00.000Z");
    const messages = pinConversation({
      agentExecutions: [repeated, { ...repeated }],
      captureCreatedAt: "2026-09-25T11:00:00.000Z",
      captureId: "cap_a",
      comments: [],
      pin: { comment: "Original note", pinId: "pin_1" },
      pinAuthor: "Pin comment",
    });
    assert.deepEqual(messages.map((item) => item.id), ["pin:pin_1", "execution:exec_1"]);
    assert.equal(cardShowsConcluded("open"), false);
    assert.equal(cardShowsConcluded("correction_ready"), false);
    assert.equal(cardShowsConcluded(undefined), false);
    assert.equal(cardShowsConcluded("accepted"), true);
  });

  test("distinguishes real agent comments from legacy executions", () => {
    const messages = pinConversation({
      agentExecutions: [execution("exec_1", "pin_1", "Raised the contrast", "2026-09-25T13:00:00.000Z")],
      captureCreatedAt: "2026-09-25T11:00:00.000Z",
      captureId: "cap_a",
      comments: [
        comment({ body: "Human remark", createdAt: "2026-09-25T12:00:00.000Z", id: "c1", pinId: "pin_1" }),
        comment({
          actorId: "agent_grok",
          actorLabel: "grok",
          actorType: "agent",
          body: "Agent remark",
          createdAt: "2026-09-25T12:30:00.000Z",
          id: "c2",
          pinId: "pin_1",
        }),
      ],
      pin: { comment: "Original note", pinId: "pin_1" },
      pinAuthor: "Pin comment",
    });
    // Real comments keep their comment id and authorship (editable);
    // the legacy execution keeps its id and is not a comment.
    assert.deepEqual(
      messages.map((item) => [item.id, item.kind, item.commentId, item.actorId, item.at]),
      [
        ["pin:pin_1", "pin", undefined, undefined, "2026-09-25T11:00:00.000Z"],
        ["c1", "human", "c1", "user_1", "2026-09-25T12:00:00.000Z"],
        ["c2", "agent", "c2", "agent_grok", "2026-09-25T12:30:00.000Z"],
        ["execution:exec_1", "agent", undefined, undefined, "2026-09-25T13:00:00.000Z"],
      ],
    );
  });

  test("edit authorization: local edits any real comment, cloud only the human author", () => {
    const note = { commentId: undefined, kind: "pin" as const };
    const human = { commentId: "c1", kind: "human" as const };
    const agent = { commentId: "c2", kind: "agent" as const };
    // Local runtime (no login): real comments (human or agent) are editable.
    assert.equal(canEditThreadComment(human, { cloud: false, isCommentAuthor: false }), true);
    assert.equal(canEditThreadComment(agent, { cloud: false, isCommentAuthor: false }), true);
    // Cloud: only the human author; agent (key) messages never, even if the
    // author flag were somehow set; executions (no commentId) never.
    assert.equal(canEditThreadComment(human, { cloud: true, isCommentAuthor: true }), true);
    assert.equal(canEditThreadComment(human, { cloud: true, isCommentAuthor: false }), false);
    assert.equal(canEditThreadComment(agent, { cloud: true, isCommentAuthor: true }), false);
    assert.equal(canEditThreadComment(agent, { cloud: true, isCommentAuthor: false }), false);
    assert.equal(canEditThreadComment(note, { cloud: true, isCommentAuthor: true }), false);
    assert.equal(canEditThreadComment(note, { cloud: false, isCommentAuthor: true }), false);
  });
});
