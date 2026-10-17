import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeEach, describe, test } from "node:test";
import {
  cloudCaptureFilingMeter,
  resetCloudMemoryStateForTests,
  resolvePrincipal,
  type CloudEnv,
  type Principal,
} from "../cloud-api";
import { createOpenAiCompatibleAi } from "../edger/openai-compatible-ai";
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

  test("generates and persists written steps, charging one credit (A53)", async () => {
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
    assert.equal(first.creditsCharged, 1);
    assert.equal(first.idempotent, false);
    assert.ok(isRecord(first.aiCredits));
    assert.equal(first.aiCredits.balance, 499, "the balance fell one credit");
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
    assert.equal(entitlements.aiCredits.balance, 499);
    // The usage history exposes the reproduction credit (F4d), with the
    // voice, the assistant and the capture filing.
    const history = entitlements.aiUsage as Array<{ credits: number; feature: string; status: string }>;
    assert.deepEqual(history.map((entry) => [entry.feature, entry.status, entry.credits]), [["reproduction", "succeeded", 1]]);
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

  // The credits of the account through the capture filing's meter (A53):
  // each reservation consumes one credit without calling any engine, so a
  // test can spend the balance before it asks for a generation.
  async function drainAiCredits(env: CloudEnv, cookie: string, credits: number) {
    const principal = await resolvePrincipal(
      new Request("https://pinar.test/api/account/entitlements", { headers: { cookie } }),
      env,
    );
    assert.ok(principal);
    for (let i = 0; i < credits; i++) {
      assert.equal(await cloudCaptureFilingMeter(env, principal, `drain_${i}`).reserve("drain"), "reserved");
    }
  }

  test("without enough credits: 402 with the balance and no AI call (A53)", async () => {
    const calls: string[] = [];
    const env = aiEnv(async (model) => {
      calls.push(model);
      return responsesApi(JSON.stringify(GENERATED));
    });
    const paid = await paidProCookie(env);
    assert.equal((await uploadCapture(paid.cookie, {
      id: "repro_session_040",
      pins: [{ comment: "x", number: 1 }],
      reproduction: RECORDING,
    }, paid.env)).status, 201);
    await drainAiCredits(paid.env, paid.cookie, 500);

    const response = await postJson("/api/ai/reproduction", {
      requestId: "repro_request_000040",
      sessionId: "repro_session_040",
    }, paid.cookie, paid.env);
    assert.equal(response.status, 402);
    const body = await jsonBody(response);
    assert.equal(body.code, "insufficient_ai_credits");
    assert.equal(body.creditsRequired, 1);
    assert.ok(isRecord(body.aiCredits));
    assert.equal(body.aiCredits.balance, 0, "the 402 answers with the balance");
    assert.equal(calls.length, 0, "the AI is never called without credits");
    const stored = await jsonBody(await getJson("/api/sessions/repro_session_040", paid.cookie, paid.env));
    const session = stored.session as { reproduction?: { generated?: unknown } };
    assert.ok(isRecord(session.reproduction), "the session and its recording are intact");
    assert.equal("generated" in (session.reproduction as object), false, "nothing persisted");
  });

  test("a repeated request id replays the answer and charges only once (A53)", async () => {
    let calls = 0;
    const env = aiEnv(async () => {
      calls += 1;
      return responsesApi(JSON.stringify(GENERATED));
    });
    const paid = await paidProCookie(env);
    assert.equal((await uploadCapture(paid.cookie, {
      id: "repro_session_050",
      pins: [{ comment: "x", number: 1 }],
      reproduction: RECORDING,
    }, paid.env)).status, 201);

    const first = await postJson("/api/ai/reproduction", {
      requestId: "repro_request_000050",
      sessionId: "repro_session_050",
    }, paid.cookie, paid.env);
    const firstBody = await jsonBody(first);
    assert.equal(first.status, 200);
    assert.equal(firstBody.idempotent, false);

    const replay = await postJson("/api/ai/reproduction", {
      requestId: "repro_request_000050",
      sessionId: "repro_session_050",
    }, paid.cookie, paid.env);
    const replayBody = await jsonBody(replay);
    assert.equal(replay.status, 200);
    assert.equal(replayBody.idempotent, true, "the repeated order replays the stored result");
    assert.equal(replayBody.creditsCharged, 1);
    assert.ok(isRecord(replayBody.result) && Array.isArray(replayBody.result.steps));
    assert.equal(calls, 1, "the AI is called once for the two requests");
    const entitlements = await jsonBody(await getJson("/api/account/entitlements", paid.cookie, paid.env));
    assert.ok(isRecord(entitlements.aiCredits));
    assert.equal(entitlements.aiCredits.balance, 499, "one order, one credit");
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
    assert.equal(body.creditsCharged, 1, "the gateway call charges the same one credit");
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
    assert.equal(entitlements.aiCredits.balance, 499);
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
    // The result was not delivered: the metered gate refunded the credit.
    const entitlements = await jsonBody(await getJson("/api/account/entitlements", paid.cookie, paid.env));
    assert.ok(isRecord(entitlements.aiCredits));
    assert.equal(entitlements.aiCredits.balance, 500, "the 404 gave the credit back");
  });
});

// ---------- appliance chains (F4c): the link's own model and the refusal ----------

interface ApplianceCall {
  model: string;
  url: string;
}

// A fake global fetch for the OpenAI-compatible appliance: the chain builds
// its own adapter with the runtime fetch, so the route reaches this stub. It
// records the model of each call — the form field for the transcription, the
// JSON body for the text.
function fakeAppliance(handler: (url: string, call: ApplianceCall) => Response) {
  const calls: ApplianceCall[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let call: ApplianceCall;
    if (init?.body instanceof FormData) {
      call = { model: String(init.body.get("model") ?? ""), url };
    } else {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      call = { model: String(body.model ?? ""), url };
    }
    calls.push(call);
    return handler(url, call);
  }) as typeof fetch;
  return { calls, fn };
}

async function withAppliance<T>(fake: ReturnType<typeof fakeAppliance>, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = fake.fn;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

// The EdgeR's edgerCloudEnv shape: the AI_BASE_URL/AI_API_KEY pair plus an
// env.AI adapter with the configured models — the adapter whose model used
// to replace the link's model.
function edgeREnv(base: CloudEnv): CloudEnv {
  return {
    ...base,
    AI: createOpenAiCompatibleAi({
      apiKey: "edge-key",
      baseUrl: "https://llm.example.test/v1",
      chatModel: "configured-chat",
      transcriptionModel: "configured-stt",
    }) as unknown as Ai,
    AI_API_KEY: "edge-key",
    AI_BASE_URL: "https://llm.example.test/v1",
    AI_MODEL: "configured-chat",
    AI_TRANSCRIPTION_MODEL: "configured-stt",
  };
}

describe("reproduction appliance chains (F4c)", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
  });

  test("the appliance link sends the link's model, not the EdgeR adapter's configured model", async () => {
    const env = edgeREnv({
      ...TEST_ENV,
      AI_TEXT_CHAIN: "appliance:requested-chat",
    });
    const fake = fakeAppliance((url) => {
      assert.ok(url.endsWith("/chat/completions"), url);
      return Response.json({
        choices: [{ message: { content: JSON.stringify(GENERATED) } }],
        usage: { completion_tokens: 300, prompt_tokens: 900 },
      });
    });
    const paid = await paidProCookie(env, "repro-appliance-model@example.test");
    assert.equal((await uploadCapture(paid.cookie, {
      id: "repro_session_appl_model",
      pins: [{ comment: "The error toast never appears", number: 1, pinId: "pin_repro_appl_model" }],
      reproduction: RECORDING,
    }, paid.env)).status, 201);

    const response = await withAppliance(fake, () => postJson("/api/ai/reproduction", {
      language: "pt",
      requestId: "repro_request_appliance_model_01",
      sessionId: "repro_session_appl_model",
    }, paid.cookie, paid.env));

    assert.equal(response.status, 200, await response.clone().text());
    const body = await jsonBody(response);
    assert.equal(body.ok, true);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].model, "requested-chat", "the link's model crossed, not the configured one");
    const stored = await jsonBody(await getJson("/api/sessions/repro_session_appl_model", paid.cookie, paid.env));
    assert.ok(isRecord(stored.session) && isRecord(stored.session.reproduction) && isRecord(stored.session.reproduction.generated), "the result persisted");
  });

  test("a 401 on the first appliance link ends the chain after one call (refusal)", async () => {
    const env = edgeREnv({
      ...TEST_ENV,
      AI_TEXT_CHAIN: "appliance:requested-chat,appliance:fallback-chat",
    });
    const fake = fakeAppliance((_url, call) => {
      if (call.model === "requested-chat") {
        return Response.json({ error: { message: "invalid key" } }, { status: 401 });
      }
      return Response.json({
        choices: [{ message: { content: JSON.stringify(GENERATED) } }],
        usage: { completion_tokens: 300, prompt_tokens: 900 },
      });
    });
    const paid = await paidProCookie(env, "repro-appliance-401@example.test");
    assert.equal((await uploadCapture(paid.cookie, {
      id: "repro_session_appl_401",
      pins: [{ comment: "The error toast never appears", number: 1, pinId: "pin_repro_appl_401" }],
      reproduction: RECORDING,
    }, paid.env)).status, 201);

    const response = await withAppliance(fake, () => postJson("/api/ai/reproduction", {
      language: "pt",
      requestId: "repro_request_appliance_401_01",
      sessionId: "repro_session_appl_401",
    }, paid.cookie, paid.env));

    assert.equal(response.status, 503);
    const body = await jsonBody(response);
    assert.equal(body.code, "ai_inference_failed");
    // A53: the failed inference gives the credit back with the message.
    assert.equal(body.error, "Reproduction generation unavailable; credit refunded");
    assert.equal(fake.calls.length, 1, "a 401 does not pass to the next link");
    const stored = await jsonBody(await getJson("/api/sessions/repro_session_appl_401", paid.cookie, paid.env));
    assert.ok(isRecord(stored.session));
    const session = stored.session as { reproduction?: Record<string, unknown> };
    assert.ok(isRecord(session.reproduction), "the session and its recording are intact");
    assert.equal("generated" in session.reproduction, false, "nothing persisted");
  });

  test("a 503 on the first appliance link passes to the second and persists its result", async () => {
    const env = edgeREnv({
      ...TEST_ENV,
      AI_TEXT_CHAIN: "appliance:requested-chat,appliance:fallback-chat",
    });
    const fake = fakeAppliance((_url, call) => {
      if (call.model === "requested-chat") {
        return Response.json({ error: { message: "overloaded" } }, { status: 503 });
      }
      return Response.json({
        choices: [{ message: { content: JSON.stringify(GENERATED) } }],
        usage: { completion_tokens: 300, prompt_tokens: 900 },
      });
    });
    const paid = await paidProCookie(env, "repro-appliance-503@example.test");
    assert.equal((await uploadCapture(paid.cookie, {
      id: "repro_session_appl_503",
      pins: [{ comment: "The error toast never appears", number: 1, pinId: "pin_repro_appl_503" }],
      reproduction: RECORDING,
    }, paid.env)).status, 201);

    const response = await withAppliance(fake, () => postJson("/api/ai/reproduction", {
      language: "pt",
      requestId: "repro_request_appliance_503_01",
      sessionId: "repro_session_appl_503",
    }, paid.cookie, paid.env));

    assert.equal(response.status, 200, await response.clone().text());
    const body = await jsonBody(response);
    assert.equal(body.ok, true);
    assert.equal(fake.calls.length, 2);
    assert.equal(fake.calls[0].model, "requested-chat");
    assert.equal(fake.calls[1].model, "fallback-chat");
    const stored = await jsonBody(await getJson("/api/sessions/repro_session_appl_503", paid.cookie, paid.env));
    assert.ok(isRecord(stored.session) && isRecord(stored.session.reproduction) && isRecord(stored.session.reproduction.generated), "the fallback's result persisted");
  });
});

// ---------- A53 on D1: the credit ledger of the written steps ----------

const D1_NOW = "2026-10-17T12:00:00.000Z";
const D1_OWNER = "usr_repro_d1";

// The SQLite-as-D1 shim, same model as cloud-mcp.test.ts: one connection,
// batches serialized, `run` returns D1's meta.changes.
function d1Shim(db: Database): NonNullable<CloudEnv["DB"]> {
  let batches: Promise<unknown> = Promise.resolve();
  const statement = (query: string) => {
    let params: unknown[] = [];
    const bound = {
      async all() {
        return { results: db.query(query).all(...params) as Record<string, unknown>[] };
      },
      bind(...values: unknown[]) {
        params = values.map((value) => value === undefined ? null : value);
        return bound;
      },
      async first() {
        return (db.query(query).get(...params) as Record<string, unknown> | null) ?? null;
      },
      async run() {
        db.query(query).run(...params);
        const changes = db.query("SELECT changes() AS changes").get() as { changes: number };
        return { meta: { changes: changes.changes } };
      },
    };
    return bound;
  };
  return {
    batch(statements) {
      const work = batches.then(async () => {
        db.exec("BEGIN");
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          db.exec("COMMIT");
          return results;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      });
      batches = work.catch(() => {});
      return work;
    },
    prepare(query: string) {
      return statement(query);
    },
  };
}

function migratedD1() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return db;
}

async function d1Cookie(db: Database, env: CloudEnv) {
  db.query(
    "INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, 'pro', 1, 'active', ?, ?)",
  ).run(D1_OWNER, `${D1_OWNER}@example.test`, D1_NOW, D1_NOW);
  const { seedCloudWebSessionForTests } = await import("../cloud-api");
  return (await seedCloudWebSessionForTests({ email: `${D1_OWNER}@example.test`, id: D1_OWNER, plan: "pro" }, env)).cookie;
}

const d1Balance = (db: Database) =>
  (db.query("SELECT COALESCE(SUM(credits - consumed_credits), 0) AS balance FROM ai_credit_grants WHERE owner_id = ?").get(D1_OWNER) as { balance: number }).balance;

describe("POST /api/ai/reproduction on D1 (A53)", () => {
  test("a success stores the usage as succeeded and the balance falls one credit", async () => {
    const db = migratedD1();
    try {
      const env: CloudEnv = {
        ...TEST_ENV,
        DB: d1Shim(db),
        AI: { run: async () => responsesApi(JSON.stringify(GENERATED)) } as unknown as Ai,
      };
      const cookie = await d1Cookie(db, env);
      assert.equal((await uploadCapture(cookie, {
        id: "repro_d1_001",
        pins: [{ comment: "x", number: 1 }],
        reproduction: RECORDING,
      }, env)).status, 201);

      const response = await postJson("/api/ai/reproduction", {
        requestId: "repro_d1_request_0001",
        sessionId: "repro_d1_001",
      }, cookie, env);
      const body = await jsonBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.creditsCharged, 1);
      assert.ok(isRecord(body.aiCredits));
      assert.equal(body.aiCredits.balance, 499);
      assert.equal(d1Balance(db), 499);
      const [usage] = db.query("SELECT * FROM ai_credit_usages WHERE request_id = ?").all("repro_d1_request_0001") as Array<{ feature: string; status: string; credits: number }>;
      assert.deepEqual([usage.feature, usage.status, usage.credits], ["reproduction", "succeeded", 1]);
      // The usage history exposes the reproduction credit (F4d), read
      // through the entitlements endpoint.
      const entitlements = await jsonBody(await getJson("/api/account/entitlements", cookie, env));
      const history = entitlements.aiUsage as Array<{ credits: number; feature: string; status: string }>;
      assert.deepEqual(history.map((entry) => [entry.feature, entry.status, entry.credits]), [["reproduction", "succeeded", 1]]);
    } finally {
      db.close();
    }
  });

  test("an invalid answer refunds the credit and leaves no persisted result", async () => {
    const db = migratedD1();
    try {
      const env: CloudEnv = {
        ...TEST_ENV,
        DB: d1Shim(db),
        AI: { run: async () => "not json at all" } as unknown as Ai,
      };
      const cookie = await d1Cookie(db, env);
      assert.equal((await uploadCapture(cookie, {
        id: "repro_d1_002",
        pins: [{ comment: "x", number: 1 }],
        reproduction: RECORDING,
      }, env)).status, 201);

      const response = await postJson("/api/ai/reproduction", {
        requestId: "repro_d1_request_0002",
        sessionId: "repro_d1_002",
      }, cookie, env);
      const body = await jsonBody(response);
      assert.equal(response.status, 503);
      assert.equal(body.code, "invalid_ai_response");
      assert.equal(d1Balance(db), 500, "the refund gave the credit back");
      const [usage] = db.query("SELECT * FROM ai_credit_usages WHERE request_id = ?").all("repro_d1_request_0002") as Array<{ status: string; error_code: string }>;
      assert.deepEqual([usage.status, usage.error_code], ["refunded", "invalid_ai_response"]);
    } finally {
      db.close();
    }
  });

  test("without enough credits: 402 with the balance, no usage row and no AI call", async () => {
    let calls = 0;
    const db = migratedD1();
    try {
      const env: CloudEnv = {
        ...TEST_ENV,
        DB: d1Shim(db),
        AI: {
          run: async () => {
            calls += 1;
            return responsesApi(JSON.stringify(GENERATED));
          },
        } as unknown as Ai,
      };
      const cookie = await d1Cookie(db, env);
      assert.equal((await uploadCapture(cookie, {
        id: "repro_d1_003",
        pins: [{ comment: "x", number: 1 }],
        reproduction: RECORDING,
      }, env)).status, 201);
      // The first generation seeds the pro grant and spends one credit...
      assert.equal((await postJson("/api/ai/reproduction", {
        requestId: "repro_d1_request_0003",
        sessionId: "repro_d1_003",
      }, cookie, env)).status, 200);
      // ...and the next one spends nothing and answers 402: the balance is 0.
      db.query("UPDATE ai_credit_grants SET consumed_credits = credits WHERE owner_id = ?").run(D1_OWNER);
      assert.equal(calls, 1);

      const response = await postJson("/api/ai/reproduction", {
        requestId: "repro_d1_request_0004",
        sessionId: "repro_d1_003",
      }, cookie, env);
      const body = await jsonBody(response);
      assert.equal(response.status, 402);
      assert.equal(body.code, "insufficient_ai_credits");
      assert.equal(body.creditsRequired, 1);
      assert.ok(isRecord(body.aiCredits));
      assert.equal(body.aiCredits.balance, 0);
      assert.equal(calls, 1, "the AI is never called without credits");
      assert.equal((db.query("SELECT COUNT(*) AS n FROM ai_credit_usages WHERE request_id = ?").get("repro_d1_request_0004") as { n: number }).n, 0);
      assert.equal(d1Balance(db), 0);
    } finally {
      db.close();
    }
  });

  test("a repeated request id replays the answer and stores one usage row", async () => {
    let calls = 0;
    const db = migratedD1();
    try {
      const env: CloudEnv = {
        ...TEST_ENV,
        DB: d1Shim(db),
        AI: {
          run: async () => {
            calls += 1;
            return responsesApi(JSON.stringify(GENERATED));
          },
        } as unknown as Ai,
      };
      const cookie = await d1Cookie(db, env);
      assert.equal((await uploadCapture(cookie, {
        id: "repro_d1_004",
        pins: [{ comment: "x", number: 1 }],
        reproduction: RECORDING,
      }, env)).status, 201);

      const first = await postJson("/api/ai/reproduction", {
        requestId: "repro_d1_request_0005",
        sessionId: "repro_d1_004",
      }, cookie, env);
      assert.equal(first.status, 200);
      const replay = await postJson("/api/ai/reproduction", {
        requestId: "repro_d1_request_0005",
        sessionId: "repro_d1_004",
      }, cookie, env);
      const replayBody = await jsonBody(replay);
      assert.equal(replay.status, 200);
      assert.equal(replayBody.idempotent, true);
      assert.equal(calls, 1, "the AI is called once for the two requests");
      assert.equal(d1Balance(db), 499, "one order, one credit");
      const rows = db.query("SELECT * FROM ai_credit_usages WHERE request_id = ?").all("repro_d1_request_0005") as Array<{ status: string; credits: number }>;
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].status, rows[0].credits], ["succeeded", 1]);
    } finally {
      db.close();
    }
  });

  test("a failed settlement (the succeeded transition) refunds, delivers nothing, and the refunded order does not pay again (F4d)", async () => {
    const db = migratedD1();
    try {
      // The reviewer's probe shape: the failure is injected only on the
      // usage's transition to succeeded, with real SQLite.
      db.exec(`CREATE TRIGGER repro_settle_fail BEFORE UPDATE OF status ON ai_credit_usages
        WHEN NEW.status = 'succeeded'
        BEGIN SELECT RAISE(ABORT, 'injected settlement failure'); END;`);
      const env: CloudEnv = {
        ...TEST_ENV,
        DB: d1Shim(db),
        AI: { run: async () => responsesApi(JSON.stringify(GENERATED)) } as unknown as Ai,
      };
      const cookie = await d1Cookie(db, env);
      assert.equal((await uploadCapture(cookie, {
        id: "repro_d1_settle",
        pins: [{ comment: "x", number: 1 }],
        reproduction: RECORDING,
      }, env)).status, 201);

      const response = await postJson("/api/ai/reproduction", {
        requestId: "repro_d1_request_settle",
        sessionId: "repro_d1_settle",
      }, cookie, env);
      const body = await jsonBody(response);
      assert.equal(response.status, 503);
      assert.equal(body.code, "ai_inference_failed");
      assert.equal(body.error, "Reproduction generation unavailable; credit refunded");
      assert.equal(d1Balance(db), 500, "the settlement failure gave the credit back");
      const stored = (await jsonBody(await getJson("/api/sessions/repro_d1_settle", cookie, env))).session as { reproduction: Record<string, unknown> };
      assert.ok(isRecord(stored.reproduction), "the session and its recording are intact");
      assert.equal("generated" in stored.reproduction, false, "the result was never persisted");
      const [usage] = db.query("SELECT * FROM ai_credit_usages WHERE request_id = ?").all("repro_d1_request_settle") as Array<{ status: string; error_code: string; result_json: string | null }>;
      assert.deepEqual([usage.status, usage.error_code], ["refunded", "ai_inference_failed"]);
      assert.equal(usage.result_json, null);

      // F4d: a refund is not a payment. The refunded order (same requestId)
      // does not pay again — it answers 503 without the AI and without a
      // charge, whatever the engine would now do.
      db.exec("DROP TRIGGER repro_settle_fail");
      const retry = await postJson("/api/ai/reproduction", {
        requestId: "repro_d1_request_settle",
        sessionId: "repro_d1_settle",
      }, cookie, env);
      const retryBody = await jsonBody(retry);
      assert.equal(retry.status, 503, "the refunded order is not a new payment");
      assert.equal(retryBody.code, "ai_request_refunded");
      assert.equal(d1Balance(db), 500, "no new charge for the refunded order");

      // A new order (a fresh requestId) is a new payment: one credit, the
      // result persisted.
      const fresh = await postJson("/api/ai/reproduction", {
        requestId: "repro_d1_request_settle_fresh",
        sessionId: "repro_d1_settle",
      }, cookie, env);
      assert.equal(fresh.status, 200, await fresh.clone().text());
      const freshBody = await jsonBody(fresh);
      assert.equal(freshBody.idempotent, false, "the new order is a new run");
      assert.equal(d1Balance(db), 499, "the new order consumed the credit");
      const storedRetry = (await jsonBody(await getJson("/api/sessions/repro_d1_settle", cookie, env))).session as { reproduction: { generated?: { steps?: unknown[] } } };
      assert.equal(Array.isArray(storedRetry.reproduction.generated?.steps), true, "the new order persisted the result");
      const rows = db.query("SELECT * FROM ai_credit_usages ORDER BY created_at").all() as Array<{ request_id: string; status: string; credits: number }>;
      assert.deepEqual(rows.map((row) => [row.request_id, row.status, row.credits]), [
        ["repro_d1_request_settle", "refunded", 1],
        ["repro_d1_request_settle_fresh", "succeeded", 1],
      ], "one row per order; the refunded one is not re-charged");
    } finally {
      db.close();
    }
  });

  test("a balance read that fails after the result is persisted preserves the debit (F4d round 2)", async () => {
    const db = migratedD1();
    db.exec("CREATE TABLE post_save_flag (value INTEGER)");
    try {
      // A real SQLite UPDATE trigger marks the moment the generated steps
      // are persisted; the answer's balance read then fails once.
      db.exec("CREATE TRIGGER post_save_flagged AFTER UPDATE ON sessions WHEN NEW.id = 'repro_d1_post_save' BEGIN INSERT INTO post_save_flag VALUES (1); END;");
      const base = d1Shim(db);
      const env: CloudEnv = {
        ...TEST_ENV,
        DB: {
          ...base,
          prepare(query: string) {
            const flagged = (db.query("SELECT COUNT(*) AS count FROM post_save_flag").get() as { count: number }).count > 0;
            if (flagged && query.includes("AS balance") && query.includes("ai_credit_grants")) {
              throw new Error("injected_post_save_balance_error");
            }
            return base.prepare(query);
          },
        } as unknown as NonNullable<CloudEnv["DB"]>,
        AI: { run: async () => responsesApi(JSON.stringify(GENERATED)) } as unknown as Ai,
      };
      const cookie = await d1Cookie(db, env);
      assert.equal((await uploadCapture(cookie, {
        id: "repro_d1_post_save",
        pins: [{ comment: "x", number: 1 }],
        reproduction: RECORDING,
      }, env)).status, 201);

      const response = await postJson("/api/ai/reproduction", {
        requestId: "repro_d1_request_post_save",
        sessionId: "repro_d1_post_save",
      }, cookie, env);
      const body = await jsonBody(response);
      // The steps were persisted before the balance read failed: the debit
      // is preserved and the answer is 200 with the result and no balance.
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.ok, true);
      assert.equal(body.aiCredits, null, "the auxiliary balance read failed: the balance is absent");
      assert.equal(d1Balance(db), 499, "the persisted result keeps its debit");
      const [usage] = db.query("SELECT * FROM ai_credit_usages WHERE request_id = ?").all("repro_d1_request_post_save") as Array<{ status: string }>;
      assert.equal(usage.status, "succeeded", "the usage was not refunded after the save");
      const stored = (await jsonBody(await getJson("/api/sessions/repro_d1_post_save", cookie, env))).session as { reproduction: { generated?: { steps?: unknown[] } } };
      assert.equal(Array.isArray(stored.reproduction.generated?.steps), true, "the GET delivers the persisted steps");
    } finally {
      db.close();
    }
  });

  test("a session deleted after the settlement answers 404 and the consumed credit goes back (F4d)", async () => {
    const db = migratedD1();
    try {
      let signed: string | null = null;
      const env: CloudEnv = {
        ...TEST_ENV,
        DB: d1Shim(db),
        AI: {
          run: async () => {
            const deleted = await api(`/api/history/repro_d1_404`, { headers: { cookie: signed! }, method: "DELETE" }, env);
            assert.equal(deleted.status, 200);
            return responsesApi(JSON.stringify(GENERATED));
          },
        } as unknown as Ai,
      };
      const cookie = await d1Cookie(db, env);
      signed = cookie;
      assert.equal((await uploadCapture(cookie, {
        id: "repro_d1_404",
        pins: [{ comment: "x", number: 1 }],
        reproduction: RECORDING,
      }, env)).status, 201);

      const response = await postJson("/api/ai/reproduction", {
        requestId: "repro_d1_request_404",
        sessionId: "repro_d1_404",
      }, cookie, env);
      assert.equal(response.status, 404, await response.clone().text());
      assert.equal(d1Balance(db), 500, "the consumed credit went back with the 404");
      const [usage] = db.query("SELECT * FROM ai_credit_usages WHERE request_id = ?").all("repro_d1_request_404") as Array<{ status: string; error_code: string }>;
      assert.deepEqual([usage.status, usage.error_code], ["refunded", "ai_result_not_stored"], "the succeeded transition was refunded");
    } finally {
      db.close();
    }
  });
});
