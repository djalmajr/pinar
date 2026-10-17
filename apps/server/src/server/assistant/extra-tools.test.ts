import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CLOUD_MCP_TOOLS } from "../mcp-tools-cloud";
import { LOCAL_MCP_TOOLS } from "../mcp-tools-local";
import {
  ASSISTANT_ASK_TOOL,
  ASSISTANT_MOVE_SESSIONS_TOOL,
  assistantAskFrom,
  assistantExtraToolProblems,
} from "./extra-tools";
import { ASSISTANT_BULK_MAX } from "./proposals";
import { ASSISTANT_TOOL_POLICY, toLlmToolName } from "./tool-policy";

describe("assistant-only tools", () => {
  test("stay outside the MCP catalogs and the policy table", () => {
    for (const def of [ASSISTANT_MOVE_SESSIONS_TOOL, ASSISTANT_ASK_TOOL]) {
      assert.ok(!LOCAL_MCP_TOOLS.some((tool) => tool.name === def.name), def.name);
      assert.ok(!CLOUD_MCP_TOOLS.some((tool) => tool.name === def.name), def.name);
      assert.ok(!Object.hasOwn(ASSISTANT_TOOL_POLICY, def.name), def.name);
    }
    assert.equal(toLlmToolName(ASSISTANT_MOVE_SESSIONS_TOOL.name), "pinar_move_sessions");
    assert.equal(toLlmToolName(ASSISTANT_ASK_TOOL.name), "pinar_ask");
  });

  test("pinar.move_sessions: collectionId plus 1..500 unique sessionIds, nothing else", () => {
    assert.deepEqual(ASSISTANT_MOVE_SESSIONS_TOOL.inputSchema, {
      additionalProperties: false,
      properties: {
        collectionId: { type: "string" },
        sessionIds: { items: { type: "string" }, maxItems: ASSISTANT_BULK_MAX, minItems: 1, type: "array", uniqueItems: true },
      },
      required: ["collectionId", "sessionIds"],
      type: "object",
    });
    assert.equal(ASSISTANT_BULK_MAX, 500);
  });

  test("pinar.ask: a 1..300 question and 2..5 options of 1..80, nothing else", () => {
    assert.deepEqual(ASSISTANT_ASK_TOOL.inputSchema, {
      additionalProperties: false,
      properties: {
        options: { items: { maxLength: 80, minLength: 1, type: "string" }, maxItems: 5, minItems: 2, type: "array" },
        question: { maxLength: 300, minLength: 1, type: "string" },
      },
      required: ["question", "options"],
      type: "object",
    });
  });

  test("descriptions are one short sentence without behavior rules", () => {
    for (const def of [ASSISTANT_MOVE_SESSIONS_TOOL, ASSISTANT_ASK_TOOL]) {
      assert.ok(def.description.length <= 80, def.description);
      assert.ok(!/\b(only|never|must|always|confirm)\b/i.test(def.description), def.description);
    }
  });

  test("assistantExtraToolProblems adds unique items and minLength to validateArgs", () => {
    assert.deepEqual(assistantExtraToolProblems(ASSISTANT_MOVE_SESSIONS_TOOL, { collectionId: "c", sessionIds: ["a", "b"] }), []);
    assert.deepEqual(assistantExtraToolProblems(ASSISTANT_MOVE_SESSIONS_TOOL, { collectionId: "c", sessionIds: ["a", "a"] }), ["sessionIds has repeated items"]);
    assert.deepEqual(assistantExtraToolProblems(ASSISTANT_ASK_TOOL, { options: ["a", ""], question: "" }), ["question is empty", "options[1] is empty"]);
    assert.ok(assistantExtraToolProblems(ASSISTANT_ASK_TOOL, { options: ["a", "b"], question: "Q", x: 1 }).some((problem) => problem.includes("not declared")));
    assert.deepEqual(assistantExtraToolProblems(ASSISTANT_ASK_TOOL, "not an object"), ["arguments must be a JSON object"]);
  });

  test("assistantAskFrom returns a copy of a valid ask and null otherwise", () => {
    const options = ["Sim", "Não"];
    const ask = assistantAskFrom({ options, question: "Apagar?" });
    assert.deepEqual(ask, { options: ["Sim", "Não"], question: "Apagar?" });
    assert.notEqual(ask?.options, options);
    assert.equal(assistantAskFrom({ options: ["Sim"], question: "Apagar?" }), null);
    assert.equal(assistantAskFrom(null), null);
  });
});
