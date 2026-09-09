import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import {
  aiEnv,
  api,
  getJson,
  isRecord,
  jsonBody,
  paidProCookie,
  postJson,
  REMOTE_FREE_LEGAL_ACCEPTANCE,
  TEST_ENV,
  uploadCapture,
} from "../../../tests/helpers/cloud-ai";
import { type CloudEnv, resetCloudMemoryStateForTests } from "../cloud-api";

const SESSION_ID = "diag_session_0001";
const MODEL = "@cf/openai/gpt-oss-20b";

const FIXTURE_PINS = [
  {
    comment: "The label sits higher than the other menu items",
    number: 1,
    pinId: "pin_line_height",
    selector: "nav a.current",
    snapshot: {
      context: {
        parent: { attrs: { class: "menu" }, styles: { display: "flex", gap: "16px" }, tag: "nav" },
        siblings: [
          { styles: { "line-height": "24px", color: "rgb(0, 0, 0)", margin: "0px" }, tag: "a", text: "Home" },
          { styles: { "line-height": "24px", color: "rgb(0, 0, 0)", margin: "0px" }, tag: "a", text: "Docs" },
        ],
      },
      fonts: [{ family: "Inter", weight: "500" }],
      icons: [],
      nodeCount: 1,
      root: { attrs: { class: "current" }, styles: { "line-height": "16px", margin: "0px" }, tag: "a", text: "Pricing" },
      truncated: false,
      version: 1,
    },
    tag: "a",
  },
  {
    comment: "Icon and text are not vertically centred",
    number: 2,
    pinId: "pin_align_items",
    selector: "button.pay",
    snapshot: {
      fonts: [],
      icons: [{ kind: "class", name: "lucide-credit-card" }],
      nodeCount: 3,
      root: {
        attrs: { class: "pay" },
        children: [
          { styles: { height: "24px", width: "24px" }, tag: "svg" },
          { styles: { "line-height": "20px" }, tag: "span", text: "Pay now" },
        ],
        styles: { display: "flex", "justify-content": "center", padding: "8px 16px" },
        tag: "button",
      },
      truncated: false,
      version: 1,
    },
    tag: "button",
  },
  {
    comment: "The card is closer to the left neighbour than to the right one",
    number: 3,
    pinId: "pin_margin",
    selector: "section.cards > article:nth-child(2)",
    snapshot: {
      context: {
        parent: { attrs: { class: "cards" }, styles: { display: "grid" }, tag: "section" },
        siblings: [
          { styles: { margin: "0px 16px" }, tag: "article", text: "Starter" },
          { styles: { margin: "0px 16px" }, tag: "article", text: "Team" },
        ],
      },
      fonts: [],
      icons: [],
      nodeCount: 1,
      root: { styles: { "margin-left": "4px", "margin-right": "32px" }, tag: "article", text: "Pro" },
      truncated: false,
      version: 1,
    },
    tag: "article",
  },
  {
    comment: "The tooltip is cut off at the bottom",
    number: 4,
    pinId: "pin_overflow",
    selector: "div.tooltip",
    snapshot: {
      context: {
        parent: { attrs: { class: "cell" }, styles: { height: "32px", overflow: "hidden", position: "relative" }, tag: "td" },
      },
      fonts: [],
      icons: [],
      nodeCount: 1,
      root: { attrs: { class: "tooltip" }, styles: { height: "64px", position: "absolute", top: "24px" }, tag: "div", text: "Renews on 2026-10-01" },
      truncated: false,
      version: 1,
    },
    tag: "div",
  },
  { comment: "Something is off here", number: 5, pinId: "pin_no_snapshot" },
];

const FIXTURE_STYLE_EXPECTATIONS: Record<string, RegExp> = {
  pin_align_items: /"display":"flex"/,
  pin_line_height: /"line-height":"16px"/,
  pin_margin: /"margin-right":"32px"/,
  pin_overflow: /"overflow":"hidden"/,
};

const FIXTURE_REPLIES: Record<string, Record<string, unknown>> = {
  pin_align_items: {
    cause: "The flex container has no align-items, so the icon and the text align to the start of the cross axis.",
    confidence: "high",
    fix: "button.pay { align-items: center; }",
    properties: ["align-items", "display"],
  },
  pin_line_height: {
    cause: "The current link has line-height 16px while its siblings use 24px, so its text box is shorter and sits higher.",
    confidence: "high",
    fix: "nav a.current { line-height: 24px; }",
    properties: ["line-height"],
  },
  pin_margin: {
    cause: "Margins are asymmetric: 4px on the left and 32px on the right, unlike the siblings' 16px on both sides.",
    confidence: "medium",
    fix: "section.cards > article:nth-child(2) { margin: 0 16px; }",
    properties: ["margin-left", "margin-right"],
  },
  pin_overflow: {
    cause: "The parent cell clips overflow, so an absolutely positioned tooltip taller than the cell is cut off.",
    confidence: "medium",
    fix: "td.cell { overflow: visible; }",
    properties: ["overflow", "position"],
  },
};

const identity = { id: `ins_${"D".repeat(24)}`, token: `pit_${"d".repeat(43)}` };

function identityHeaders(extra: HeadersInit = {}) {
  return new Headers({
    authorization: `Bearer ${identity.token}`,
    "x-pinar-installation-id": identity.id,
    ...Object.fromEntries(new Headers(extra)),
  });
}

interface RecordedCall {
  input: unknown;
  model: string;
}

function responsesReply(text: string) {
  return {
    output: [{ content: [{ text, type: "output_text" }], type: "message" }],
    usage: { input_tokens: 900, output_tokens: 120 },
  };
}

function diagnosisEnv(reply: (pinId: string) => string, calls: RecordedCall[] = []) {
  const env = aiEnv(async (model, input) => {
    calls.push({ input, model });
    assert.ok(isRecord(input));
    const parsed: unknown = JSON.parse(String(input.input));
    assert.ok(isRecord(parsed) && isRecord(parsed.pin));
    const pinId = String(parsed.pin.number);
    return responsesReply(reply(pinId));
  });
  return { calls, env };
}

async function paidWithFixtures(env: CloudEnv) {
  const paid = await paidProCookie(env);
  const upload = await uploadCapture(paid.cookie, { id: SESSION_ID, pins: FIXTURE_PINS }, paid.env);
  assert.equal(upload.status, 201);
  return paid;
}

function diagnose(cookie: string, env: CloudEnv, pinId: string, requestId: string, language = "en") {
  return postJson("/api/ai/pin-diagnosis", { language, pinId, requestId, sessionId: SESSION_ID }, cookie, env);
}

async function creditBalance(cookie: string, env: CloudEnv) {
  const entitlements = await jsonBody(await getJson("/api/account/entitlements", cookie, env));
  assert.ok(isRecord(entitlements.aiCredits));
  return entitlements.aiCredits.balance;
}

function replyForPinNumber(number: string) {
  const pinId = FIXTURE_PINS.find((pin) => String(pin.number) === number)?.pinId ?? "";
  return JSON.stringify(FIXTURE_REPLIES[pinId] ?? {});
}

describe("POST /api/ai/pin-diagnosis", () => {
  beforeEach(() => resetCloudMemoryStateForTests());

  test("rejects a pin without a snapshot with 422 and consumes no credit", async () => {
    const { calls, env } = diagnosisEnv(replyForPinNumber);
    const paid = await paidWithFixtures(env);

    const response = await diagnose(paid.cookie, paid.env, "pin_no_snapshot", "diag_request_no_snapshot");

    assert.equal(response.status, 422);
    assert.equal((await jsonBody(response)).code, "snapshot_required");
    assert.equal(calls.length, 0);
    assert.equal(await creditBalance(paid.cookie, paid.env), 200);
  });

  for (const pinId of Object.keys(FIXTURE_REPLIES)) {
    test(`diagnoses ${pinId} from its snapshot with the Responses API`, async () => {
      const { calls, env } = diagnosisEnv(replyForPinNumber);
      const paid = await paidWithFixtures(env);

      const response = await diagnose(paid.cookie, paid.env, pinId, `diag_request_${pinId}`, "pt");

      assert.equal(response.status, 200);
      const body = await jsonBody(response);
      assert.equal(body.ok, true);
      assert.equal(body.creditsCharged, 3);
      assert.equal(body.idempotent, false);
      assert.ok(isRecord(body.aiCredits));
      assert.equal(body.aiCredits.balance, 197);
      assert.ok(isRecord(body.usage));
      assert.equal(body.usage.model, MODEL);
      assert.equal(body.usage.inputTokens, 900);
      assert.equal(body.usage.outputTokens, 120);
      const expected = FIXTURE_REPLIES[pinId];
      assert.deepEqual(body.result, { ...expected, model: MODEL, version: 1 });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].model, MODEL);
      assert.ok(isRecord(calls[0].input));
      assert.equal(calls[0].input.max_output_tokens, 1024);
      assert.match(String(calls[0].input.instructions), /untrusted data/);
      assert.match(String(calls[0].input.instructions), /"cause"/);
      const userInput = String(calls[0].input.input);
      assert.match(userInput, FIXTURE_STYLE_EXPECTATIONS[pinId]);
      assert.match(userInput, /"language":"pt"/);
      assert.match(userInput, new RegExp(`"selector":"${FIXTURE_PINS.find((pin) => pin.pinId === pinId)?.selector?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
      assert.equal(await creditBalance(paid.cookie, paid.env), 197);
    });
  }

  test("replays the same requestId idempotently without a second inference", async () => {
    const { calls, env } = diagnosisEnv(replyForPinNumber);
    const paid = await paidWithFixtures(env);
    const first = await jsonBody(await diagnose(paid.cookie, paid.env, "pin_line_height", "diag_request_replay_01"));

    const replay = await jsonBody(await diagnose(paid.cookie, paid.env, "pin_line_height", "diag_request_replay_01"));

    assert.equal(replay.idempotent, true);
    assert.deepEqual(replay.result, first.result);
    assert.ok(isRecord(replay.aiCredits));
    assert.equal(replay.aiCredits.balance, 197);
    assert.equal(calls.length, 1);
  });

  test("rejects a requestId reused for another pin", async () => {
    const { env } = diagnosisEnv(replyForPinNumber);
    const paid = await paidWithFixtures(env);
    assert.equal((await diagnose(paid.cookie, paid.env, "pin_line_height", "diag_request_conflict_01")).status, 200);

    const conflict = await diagnose(paid.cookie, paid.env, "pin_margin", "diag_request_conflict_01");

    assert.equal(conflict.status, 409);
    assert.equal((await jsonBody(conflict)).code, "request_id_conflict");
  });

  test("refunds the credits and returns 503 when the model output is invalid", async () => {
    const { calls, env } = diagnosisEnv(() => "Sure! Here is my analysis: the element looks fine.");
    const paid = await paidWithFixtures(env);

    const response = await diagnose(paid.cookie, paid.env, "pin_overflow", "diag_request_invalid_01");

    assert.equal(response.status, 503);
    const body = await jsonBody(response);
    assert.equal(body.code, "invalid_ai_response");
    assert.match(String(body.error), /refunded/i);
    assert.equal(calls.length, 1);
    assert.equal(await creditBalance(paid.cookie, paid.env), 200);
  });

  test("refunds when the model returns an unknown confidence", async () => {
    const { env } = diagnosisEnv(() => JSON.stringify({ cause: "Guess", confidence: "certain", fix: "", properties: [] }));
    const paid = await paidWithFixtures(env);

    const response = await diagnose(paid.cookie, paid.env, "pin_margin", "diag_request_invalid_02");

    assert.equal(response.status, 503);
    assert.equal((await jsonBody(response)).code, "invalid_ai_response");
    assert.equal(await creditBalance(paid.cookie, paid.env), 200);
  });

  test("returns 404 for an unknown pinId", async () => {
    const { calls, env } = diagnosisEnv(replyForPinNumber);
    const paid = await paidWithFixtures(env);

    const response = await diagnose(paid.cookie, paid.env, "pin_missing", "diag_request_missing_01");

    assert.equal(response.status, 404);
    assert.equal(calls.length, 0);
    assert.equal(await creditBalance(paid.cookie, paid.env), 200);
  });

  test("returns 401 without a signed-in principal", async () => {
    const { calls, env } = diagnosisEnv(replyForPinNumber);

    const response = await api("/api/ai/pin-diagnosis", {
      body: JSON.stringify({ pinId: "pin_line_height", requestId: "diag_request_anon_0001", sessionId: SESSION_ID }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }, env);

    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  });

  test("returns 403 for a Free installation", async () => {
    const { calls, env } = diagnosisEnv(replyForPinNumber);
    const registered = await api("/api/installations", {
      body: JSON.stringify({
        installationId: identity.id,
        installationToken: identity.token,
        legalAcceptance: REMOTE_FREE_LEGAL_ACCEPTANCE,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }, TEST_ENV);
    assert.equal(registered.status, 201);
    const upload = await api("/api/shots", {
      body: JSON.stringify({
        id: SESSION_ID,
        image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        page: { title: "Free capture", url: "https://example.test/free" },
        pins: FIXTURE_PINS.slice(0, 1),
      }),
      headers: identityHeaders({ "content-type": "application/json" }),
      method: "POST",
    }, TEST_ENV);
    assert.equal(upload.status, 201);

    const response = await api("/api/ai/pin-diagnosis", {
      body: JSON.stringify({ pinId: "pin_line_height", requestId: "diag_request_free_00001", sessionId: SESSION_ID }),
      headers: identityHeaders({ "content-type": "application/json" }),
      method: "POST",
    }, env);

    assert.equal(response.status, 403);
    assert.equal((await jsonBody(response)).code, "ai_requires_paid");
    assert.equal(calls.length, 0);
  });
});
