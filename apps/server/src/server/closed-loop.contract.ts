import assert from "node:assert/strict";
import {
  HANDOFF_AGENTS,
  VISUAL_CONTEXT_FIXTURES,
  adaptHandoffAll,
  formatHandoffBundle,
  parseVisualCapture,
  planSessionReopen,
} from "@pinar/shared";

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

function reviewOf(body: Record<string, unknown>, pinId: string) {
  assert.ok(Array.isArray(body.reviews));
  const review = body.reviews.find((item) => isRecord(item) && item.pinId === pinId);
  assert.ok(isRecord(review));
  return review;
}

function executionPayload(captureId: string, agent: string, key: string, summary: string) {
  return {
    agent,
    captureId,
    idempotencyKey: key,
    results: [{
      pinId: "pin_cta",
      status: "changed",
      summary,
    }],
  };
}

async function uploadCapture(client: ApiClient, id: string) {
  const fixture = VISUAL_CONTEXT_FIXTURES.elementV0;
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
}

export async function exerciseClosedLoopContract(client: ApiClient) {
  const capture = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.elementV0);
  const adapted = adaptHandoffAll(capture, "http://127.0.0.1:17373/v/cap_element_v0.md");
  assert.deepEqual(Object.keys(adapted).sort(), [...HANDOFF_AGENTS].sort());
  const signature = JSON.stringify({
    captureId: adapted.claude.captureId,
    comments: adapted.claude.comments,
    pinIds: adapted.claude.pinIds,
  });
  for (const agent of HANDOFF_AGENTS) {
    assert.equal(JSON.stringify({
      captureId: adapted[agent].captureId,
      comments: adapted[agent].comments,
      pinIds: adapted[agent].pinIds,
    }), signature);
  }

  const degraded = formatHandoffBundle(parseVisualCapture(VISUAL_CONTEXT_FIXTURES.missingScreenshot));
  assert.equal(degraded.degraded, true);
  assert.ok(degraded.warnings.includes("screenshot_missing"));
  assert.match(degraded.plain, /Still useful/);

  const id = "closed_loop_element";
  await uploadCapture(client, id);
  const session = await jsonRecord(await client(`/api/sessions/${id}`));
  assert.equal(reviewOf(session, "pin_cta").status, "open");
  assert.ok(isRecord(session.session) && isRecord(session.session.page));
  const pageUrl = String(session.session.page.url || "");
  assert.equal(planSessionReopen({
    appUrl: "http://127.0.0.1:17373/v/closed_loop_element",
    requestedSessionId: id,
    session: { id, page: { url: pageUrl } },
  }).ok, true);

  const firstAgent = HANDOFF_AGENTS[0];
  const created = await client("/api/agent-executions", {
    body: JSON.stringify(executionPayload(id, firstAgent, "exec_closed_loop_01", "First correction")),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(created.status, 201);
  assert.equal(reviewOf(await jsonRecord(await client(`/api/sessions/${id}`)), "pin_cta").status, "correction_ready");

  const accepted = await client(`/api/sessions/${id}/pins/pin_cta/review`, {
    body: JSON.stringify({ action: "accept" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(accepted.status, 200);
  const acceptedReview = await jsonRecord(accepted);
  assert.ok(isRecord(acceptedReview.review));
  assert.equal(acceptedReview.review.status, "accepted");

  const reopened = await client(`/api/sessions/${id}/pins/pin_cta/review`, {
    body: JSON.stringify({ action: "reopen" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(reopened.status, 200);

  const again = await client("/api/agent-executions", {
    body: JSON.stringify(executionPayload(id, "grok", "exec_closed_loop_02", "Second correction")),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(again.status, 201);
  assert.equal(reviewOf(await jsonRecord(await client(`/api/sessions/${id}`)), "pin_cta").status, "correction_ready");

  const off = await client("/api/loop-metrics", {
    body: JSON.stringify({
      events: [{
        comment: "Make the CTA bolder",
        event: "handoff",
        url: pageUrl,
      }],
      optIn: false,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(off.status, 200);
  const offBody = await jsonRecord(off);
  assert.equal(offBody.stored, 0);
  const listedOff = await jsonRecord(await client("/api/loop-metrics"));
  const listedOffText = JSON.stringify(listedOff);
  assert.equal(listedOffText.includes("Make the CTA bolder"), false);
  assert.equal(listedOffText.includes(pageUrl), false);

  const forbidden = await client("/api/loop-metrics", {
    body: JSON.stringify({
      events: [{
        comment: "secret comment",
        event: "handoff",
        selector: "#cta",
        screenshot: VALID_PNG,
        url: pageUrl,
      }],
      optIn: true,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(forbidden.status, 400);
  assert.equal((await jsonRecord(forbidden)).error, "forbidden_fields");

  const on = await client("/api/loop-metrics", {
    body: JSON.stringify({
      events: [
        { agent: firstAgent, durationMs: 40, event: "handoff" },
        { event: "correction_ready", locationConfidence: "exact" },
        { event: "accepted" },
        { event: "reopened" },
        { degraded: true, event: "relocation_failed", locationConfidence: "unresolved" },
      ],
      optIn: true,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(on.status, 201);
  const onBody = await jsonRecord(on);
  assert.equal(onBody.stored, 5);
  const listed = JSON.stringify(await jsonRecord(await client("/api/loop-metrics")));
  assert.equal(listed.includes("comment"), false);
  assert.equal(listed.includes("http"), false);
  assert.equal(listed.includes("#cta"), false);
  assert.equal(listed.includes("data:image"), false);
  assert.match(listed, /handoff/);
  assert.match(listed, /correction_ready/);
  assert.match(listed, /relocation_failed/);
}

export async function exerciseClosedLoopIsolation(owner: ApiClient, other: ApiClient) {
  const created = await owner("/api/loop-metrics", {
    body: JSON.stringify({
      events: [{ agent: "claude", durationMs: 12, event: "accepted" }],
      optIn: true,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(created.status, 201);
  const ownerList = await jsonRecord(await owner("/api/loop-metrics"));
  assert.ok(Array.isArray(ownerList.events) && ownerList.events.length >= 1);
  const otherList = await jsonRecord(await other("/api/loop-metrics"));
  assert.ok(Array.isArray(otherList.events));
  assert.equal(otherList.events.length, 0);
}
