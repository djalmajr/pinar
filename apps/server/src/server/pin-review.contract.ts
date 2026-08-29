import assert from "node:assert/strict";
import { PinReviewError, pinReviewErrorBody, VISUAL_CONTEXT_FIXTURES } from "@pinar/shared";

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

function executionPayload(captureId: string, overrides: Record<string, unknown> = {}) {
  return {
    agent: "cursor",
    captureId,
    idempotencyKey: "exec_review_cta_01",
    results: [{
      commit: "abc1234",
      files: ["src/cta.css"],
      pinId: "pin_cta",
      status: "changed",
      summary: "Increased CTA font weight",
    }],
    ...overrides,
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

export async function exercisePinReviewContract(client: ApiClient, publicClient?: ApiClient) {
  const id = "pin_review_element";
  await uploadCapture(client, id);

  const opened = await jsonRecord(await client(`/api/sessions/${id}`));
  const openReview = reviewOf(opened, "pin_cta");
  assert.equal(openReview.status, "open");
  assert.deepEqual(openReview.actions, []);
  assert.ok(Array.isArray(openReview.timeline));
  assert.equal(openReview.timeline.length, 0);
  assert.ok(isRecord(opened.session) && isRecord(opened.session.reviewCounts));
  assert.equal(opened.session.reviewCounts.open, 1);

  const tree = await jsonRecord(await client("/api/project-tree"));
  assert.ok(isRecord(tree.tree) && Array.isArray(tree.tree.projects));
  const listed = tree.tree.projects.flatMap((project) => (
    isRecord(project) && Array.isArray(project.collections)
      ? project.collections.flatMap((collection) => (
        isRecord(collection) && Array.isArray(collection.sessions) ? collection.sessions : []
      ))
      : []
  )).find((session) => isRecord(session) && session.id === id);
  assert.ok(isRecord(listed) && isRecord(listed.reviewCounts));
  assert.equal(listed.reviewCounts.open, 1);

  const ignored = await client("/api/agent-executions", {
    body: JSON.stringify(executionPayload(id, {
      idempotencyKey: "exec_review_ignored_01",
      results: [{ pinId: "pin_cta", status: "not_located", summary: "Could not find CTA" }],
    })),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(ignored.status, 201);
  const stillOpen = reviewOf(await jsonRecord(await client(`/api/sessions/${id}`)), "pin_cta");
  assert.equal(stillOpen.status, "open");
  assert.equal(Array.isArray(stillOpen.timeline) ? stillOpen.timeline.length : -1, 0);

  const invalidAccept = await client(`/api/sessions/${id}/pins/pin_cta/review`, {
    body: JSON.stringify({ action: "accept" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(invalidAccept.status, 409);
  assert.deepEqual(await jsonRecord(invalidAccept), pinReviewErrorBody(new PinReviewError("invalid_transition")));
  const unchanged = reviewOf(await jsonRecord(await client(`/api/sessions/${id}`)), "pin_cta");
  assert.equal(unchanged.status, "open");
  assert.equal(Array.isArray(unchanged.timeline) ? unchanged.timeline.length : -1, 0);

  const created = await client("/api/agent-executions", {
    body: JSON.stringify(executionPayload(id)),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(created.status, 201);
  const createdBody = await jsonRecord(created);
  assert.ok(isRecord(createdBody.execution));
  const executionId = createdBody.execution.id;

  const ready = await jsonRecord(await client(`/api/sessions/${id}`));
  const readyReview = reviewOf(ready, "pin_cta");
  assert.equal(readyReview.status, "correction_ready");
  assert.deepEqual(readyReview.actions, ["accept"]);
  assert.ok(Array.isArray(readyReview.timeline));
  assert.equal(readyReview.timeline.length, 1);
  assert.ok(isRecord(readyReview.timeline[0]));
  assert.equal(readyReview.timeline[0].fromStatus, "open");
  assert.equal(readyReview.timeline[0].toStatus, "correction_ready");
  assert.equal(readyReview.timeline[0].origin, "agent_result");
  assert.equal(readyReview.timeline[0].actorType, "agent");
  assert.equal(readyReview.timeline[0].executionId, executionId);
  assert.ok(isRecord(ready.session) && isRecord(ready.session.reviewCounts));
  assert.equal(ready.session.reviewCounts.correction_ready, 1);

  const replay = await client("/api/agent-executions", {
    body: JSON.stringify(executionPayload(id)),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(replay.status, 200);
  const replayed = reviewOf(await jsonRecord(await client(`/api/sessions/${id}`)), "pin_cta");
  assert.equal(replayed.status, "correction_ready");
  assert.equal(Array.isArray(replayed.timeline) ? replayed.timeline.length : -1, 1);

  if (publicClient) {
    const markdown = await publicClient(`/v/${id}.md`);
    assert.equal(markdown.status, 200);
    const text = await markdown.text();
    assert.match(text, /## Pin review/);
    assert.match(text, /pin_cta: correction_ready/);
    assert.match(text, /open → correction_ready \(agent_result\)/);
  }

  const accepted = await client(`/api/sessions/${id}/pins/pin_cta/review`, {
    body: JSON.stringify({ action: "accept" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(accepted.status, 200);
  const acceptedBody = await jsonRecord(accepted);
  assert.ok(isRecord(acceptedBody.review));
  assert.equal(acceptedBody.review.status, "accepted");
  assert.deepEqual(acceptedBody.review.actions, ["reopen"]);
  assert.ok(Array.isArray(acceptedBody.review.timeline));
  assert.equal(acceptedBody.review.timeline.length, 2);
  assert.ok(isRecord(acceptedBody.review.timeline[1]));
  assert.equal(acceptedBody.review.timeline[1].fromStatus, "correction_ready");
  assert.equal(acceptedBody.review.timeline[1].toStatus, "accepted");
  assert.equal(acceptedBody.review.timeline[1].origin, "human");
  assert.equal(acceptedBody.review.timeline[1].actorType, "human");

  const secondAccept = await client(`/api/sessions/${id}/pins/pin_cta/review`, {
    body: JSON.stringify({ action: "accept" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(secondAccept.status, 409);
  assert.deepEqual(await jsonRecord(secondAccept), pinReviewErrorBody(new PinReviewError("invalid_transition")));
  const stillAccepted = reviewOf(await jsonRecord(await client(`/api/sessions/${id}`)), "pin_cta");
  assert.equal(stillAccepted.status, "accepted");
  assert.equal(Array.isArray(stillAccepted.timeline) ? stillAccepted.timeline.length : -1, 2);

  const lateChange = await client("/api/agent-executions", {
    body: JSON.stringify(executionPayload(id, {
      idempotencyKey: "exec_review_after_accept_01",
      results: [{ pinId: "pin_cta", status: "changed", summary: "Should not auto-accept or reopen" }],
    })),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(lateChange.status, 201);
  const blocked = reviewOf(await jsonRecord(await client(`/api/sessions/${id}`)), "pin_cta");
  assert.equal(blocked.status, "accepted");
  assert.equal(Array.isArray(blocked.timeline) ? blocked.timeline.length : -1, 2);

  const reopened = await client(`/api/sessions/${id}/pins/pin_cta/review`, {
    body: JSON.stringify({ action: "reopen" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(reopened.status, 200);
  const reopenedBody = await jsonRecord(reopened);
  assert.ok(isRecord(reopenedBody.review));
  assert.equal(reopenedBody.review.status, "reopened");
  assert.deepEqual(reopenedBody.review.actions, []);
  assert.ok(Array.isArray(reopenedBody.review.timeline));
  assert.equal(reopenedBody.review.timeline.length, 3);

  const again = await client("/api/agent-executions", {
    body: JSON.stringify(executionPayload(id, {
      idempotencyKey: "exec_review_after_reopen_01",
      results: [{ pinId: "pin_cta", status: "changed", summary: "Second correction" }],
    })),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(again.status, 201);
  const readyAgain = reviewOf(await jsonRecord(await client(`/api/sessions/${id}`)), "pin_cta");
  assert.equal(readyAgain.status, "correction_ready");
  assert.deepEqual(readyAgain.actions, ["accept"]);
  assert.equal(Array.isArray(readyAgain.timeline) ? readyAgain.timeline.length : -1, 4);
}

export async function exercisePinReviewIsolation(owner: ApiClient, other: ApiClient) {
  const id = "pin_review_isolation_session";
  const upload = await owner("/api/shots", {
    body: JSON.stringify({
      id,
      image: VALID_PNG,
      page: { title: "Owner capture", url: "https://example.test/review-owner" },
      pins: [{ comment: "Owner pin", kind: "element", pinId: "pin_owner" }],
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(upload.status, 201);

  const created = await owner("/api/agent-executions", {
    body: JSON.stringify({
      agent: "claude",
      captureId: id,
      idempotencyKey: "exec_review_owner_01",
      results: [{ pinId: "pin_owner", status: "changed", summary: "Owner correction" }],
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(created.status, 201);

  const denied = await other(`/api/sessions/${id}/pins/pin_owner/review`, {
    body: JSON.stringify({ action: "accept" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(denied.status, 404);

  const accepted = await owner(`/api/sessions/${id}/pins/pin_owner/review`, {
    body: JSON.stringify({ action: "accept" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(accepted.status, 200);
  const publicSession = await other(`/api/sessions/${id}`);
  assert.equal(publicSession.status, 200);
  const body = await jsonRecord(publicSession);
  const review = reviewOf(body, "pin_owner");
  assert.equal(review.status, "accepted");
}
