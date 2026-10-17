import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { resetCloudMemoryStateForTests, type CloudEnv } from "../cloud-api";
import {
  aiEnv,
  api,
  getJson,
  isRecord,
  jsonBody,
  paidProCookie,
  postJson,
  TEST_ENV,
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

const GATEWAY_TEXT_MODEL = "anthropic/claude-haiku-5.5";

interface GatewayCall {
  body: Record<string, unknown>;
  model: string;
  url: string;
}

// A fake global fetch for the Vercel AI Gateway: the chain builds the
// provider with the runtime fetch, so the route reaches this stub.
function fakeGateway(replies: Record<string, () => Response>) {
  const calls: GatewayCall[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const model = headers.get("ai-language-model-id") ?? "";
    const call: GatewayCall = { body, model, url };
    calls.push(call);
    const reply = replies[`text:${model}`];
    if (!reply) throw new Error(`fake gateway: no reply for ${model}`);
    return reply();
  }) as typeof fetch;
  return { calls, fn };
}

async function withGateway<T>(fake: ReturnType<typeof fakeGateway>, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = fake.fn;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
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

  test("generates and persists through the AI_TEXT_CHAIN gateway link without the AI binding", async () => {
    const env: CloudEnv = {
      ...TEST_ENV,
      AI_GATEWAY_API_KEY: "sk-repro-gateway-test",
      AI_TEXT_CHAIN: `gateway:${GATEWAY_TEXT_MODEL}`,
    };
    const fake = fakeGateway({
      [`text:${GATEWAY_TEXT_MODEL}`]: () => Response.json({
        content: [{ text: JSON.stringify({ generatedAt: "2026-10-17T00:00:00.000Z", steps: GENERATED.steps }), type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        providerMetadata: { gateway: { cost: "0", marketCost: "0.000123" } },
        usage: {
          inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 900, total: 900 },
          outputTokens: { reasoning: 0, text: 300, total: 300 },
        },
        warnings: [],
      }),
    });
    const paid = await paidProCookie(env);
    assert.equal((await uploadCapture(paid.cookie, {
      id: "repro_session_010",
      pins: [{ comment: "The error toast never appears", number: 1, pinId: "pin_repro_10" }],
      reproduction: RECORDING,
    }, paid.env)).status, 201);

    const response = await withGateway(fake, () => postJson("/api/ai/reproduction", {
      language: "pt",
      requestId: "repro_request_gateway_01",
      sessionId: "repro_session_010",
    }, paid.cookie, paid.env));

    assert.equal(response.status, 200, await response.clone().text());
    const body = await jsonBody(response);
    assert.equal(body.ok, true);
    assert.equal(body.creditsCharged, 0);
    assert.ok(isRecord(body.result) && Array.isArray(body.result.steps));
    assert.equal(body.result.steps.length, 4);
    assert.ok(isRecord(body.usage));
    assert.equal(body.usage.costUsdMicros, 123, "the cost comes from marketCost");
    assert.equal(body.usage.inputTokens, 900);
    assert.equal(body.usage.outputTokens, 300);
    assert.equal(fake.calls.length, 1);
    assert.ok(fake.calls[0].url.endsWith("/v4/ai/language-model"), fake.calls[0].url);
    assert.equal(fake.calls[0].model, GATEWAY_TEXT_MODEL);
    assert.equal(fake.calls[0].body.maxOutputTokens, 2048);
    assert.equal(fake.calls[0].body.temperature, 0.1);
    assert.deepEqual(fake.calls[0].body.responseFormat, { type: "json" });
    assert.deepEqual(fake.calls[0].body.providerOptions, { gateway: { disallowPromptTraining: true } });
    const prompt = fake.calls[0].body.prompt as Array<Record<string, unknown>>;
    assert.equal(prompt[0].role, "system");
    const userText = (prompt[1].content as Array<Record<string, unknown>>).map((part) => part.text).join("");
    assert.match(userText, /user@example\.test/);
    assert.match(userText, /"language":"pt"/);

    const stored = await jsonBody(await getJson("/api/sessions/repro_session_010", paid.cookie, paid.env));
    assert.ok(isRecord(stored.session) && isRecord(stored.session.reproduction) && isRecord(stored.session.reproduction.generated));
    assert.equal(Array.isArray(stored.session.reproduction.generated.steps) && stored.session.reproduction.generated.steps.length, 4);

    const entitlements = await jsonBody(await getJson("/api/account/entitlements", paid.cookie, paid.env));
    assert.ok(isRecord(entitlements.aiCredits));
    assert.equal(entitlements.aiCredits.balance, 500);
  });

  test("keeps a move that lands between the read and the write (keepPlacement)", async () => {
    // The move is issued by the inference stub itself: it lands after the
    // route read the session and before persistSession writes it back.
    let signed: { cookie: string; env: CloudEnv } | null = null;
    const destination: { id: string | null } = { id: null };
    const env = aiEnv(async () => {
      assert.ok(signed, "the move runs with the signed-in cookie");
      assert.ok(destination.id, "the destination collection exists");
      const move = await postJson("/api/sessions/repro_session_020/move", { collectionId: destination.id }, signed.cookie, signed.env);
      assert.equal(move.status, 200, await move.clone().text());
      return responsesApi(JSON.stringify(GENERATED));
    });
    const paid = await paidProCookie(env);
    signed = paid;
    const project = (await jsonBody(await api("/api/projects", {
      body: JSON.stringify({ name: "Race" }),
      headers: { cookie: paid.cookie, "content-type": "application/json" },
      method: "POST",
    }, paid.env))).project as { id: string };
    destination.id = (await jsonBody(await api(`/api/projects/${project.id}/collections`, {
      body: JSON.stringify({ name: "Target" }),
      headers: { cookie: paid.cookie, "content-type": "application/json" },
      method: "POST",
    }, paid.env))).collection.id as string;
    assert.equal((await uploadCapture(paid.cookie, {
      id: "repro_session_020",
      pins: [{ comment: "The error toast never appears", number: 1, pinId: "pin_repro_20" }],
      reproduction: RECORDING,
    }, paid.env)).status, 201);
    const before = (await jsonBody(await getJson("/api/sessions/repro_session_020", paid.cookie, paid.env))).session as { collectionId?: string };
    assert.notEqual(before.collectionId, destination.id, "the session starts outside the target collection");

    const response = await postJson("/api/ai/reproduction", {
      language: "pt",
      requestId: "repro_request_race_move_01",
      sessionId: "repro_session_020",
    }, paid.cookie, paid.env);

    assert.equal(response.status, 200, await response.clone().text());
    const after = (await jsonBody(await getJson("/api/sessions/repro_session_020", paid.cookie, paid.env))).session as { collectionId?: string; reproduction?: { generated?: { steps?: unknown[] } } };
    assert.equal(after.collectionId, destination.id, "the move that landed during the inference survives the write");
    assert.ok(isRecord(after.reproduction?.generated) && Array.isArray(after.reproduction?.generated.steps));
    assert.equal(after.reproduction?.generated?.steps.length, 4, "the write still persisted the result");
  });

  test("a session deleted between the read and the write answers 404 and is not brought back", async () => {
    // The deletion is issued by the inference stub itself: it lands after
    // the route read the session and before persistSession writes it back.
    let signed: { cookie: string; env: CloudEnv } | null = null;
    const env = aiEnv(async () => {
      assert.ok(signed, "the deletion runs with the signed-in cookie");
      const deleted = await api(`/api/history/repro_session_030`, { headers: { cookie: signed.cookie }, method: "DELETE" }, signed.env);
      assert.equal(deleted.status, 200);
      return responsesApi(JSON.stringify(GENERATED));
    });
    const paid = await paidProCookie(env);
    signed = paid;
    assert.equal((await uploadCapture(paid.cookie, {
      id: "repro_session_030",
      pins: [{ comment: "The error toast never appears", number: 1, pinId: "pin_repro_30" }],
      reproduction: RECORDING,
    }, paid.env)).status, 201);

    const response = await postJson("/api/ai/reproduction", {
      language: "pt",
      requestId: "repro_request_race_delete_01",
      sessionId: "repro_session_030",
    }, paid.cookie, paid.env);

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Session not found" });
    assert.equal((await getJson("/api/sessions/repro_session_030", paid.cookie, paid.env)).status, 404, "the session is not brought back");
  });
});
