import assert from "node:assert/strict";
import { AgentResultError, agentResultErrorBody, VISUAL_CONTEXT_FIXTURES } from "@pinar/shared";

const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

type ApiClient = (path: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jsonRecord(response: Response) {
  const body: unknown = await response.json();
  assert.ok(isRecord(body));
  return body;
}

function executionPayload(overrides: Record<string, unknown> = {}) {
  return {
    agent: "cursor",
    captureId: "visual_contract_element",
    idempotencyKey: "exec_cursor_cta_01",
    results: [{
      commit: "abc1234",
      files: ["src/cta.css"],
      pinId: "pin_cta",
      pullRequest: "https://github.com/pinar/pinar/pull/8",
      status: "changed",
      summary: "Increased CTA font weight",
    }],
    ...overrides,
  };
}

export async function exerciseAgentResultsContract(client: ApiClient, publicClient?: ApiClient) {
  const fixture = VISUAL_CONTEXT_FIXTURES.elementV0;
  const id = "visual_contract_element";
  const upload = await client("/api/shots", {
    body: JSON.stringify({
      ...fixture,
      captureId: id,
      id,
      image: VALID_PNG,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(upload.status, 201);

  const created = await client("/api/agent-executions", {
    body: JSON.stringify(executionPayload()),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(created.status, 201);
  const createdBody = await jsonRecord(created);
  assert.equal(createdBody.ok, true);
  assert.equal(createdBody.created, true);
  assert.ok(isRecord(createdBody.execution));
  assert.equal(createdBody.execution.agent, "cursor");
  assert.equal(createdBody.execution.captureId, id);
  assert.equal(createdBody.execution.idempotencyKey, "exec_cursor_cta_01");
  assert.ok(Array.isArray(createdBody.execution.results));
  assert.equal(createdBody.execution.results[0]?.pinId, "pin_cta");
  assert.equal(createdBody.execution.results[0]?.status, "changed");
  assert.equal(createdBody.execution.results[0]?.summary, "Increased CTA font weight");
  assert.deepEqual(createdBody.execution.results[0]?.files, ["src/cta.css"]);
  const executionId = createdBody.execution.id;

  const replay = await client("/api/agent-executions", {
    body: JSON.stringify(executionPayload()),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(replay.status, 200);
  const replayBody = await jsonRecord(replay);
  assert.equal(replayBody.created, false);
  assert.equal(isRecord(replayBody.execution) && replayBody.execution.id, executionId);

  const conflict = await client("/api/agent-executions", {
    body: JSON.stringify(executionPayload({
      results: [{ pinId: "pin_cta", status: "blocked", summary: "Could not apply" }],
    })),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(conflict.status, 409);
  assert.deepEqual(await jsonRecord(conflict), agentResultErrorBody(new AgentResultError("idempotency_conflict")));

  const missingPin = await client("/api/agent-executions", {
    body: JSON.stringify(executionPayload({
      idempotencyKey: "exec_cursor_missing_pin",
      results: [{ pinId: "pin_does_not_exist", status: "changed", summary: "Nope" }],
    })),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(missingPin.status, 400);
  const missingPinBody = await jsonRecord(missingPin);
  assert.deepEqual(missingPinBody, agentResultErrorBody(new AgentResultError("pin_not_found")));
  assert.equal(JSON.stringify(missingPinBody).includes("Make the CTA bolder"), false);

  const missingCapture = await client("/api/agent-executions", {
    body: JSON.stringify(executionPayload({
      captureId: "missing_capture_session",
      idempotencyKey: "exec_cursor_missing_capture",
    })),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(missingCapture.status, 404);
  assert.deepEqual(await jsonRecord(missingCapture), agentResultErrorBody(new AgentResultError("capture_not_found")));

  const sessionResponse = await client(`/api/sessions/${id}`);
  assert.equal(sessionResponse.status, 200);
  const sessionBody = await jsonRecord(sessionResponse);
  assert.ok(Array.isArray(sessionBody.executions));
  assert.equal(sessionBody.executions.length, 1);
  const [execution] = sessionBody.executions;
  assert.ok(isRecord(execution));
  assert.equal(execution.id, executionId);
  assert.ok(Array.isArray(execution.results));
  const [result] = execution.results;
  assert.ok(isRecord(result));
  assert.equal(result.status, "changed");

  if (publicClient) {
    const markdown = await publicClient(`/v/${id}.md`);
    assert.equal(markdown.status, 200);
    const text = await markdown.text();
    assert.match(text, /## Agent results/);
    assert.match(text, /pin_cta: changed — Increased CTA font weight/);
    assert.match(text, /```pinar-agent-results/);
    assert.match(text, /src\/cta.css/);
  }
}

export async function exerciseAgentResultsIsolation(owner: ApiClient, other: ApiClient) {
  const id = "agent_isolation_session";
  const upload = await owner("/api/shots", {
    body: JSON.stringify({
      id,
      image: VALID_PNG,
      page: { title: "Owner capture", url: "https://example.test/owner" },
      pins: [{ comment: "Owner pin", kind: "element", pinId: "pin_owner" }],
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(upload.status, 201);

  const denied = await other("/api/agent-executions", {
    body: JSON.stringify({
      agent: "claude",
      captureId: id,
      idempotencyKey: "exec_other_denied_01",
      results: [{ pinId: "pin_owner", status: "changed", summary: "Should not persist" }],
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(denied.status, 404);
  assert.deepEqual(await jsonRecord(denied), agentResultErrorBody(new AgentResultError("capture_not_found")));

  const created = await owner("/api/agent-executions", {
    body: JSON.stringify({
      agent: "codex",
      captureId: id,
      idempotencyKey: "exec_owner_ok_01",
      results: [{ pinId: "pin_owner", status: "not_applicable", summary: "Owner recorded" }],
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(created.status, 201);

  const publicSession = await other(`/api/sessions/${id}`);
  assert.equal(publicSession.status, 200);
  const body = await jsonRecord(publicSession);
  assert.ok(Array.isArray(body.executions));
  assert.equal(body.executions.length, 1);
  assert.ok(isRecord(body.executions[0]));
  assert.equal(body.executions[0].agent, "codex");
  assert.equal(body.executions[0].idempotencyKey, "exec_owner_ok_01");
}
