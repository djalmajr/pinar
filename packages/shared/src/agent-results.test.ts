import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  AGENT_NAMES,
  AGENT_RESULT_STATUSES,
  AgentResultError,
  agentExecutionFingerprint,
  agentResultErrorBody,
  formatAgentResultsMarkdown,
  parseAgentExecutionInput,
  pinIdsFromPins,
} from "./agent-results/index.js";

const PIN_IDS = pinIdsFromPins([{ pinId: "pin_cta" }, { id: "pin_nav" }]);

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    agent: "cursor",
    captureId: "visual_contract_element",
    idempotencyKey: "exec_cursor_cta_01",
    results: [{
      files: ["src/cta.css"],
      pinId: "pin_cta",
      status: "changed",
      summary: "Increased CTA font weight",
    }],
    ...overrides,
  };
}

describe("agent results contract", () => {
  test("accepts the four agents and four pin statuses", () => {
    assert.deepEqual([...AGENT_NAMES].sort(), ["claude", "codex", "cursor", "grok"]);
    assert.deepEqual([...AGENT_RESULT_STATUSES].sort(), [
      "blocked",
      "changed",
      "not_applicable",
      "not_located",
    ]);
    for (const agent of AGENT_NAMES) {
      for (const status of AGENT_RESULT_STATUSES) {
        const parsed = parseAgentExecutionInput(validInput({
          agent,
          results: [{ pinId: "pin_cta", status, summary: `${status} by ${agent}` }],
        }), PIN_IDS);
        assert.equal(parsed.agent, agent);
        assert.equal(parsed.results[0]?.status, status);
      }
    }
  });

  test("rejects unknown captures pins, duplicate pins, and incompatible evidence", () => {
    assert.throws(
      () => parseAgentExecutionInput(validInput({ results: [{ pinId: "pin_missing", status: "changed", summary: "x" }] }), PIN_IDS),
      (error: unknown) => error instanceof AgentResultError && error.code === "pin_not_found",
    );
    assert.throws(
      () => parseAgentExecutionInput(validInput({
        results: [
          { pinId: "pin_cta", status: "changed", summary: "one" },
          { pinId: "pin_cta", status: "blocked", summary: "two" },
        ],
      }), PIN_IDS),
      (error: unknown) => error instanceof AgentResultError && error.code === "invalid_payload",
    );
    assert.throws(
      () => parseAgentExecutionInput(validInput({ results: [{ pinId: "pin_cta", status: "done", summary: "x" }] }), PIN_IDS),
      (error: unknown) => error instanceof AgentResultError && error.code === "invalid_payload",
    );
    assert.throws(
      () => parseAgentExecutionInput(validInput({
        results: [{
          pinId: "pin_cta",
          pullRequest: "javascript:alert(1)",
          status: "changed",
          summary: "x",
        }],
      }), PIN_IDS),
      (error: unknown) => error instanceof AgentResultError && error.code === "invalid_payload",
    );
    const body = agentResultErrorBody(new AgentResultError("pin_not_found"));
    assert.deepEqual(body, { code: "pin_not_found", error: "invalid agent result" });
    assert.equal(JSON.stringify(body).includes("UNIQUE_SECRET"), false);
  });

  test("idempotent fingerprints ignore result order and markdown omits original pin comments", () => {
    const first = parseAgentExecutionInput(validInput({
      results: [
        { pinId: "pin_nav", status: "not_located", summary: "Nav moved" },
        { pinId: "pin_cta", status: "changed", summary: "CTA updated" },
      ],
    }), PIN_IDS);
    const second = parseAgentExecutionInput(validInput({
      results: [
        { pinId: "pin_cta", status: "changed", summary: "CTA updated" },
        { pinId: "pin_nav", status: "not_located", summary: "Nav moved" },
      ],
    }), PIN_IDS);
    assert.equal(first.fingerprint, second.fingerprint);
    assert.equal(
      first.fingerprint,
      agentExecutionFingerprint({ agent: first.agent, captureId: first.captureId, results: first.results }),
    );
    const markdown = formatAgentResultsMarkdown([{
      agent: "cursor",
      captureId: "visual_contract_element",
      createdAt: "2026-08-29T00:00:00.000Z",
      id: "aex_test",
      idempotencyKey: "exec_cursor_cta_01",
      results: [{
        createdAt: "2026-08-29T00:00:00.000Z",
        files: ["src/cta.css"],
        pinId: "pin_cta",
        status: "changed",
        summary: "Increased CTA font weight",
      }],
    }]);
    assert.match(markdown, /pin_cta: changed/);
    assert.match(markdown, /```pinar-agent-results/);
    assert.equal(markdown.includes("Make the CTA bolder"), false);
    assert.equal(markdown.includes("secret password"), false);
  });
});
