import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { resetCloudMemoryStateForTests } from "../cloud-api";
import {
  aiEnv,
  getJson,
  isRecord,
  jsonBody,
  paidProCookie,
  postJson,
  uploadCapture,
} from "../../../tests/helpers/cloud-ai";
import { reproductionPromptInput } from "./reproduction";

const RECORDING = {
  startedAt: "2026-09-08T10:00:00.000Z",
  steps: [
    { at: "2026-09-08T10:00:00.000Z", kind: "navigate", title: "Login", url: "https://example.test/login" },
    { at: "2026-09-08T10:00:03.000Z", kind: "input", locator: { cssSelector: "input[name=email]", tag: "input" }, value: "user@example.test" },
    { at: "2026-09-08T10:00:05.000Z", kind: "input", locator: { cssSelector: "input[name=password]", tag: "input" }, redacted: true },
    { at: "2026-09-08T10:00:07.000Z", kind: "click", locator: { cssSelector: "button[type=submit]", innerText: "Sign in", tag: "button" }, thumbnail: "data:image/jpeg;base64,/9j/4AAQ" },
  ],
  version: 1,
};

const GENERATED = {
  steps: ["Open https://example.test/login", "Type user@example.test into Email", "Type <password> into Password", "Click Sign in"],
};

function responsesApi(text: string) {
  return {
    output: [{ content: [{ text, type: "output_text" }], type: "message" }],
    usage: { input_tokens: 900, output_tokens: 300 },
  };
}

describe("POST /api/ai/reproduction", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
  });

  test("builds a bounded prompt with redacted values and pin comments", () => {
    const input = reproductionPromptInput({
      createdAt: "",
      id: "s",
      page: { title: "Login", url: "https://example.test/login" },
      pins: [{ comment: "The error toast never appears", coords: { x: 0, y: 0 }, number: 1, selector: "button", type: "point" }],
      reproduction: {
        startedAt: RECORDING.startedAt,
        steps: RECORDING.steps.map((step) => ({ ...step, kind: step.kind as "click" })),
        version: 1,
      },
    });
    assert.ok(input);
    assert.equal(input.startUrl, "https://example.test/login");
    assert.equal(input.steps[2].redacted, true);
    assert.equal(input.steps[2].value, undefined);
    assert.equal(input.steps[1].value, "user@example.test");
    assert.equal(JSON.stringify(input).includes("thumbnail"), false);
    assert.equal(input.pins[0].comment, "The error toast never appears");
    assert.equal(input.steps[3].described, '"Sign in"');
  });

  test("generates and persists written steps without consuming voice credits", async () => {
    const calls: Array<{ input: unknown; model: string }> = [];
    const reply = JSON.stringify(GENERATED);
    const env = aiEnv(async (model, input) => {
      calls.push({ input, model });
      return responsesApi(reply);
    });
    const paid = await paidProCookie(env);
    assert.equal((await uploadCapture(paid.cookie, {
      id: "repro_session_001",
      pins: [{ comment: "The error toast never appears", number: 1, pinId: "pin_repro_1" }],
      reproduction: RECORDING,
    }, paid.env)).status, 201);

    const response = await postJson("/api/ai/reproduction", {
      language: "pt",
      requestId: "repro_request_000001",
      sessionId: "repro_session_001",
    }, paid.cookie, paid.env);
    const first = await jsonBody(response);
    assert.equal(first.ok, true);
    assert.equal(first.creditsCharged, 0);
    assert.equal(first.aiCredits, undefined);
    assert.ok(isRecord(first.result) && Array.isArray(first.result.steps));
    assert.equal(first.result.steps.length, 4);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, "@cf/openai/gpt-oss-20b");
    assert.ok(isRecord(calls[0].input));
    assert.equal(calls[0].input.max_output_tokens, 2048);
    assert.match(String(calls[0].input.instructions), /untrusted data/);
    assert.doesNotMatch(String(calls[0].input.instructions), /Playwright|@playwright|\"test\"/i);
    const prompt = String(calls[0].input.input);
    assert.match(prompt, /user@example\.test/);
    assert.match(prompt, /"redacted":true/);
    assert.doesNotMatch(prompt, /hunter2|thumbnail/);
    assert.match(prompt, /"language":"pt"/);

    const stored = await jsonBody(await getJson("/api/sessions/repro_session_001", paid.cookie, paid.env));
    assert.ok(isRecord(stored.session) && isRecord(stored.session.reproduction) && isRecord(stored.session.reproduction.generated));
    assert.equal(stored.session.reproduction.generated.model, "@cf/openai/gpt-oss-20b");
    assert.equal("test" in stored.session.reproduction.generated, false);
    assert.equal(Array.isArray(stored.session.reproduction.steps) && stored.session.reproduction.steps.length, 4);

    const entitlements = await jsonBody(await getJson("/api/account/entitlements", paid.cookie, paid.env));
    assert.ok(isRecord(entitlements.aiCredits));
    assert.equal(entitlements.aiCredits.balance, 500);
    assert.deepEqual(entitlements.aiUsage, []);
  });

  test("rejects captures without a recording and leaves voice credits untouched on unusable output", async () => {
    const env = aiEnv(async () => responsesApi("not json at all"));
    const paid = await paidProCookie(env);
    assert.equal((await uploadCapture(paid.cookie, { id: "repro_session_002", pins: [{ comment: "x", number: 1 }] }, paid.env)).status, 201);
    const missing = await postJson("/api/ai/reproduction", {
      requestId: "repro_request_000002",
      sessionId: "repro_session_002",
    }, paid.cookie, paid.env);
    assert.equal(missing.status, 422);
    assert.equal((await jsonBody(missing)).code, "reproduction_required");

    assert.equal((await uploadCapture(paid.cookie, {
      id: "repro_session_003",
      pins: [{ comment: "x", number: 1 }],
      reproduction: RECORDING,
    }, paid.env)).status, 201);
    const failed = await postJson("/api/ai/reproduction", {
      requestId: "repro_request_000003",
      sessionId: "repro_session_003",
    }, paid.cookie, paid.env);
    assert.equal(failed.status, 503);
    assert.equal((await jsonBody(failed)).code, "invalid_ai_response");
    const entitlements = await jsonBody(await getJson("/api/account/entitlements", paid.cookie, paid.env));
    assert.ok(isRecord(entitlements.aiCredits));
    assert.equal(entitlements.aiCredits.balance, 500);
  });
});
