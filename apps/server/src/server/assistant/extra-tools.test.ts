import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CLOUD_MCP_TOOLS } from "../mcp-tools-cloud";
import { LOCAL_MCP_TOOLS } from "../mcp-tools-local";
import {
  ASSISTANT_ASK_TOOL,
  ASSISTANT_MOVE_SESSIONS_TOOL,
  ASSISTANT_PINS_SEARCH_LIMIT_DEFAULT,
  ASSISTANT_PINS_SEARCH_LIMIT_MAX,
  ASSISTANT_PINS_SEARCH_TOOL,
  assistantAskFrom,
  assistantExtraToolProblems,
} from "./extra-tools";
import { ASSISTANT_BULK_MAX } from "./proposals";
import { PIN_SEARCH_MAX_LIMIT } from "./retrieval/index";
import { ASSISTANT_TOOL_POLICY, toLlmToolName } from "./tool-policy";

describe("assistant-only tools", () => {
  test("stay outside the MCP catalogs and the policy table", () => {
    for (const def of [ASSISTANT_MOVE_SESSIONS_TOOL, ASSISTANT_ASK_TOOL, ASSISTANT_PINS_SEARCH_TOOL]) {
      assert.ok(!LOCAL_MCP_TOOLS.some((tool) => tool.name === def.name), def.name);
      assert.ok(!CLOUD_MCP_TOOLS.some((tool) => tool.name === def.name), def.name);
      assert.ok(!Object.hasOwn(ASSISTANT_TOOL_POLICY, def.name), def.name);
    }
    assert.equal(toLlmToolName(ASSISTANT_MOVE_SESSIONS_TOOL.name), "pinar_move_sessions");
    assert.equal(toLlmToolName(ASSISTANT_ASK_TOOL.name), "pinar_ask");
    assert.equal(ASSISTANT_PINS_SEARCH_TOOL.name, "pinar.pins_search");
    assert.equal(toLlmToolName(ASSISTANT_PINS_SEARCH_TOOL.name), "pinar_pins_search");
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

  test("pinar.pins_search: a 1..500 query and an optional integer limit 1..50 (default 20), nothing else", () => {
    assert.deepEqual(ASSISTANT_PINS_SEARCH_TOOL.inputSchema, {
      additionalProperties: false,
      properties: {
        limit: { maximum: 50, minimum: 1, type: "integer" },
        query: { maxLength: 500, minLength: 1, type: "string" },
      },
      required: ["query"],
      type: "object",
    });
    assert.equal(ASSISTANT_PINS_SEARCH_LIMIT_MAX, PIN_SEARCH_MAX_LIMIT, "the tool limit follows the search limit");
    assert.equal(ASSISTANT_PINS_SEARCH_LIMIT_DEFAULT, 20);
  });

  test("descriptions are one short sentence without behavior rules", () => {
    for (const def of [ASSISTANT_MOVE_SESSIONS_TOOL, ASSISTANT_ASK_TOOL, ASSISTANT_PINS_SEARCH_TOOL]) {
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

  test("assistantExtraToolProblems: pinar.pins_search rejects a query empty after trim and the bounds of validateArgs", () => {
    const tool = ASSISTANT_PINS_SEARCH_TOOL;
    assert.deepEqual(assistantExtraToolProblems(tool, { query: "contraste" }), []);
    assert.deepEqual(assistantExtraToolProblems(tool, { limit: 1, query: "x".repeat(500) }), []);
    assert.deepEqual(assistantExtraToolProblems(tool, { limit: 50, query: "  contraste  " }), []);
    assert.deepEqual(assistantExtraToolProblems(tool, { query: "" }), ["query is empty"]);
    assert.deepEqual(assistantExtraToolProblems(tool, { query: " \t\n " }), ["query is empty"]);
    assert.deepEqual(assistantExtraToolProblems(tool, { query: "x".repeat(501) }), ["query exceeds maxLength 500"]);
    assert.deepEqual(assistantExtraToolProblems(tool, { limit: 0, query: "a" }), ["limit is below minimum 1"]);
    assert.deepEqual(assistantExtraToolProblems(tool, { limit: 51, query: "a" }), ["limit is above maximum 50"]);
    assert.deepEqual(assistantExtraToolProblems(tool, { limit: 2.5, query: "a" }), ["limit has invalid type (expected integer)"]);
    assert.deepEqual(assistantExtraToolProblems(tool, { query: "a", sessionId: "s1" }), ["sessionId is not declared"]);
    assert.deepEqual(assistantExtraToolProblems(tool, {}), ["query is missing"]);
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
