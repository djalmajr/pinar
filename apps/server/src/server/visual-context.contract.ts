import assert from "node:assert/strict";
import { formatClipboard } from "../../../../extension/format.js";
import { adaptHandoffAll, formatHandoffBundle, HANDOFF_AGENTS, handoffSemantics, parseHandoffJson } from "@pinar/shared/handoff";
import {
  formatVisualContextMarkdown,
  parseVisualCapture,
  visualContextErrorBody,
  VISUAL_CONTEXT_FIXTURES,
  VISUAL_CONTEXT_SCHEMA_VERSION,
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

export function assertVisualContextEquivalence() {
  const capture = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.elementV0);
  const markdown = formatVisualContextMarkdown(capture, "http://127.0.0.1:17373/v/cap_element_v0");
  const handoff = formatHandoffBundle(capture, "http://127.0.0.1:17373/v/cap_element_v0");
  const clipboard = formatClipboard({
    captureId: capture.captureId,
    page: capture.page,
    pins: capture.pins,
    schemaVersion: capture.schemaVersion,
    sentAt: "2026-08-29T00:00:00.000Z",
    shot: "/tmp/pinar-shot.png",
  });
  assert.match(markdown, /captureId: cap_element_v0/);
  assert.match(markdown, /pinId: pin_cta/);
  const clipboardContext = parseHandoffJson(clipboard.plain) as {
    captureId: string;
    pins: Array<{ pinId: string }>;
  };
  assert.equal(clipboardContext.captureId, "cap_element_v0");
  assert.equal(clipboardContext.pins[0].pinId, "pin_cta");
  assert.match(clipboard.plain, /```pinar-visual-context/);
  assert.match(handoff.plain, /```pinar-visual-context/);
  const adapted = adaptHandoffAll(capture);
  const expected = handoffSemantics(adapted.cursor.text);
  for (const agent of HANDOFF_AGENTS) {
    assert.deepEqual(handoffSemantics(adapted[agent].text), expected);
  }
  assert.deepEqual(handoffSemantics(clipboard.plain), {
    captureId: expected.captureId,
    comments: expected.comments,
    pinIds: expected.pinIds,
    url: expected.url,
    warnings: handoffSemantics(clipboard.plain).warnings,
  });
  assert.equal(capture.schemaVersion, VISUAL_CONTEXT_SCHEMA_VERSION);
}

export async function exerciseVisualContextContract(client: ApiClient, publicClient?: ApiClient) {
  assertVisualContextEquivalence();

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

  const sessionResponse = await client(`/api/sessions/${id}`);
  assert.equal(sessionResponse.status, 200);
  const sessionBody = await jsonRecord(sessionResponse);
  assert.ok(isRecord(sessionBody.session));
  assert.equal(sessionBody.session.schemaVersion, 1);
  assert.equal(sessionBody.session.captureId, id);
  assert.ok(Array.isArray(sessionBody.session.pins));
  assert.equal(sessionBody.session.pins[0]?.pinId, "pin_cta");
  assert.equal(sessionBody.session.pins[0]?.comment, "Make the CTA bolder");

  if (publicClient) {
    const markdown = await publicClient(`/v/${id}.md`);
    assert.equal(markdown.status, 200);
    const text = await markdown.text();
    assert.match(text, /captureId: visual_contract_element/);
    assert.match(text, /pinId: pin_cta/);
    assert.match(text, /Make the CTA bolder/);
  }

  const invalid = await client("/api/history", {
    body: JSON.stringify({
      id: "visual_contract_invalid",
      page: { title: "Secret page", url: "https://example.test/secret" },
      pins: VISUAL_CONTEXT_FIXTURES.invalidPinsObject.pins,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(invalid.status, 400);
  const errorBody = await jsonRecord(invalid);
  assert.deepEqual(errorBody, visualContextErrorBody({ code: "invalid_payload" }));
  assert.equal(JSON.stringify(errorBody).includes("UNIQUE_SECRET_PIN_COMMENT"), false);
  assert.equal(JSON.stringify(errorBody).includes("Secret page"), false);
  assert.equal((await client("/api/sessions/visual_contract_invalid")).status, 404);
}
