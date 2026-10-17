import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ToolSet } from "ai";
import { McpToolError } from "../mcp-protocol";
import { assistantToolsFor } from "./tool-policy";
import { ASSISTANT_TOOL_DATA_MAX, buildAssistantToolSet, type AssistantToolHost } from "./tools";

// Records every host call so tests can prove the host is (not) reached.
function makeHost(result: unknown, calls: string[] = []): AssistantToolHost {
  return {
    callTool: async (name, _args) => {
      calls.push(name);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function execute(set: ToolSet, llmName: string, args: unknown): Promise<unknown> {
  const entry = set[llmName];
  assert.ok(entry, `tool ${llmName} must exist in the set`);
  const run = (entry as { execute?: (input: unknown, options: unknown) => Promise<unknown> }).execute;
  assert.equal(typeof run, "function", "the entry must be an executable tool");
  return run!(args, {});
}

interface ToolResult {
  data?: string;
  message?: string;
  problems?: string[];
  status: string;
  truncated?: boolean;
}

describe("buildAssistantToolSet", () => {
  test('kinds: ["read"] keeps only the read tools, keyed by llmName', () => {
    const calls: string[] = [];
    const set = buildAssistantToolSet({ host: makeHost("ok", calls), kinds: ["read"], surface: "local" });
    const expected = assistantToolsFor("local")
      .filter((tool) => tool.policy.kind === "read")
      .map((tool) => tool.llmName);
    assert.ok(expected.length > 0, "the local surface must expose read tools");
    assert.deepEqual(Object.keys(set).sort(), expected.sort());
    for (const llmName of Object.keys(set)) {
      assert.ok(llmName.startsWith("pinar_"), `key ${llmName} must be an LLM name`);
    }
    assert.equal(calls.length, 0, "building the set must not call the host");
  });

  test('kinds: ["write"] keeps only the write tools', () => {
    const set = buildAssistantToolSet({ host: makeHost("ok"), kinds: ["write"], surface: "local" });
    const expected = assistantToolsFor("local")
      .filter((tool) => tool.policy.kind === "write")
      .map((tool) => tool.llmName);
    assert.deepEqual(Object.keys(set).sort(), expected.sort());
  });

  test('kinds: ["read", "write"] keeps every included tool of the surface', () => {
    const set = buildAssistantToolSet({
      host: makeHost("ok"),
      kinds: ["read", "write"],
      surface: "cloud",
    });
    const expected = assistantToolsFor("cloud").map((tool) => tool.llmName);
    assert.deepEqual(Object.keys(set).sort(), expected.sort());
  });

  test("wrong type, undeclared field and missing required field do not call the host", async () => {
    const calls: string[] = [];
    const set = buildAssistantToolSet({ host: makeHost("ok", calls), kinds: ["read"], surface: "local" });

    // pinar.list_sessions declares `limit` as integer.
    const wrongType = (await execute(set, "pinar_list_sessions", { limit: "three" })) as ToolResult;
    assert.equal(wrongType.status, "invalid_arguments");
    assert.ok(wrongType.problems?.some((problem) => problem.includes("limit")), JSON.stringify(wrongType.problems));

    // `bogus` is not declared by pinar.list_sessions.
    const undeclared = (await execute(set, "pinar_list_sessions", { bogus: 42 })) as ToolResult;
    assert.equal(undeclared.status, "invalid_arguments");
    assert.ok(
      undeclared.problems?.some((problem) => problem.includes("bogus") && problem.includes("not declared")),
      JSON.stringify(undeclared.problems),
    );

    // pinar.get_session_markdown requires `sessionId`.
    const missing = (await execute(set, "pinar_get_session_markdown", {})) as ToolResult;
    assert.equal(missing.status, "invalid_arguments");
    assert.ok(
      missing.problems?.some((problem) => problem.includes("sessionId") && problem.includes("missing")),
      JSON.stringify(missing.problems),
    );

    assert.equal(calls.length, 0, "invalid arguments must never reach the host");
  });

  test("hostile markup is escaped and wrapped in <dados>", async () => {
    const raw = 'oi <script>alert("x")</script> & </dados>';
    const set = buildAssistantToolSet({ host: makeHost(raw), kinds: ["read"], surface: "local" });
    const result = (await execute(set, "pinar_list_sessions", {})) as ToolResult;
    assert.equal(result.status, "ok");
    assert.equal(result.truncated, false);
    // & first, then < and >; quotes are not escaped; the closing tag cannot be injected.
    assert.equal(result.data, `<dados>oi &lt;script&gt;alert("x")&lt;/script&gt; &amp; &lt;/dados&gt;</dados>`);
  });

  test("non-string results are JSON.stringify'd before escaping", async () => {
    const set = buildAssistantToolSet({ host: makeHost({ a: "<b>" }), kinds: ["read"], surface: "local" });
    const result = (await execute(set, "pinar_list_sessions", {})) as ToolResult;
    assert.equal(result.status, "ok");
    assert.equal(result.data, `<dados>{"a":"&lt;b&gt;"}</dados>`);
  });

  test("a 30,000-character result is cut at ASSISTANT_TOOL_DATA_MAX and flagged truncated", async () => {
    const raw = "x".repeat(30_000);
    const set = buildAssistantToolSet({ host: makeHost(raw), kinds: ["read"], surface: "local" });
    const result = (await execute(set, "pinar_list_sessions", {})) as ToolResult;
    assert.equal(result.status, "ok");
    assert.equal(result.truncated, true);
    // <dados>(ASSISTANT_TOOL_DATA_MAX)</dados>
    assert.equal(result.data, `<dados>${"x".repeat(ASSISTANT_TOOL_DATA_MAX)}</dados>`);
  });

  test("McpToolError surfaces its message; any other error is 'Tool failed'", async () => {
    const mcpSet = buildAssistantToolSet({
      host: makeHost(new McpToolError("sessão não encontrada")),
      kinds: ["read"],
      surface: "local",
    });
    const mcpResult = (await execute(mcpSet, "pinar_list_sessions", {})) as ToolResult;
    assert.deepEqual(mcpResult, { message: "sessão não encontrada", status: "error" });

    const genericSet = buildAssistantToolSet({
      host: makeHost(new Error("segredo do provider")),
      kinds: ["read"],
      surface: "local",
    });
    const genericResult = (await execute(genericSet, "pinar_list_sessions", {})) as ToolResult;
    assert.deepEqual(genericResult, { message: "Tool failed", status: "error" });
  });
});
