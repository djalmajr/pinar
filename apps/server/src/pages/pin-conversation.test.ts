import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentExecution, PinComment } from "@pinar/shared";
import { cardShowsConcluded, pinConversation } from "./pin-conversation";

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
});
