import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import {
  aiEnv,
  api,
  getJson,
  isRecord,
  jsonBody,
  paidProCookie,
  TEST_ENV,
} from "../../../tests/helpers/cloud-ai";
import { resetCloudMemoryStateForTests, type CloudEnv } from "../cloud-api";
import { voicePinStructuringInstructions } from "./voice-pin";

const TRANSCRIPTION_MODEL = "@cf/openai/whisper-large-v3-turbo";
const STRUCTURING_MODEL = "@cf/openai/gpt-oss-20b";

function voiceForm(requestId: string, durationSeconds = 30) {
  const form = new FormData();
  form.set("requestId", requestId);
  form.set("durationSeconds", String(durationSeconds));
  form.set("language", "pt");
  form.set("audio", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" }), "pin.webm");
  return form;
}

async function credits(cookie: string, env: Parameters<typeof getJson>[2]) {
  const body = await jsonBody(await getJson("/api/account/entitlements", cookie, env));
  assert.ok(isRecord(body.aiCredits));
  return body.aiCredits.balance;
}

describe("POST /api/ai/voice-pin", () => {
  beforeEach(() => resetCloudMemoryStateForTests());

  test("returns the raw transcription by default without a second AI call", async () => {
    const calls: Array<{ input: unknown; model: string }> = [];
    const transcript = "É, tipo, o botão precisa ficar alinhado.";
    const env = aiEnv(async (model, input) => {
      calls.push({ input, model });
      return { text: transcript, transcription_info: { duration: 30, language: "pt" } };
    });
    const paid = await paidProCookie(env);

    const response = await api("/api/ai/voice-pin", {
      body: voiceForm("voice_request_raw_default_01"),
      headers: { cookie: paid.cookie },
      method: "POST",
    }, paid.env);

    assert.equal(response.status, 200, await response.clone().text());
    const body = await jsonBody(response);
    assert.ok(isRecord(body.result));
    assert.equal(body.result.transcript, transcript);
    assert.equal(body.result.comment, transcript);
    assert.deepEqual(body.result.acceptanceCriteria, []);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, TRANSCRIPTION_MODEL);
    assert.ok(isRecord(calls[0].input));
    assert.ok(isRecord(calls[0].input.audio));
    assert.match(String(calls[0].input.audio.contentType), /^(?:audio|video)\/webm$/);
    assert.ok(calls[0].input.audio.body instanceof ReadableStream);
  });

  test("removes disfluencies when cloud post-processing is enabled while preserving the raw transcript", async () => {
    const calls: Array<{ input: unknown; model: string }> = [];
    const env = aiEnv(async (model, input) => {
      calls.push({ input, model });
      if (model === TRANSCRIPTION_MODEL) {
        return {
          text: "É, tipo, o botão, o botão precisa... quer dizer, deve ficar alinhado com o título e manter oito pixels, né, de espaço.",
          transcription_info: { duration: 30, language: "pt" },
        };
      }
      assert.equal(model, STRUCTURING_MODEL);
      return {
        output: [{ content: [{ text: JSON.stringify({
          acceptanceCriteria: ["O espaço entre o título e o botão é de 8 px."],
          comment: "Alinhe o botão ao título e mantenha 8 px de espaço.",
        }), type: "output_text" }], type: "message" }],
        usage: { input_tokens: 42, output_tokens: 28 },
      };
    });
    const paid = await paidProCookie(env);
    const preferenceResponse = await api("/api/preferences", {
      body: JSON.stringify({ voicePostProcessing: true }),
      headers: { cookie: paid.cookie, "content-type": "application/json" },
      method: "PATCH",
    }, paid.env);
    assert.equal(preferenceResponse.status, 200);

    const response = await api("/api/ai/voice-pin", {
      body: voiceForm("voice_request_success_01"),
      headers: { cookie: paid.cookie },
      method: "POST",
    }, paid.env);

    assert.equal(response.status, 200, await response.clone().text());
    const body = await jsonBody(response);
    assert.equal(body.creditsCharged, 1);
    assert.equal(body.idempotent, false);
    assert.ok(isRecord(body.result));
    assert.equal(body.result.transcript, "É, tipo, o botão, o botão precisa... quer dizer, deve ficar alinhado com o título e manter oito pixels, né, de espaço.");
    assert.equal(body.result.comment, "Alinhe o botão ao título e mantenha 8 px de espaço.");
    assert.equal(body.result.detectedLanguage, "pt");
    assert.equal(JSON.stringify(body).includes("AQIDBA=="), false);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].model, TRANSCRIPTION_MODEL);
    assert.ok(isRecord(calls[0].input));
    assert.ok(isRecord(calls[0].input.audio));
    assert.match(String(calls[0].input.audio.contentType), /^(?:audio|video)\/webm$/);
    assert.equal(calls[1].model, STRUCTURING_MODEL);
    assert.ok(isRecord(calls[1].input));
    assert.match(String(calls[1].input.instructions), /remove stutters, filler words, repeated fragments, false starts/);
    assert.match(String(calls[1].input.instructions), /prefer the final correction/);
    assert.match(String(calls[1].input.instructions), /preserving concrete details, negations, numbers, conditions, and constraints/);
    assert.match(String(calls[1].input.input), /quer dizer, deve ficar alinhado/);
    assert.equal(await credits(paid.cookie, paid.env), 499);
  });

  test("guards intent recovery against guessing and lost constraints", () => {
    const instructions = voicePinStructuringInstructions();
    assert.match(instructions, /If intent remains ambiguous, state the ambiguity concisely instead of guessing/);
    assert.match(instructions, /Do not remove repetition that is clearly intentional/);
    assert.match(instructions, /Do not turn uncertainty into certainty or invent requirements/);
  });

  test("charges one credit through 60 seconds and two credits from 61 through 120 seconds", async () => {
    const env = aiEnv(async () => ({
      text: "Ajuste o alinhamento.",
      transcription_info: { language: "pt" },
    }));
    const paid = await paidProCookie(env);

    const oneMinute = await jsonBody(await api("/api/ai/voice-pin", {
      body: voiceForm("voice_request_boundary_60", 60),
      headers: { cookie: paid.cookie },
      method: "POST",
    }, paid.env));
    const overOneMinute = await jsonBody(await api("/api/ai/voice-pin", {
      body: voiceForm("voice_request_boundary_61", 61),
      headers: { cookie: paid.cookie },
      method: "POST",
    }, paid.env));

    assert.equal(oneMinute.creditsCharged, 1);
    assert.equal(overOneMinute.creditsCharged, 2);
    assert.equal(await credits(paid.cookie, paid.env), 497);
  });

  test("charges proportionally by started minute and replays idempotently", async () => {
    let callCount = 0;
    const env = aiEnv(async (model) => {
      callCount += 1;
      if (model === TRANSCRIPTION_MODEL) {
        return { text: "Aumente o contraste.", transcription_info: { duration: 90, language: "pt" } };
      }
      return {
        output: [{ content: [{ text: '{"comment":"Aumente o contraste.","acceptanceCriteria":[]}', type: "output_text" }], type: "message" }],
        usage: { input_tokens: 12, output_tokens: 10 },
      };
    });
    const paid = await paidProCookie(env);
    const request = () => api("/api/ai/voice-pin", {
      body: voiceForm("voice_request_idempotent_01", 90),
      headers: { cookie: paid.cookie },
      method: "POST",
    }, paid.env);

    const first = await jsonBody(await request());
    const replay = await jsonBody(await request());

    assert.equal(first.creditsCharged, 2);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.creditsCharged, 2);
    assert.equal(callCount, 1);
    assert.equal(await credits(paid.cookie, paid.env), 498);
  });

  test("refunds the reserved credit when transcription fails", async () => {
    const env = aiEnv(async () => { throw new Error("provider unavailable"); });
    const paid = await paidProCookie(env);

    const response = await api("/api/ai/voice-pin", {
      body: voiceForm("voice_request_failure_01"),
      headers: { cookie: paid.cookie },
      method: "POST",
    }, paid.env);

    assert.equal(response.status, 503);
    const body = await jsonBody(response);
    assert.equal(body.code, "ai_inference_failed");
    assert.match(String(body.error), /credit refunded/);
    assert.equal(await credits(paid.cookie, paid.env), 500);
  });

  test("rejects clips longer than two minutes before inference", async () => {
    let called = false;
    const env = aiEnv(async () => { called = true; return {}; });
    const paid = await paidProCookie(env);

    const response = await api("/api/ai/voice-pin", {
      body: voiceForm("voice_request_too_long_01", 121),
      headers: { cookie: paid.cookie },
      method: "POST",
    }, paid.env);

    assert.equal(response.status, 400);
    assert.equal((await jsonBody(response)).code, "invalid_audio_duration");
    assert.equal(called, false);
    assert.equal(await credits(paid.cookie, paid.env), 500);
  });
});

// ---------- AI_TRANSCRIPTION_CHAIN / AI_TEXT_CHAIN (D5) ----------

const GATEWAY_STT_A = "spacexai/grok-stt";
const GATEWAY_STT_B = "openai/gpt-4o-transcribe";
const GATEWAY_TEXT_MODEL = "anthropic/claude-haiku-5.5";
const GATEWAY_KEY = "sk-voice-gateway-test";

interface GatewayCall {
  body: Record<string, unknown>;
  model: string;
  url: string;
}

// A fake global fetch for the Vercel AI Gateway: the chains build the
// provider with the runtime fetch, so the routes reach this stub. It
// answers by endpoint (transcription-model / language-model) and by the
// model's header.
function fakeGateway(replies: Record<string, () => Response>) {
  const calls: GatewayCall[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const model = headers.get("ai-model-id") ?? headers.get("ai-language-model-id") ?? "";
    const call: GatewayCall = { body, model, url };
    calls.push(call);
    const kind = url.includes("/transcription-model") ? "transcription" : "text";
    const reply = replies[`${kind}:${model}`];
    if (!reply) throw new Error(`fake gateway: no reply for ${kind}:${model}`);
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

describe("voice chains (D5)", () => {
  beforeEach(() => resetCloudMemoryStateForTests());

  test("transcribes through the AI_TRANSCRIPTION_CHAIN gateway links with the privacy options and the reported cost", async () => {
    const transcript = "O botão precisa ficar alinhado com o título.";
    const env: CloudEnv = {
      ...TEST_ENV,
      AI_GATEWAY_API_KEY: GATEWAY_KEY,
      AI_TRANSCRIPTION_CHAIN: `gateway:${GATEWAY_STT_A},gateway:${GATEWAY_STT_B}`,
    };
    const fake = fakeGateway({
      [`transcription:${GATEWAY_STT_A}`]: () => Response.json({
        durationInSeconds: 30,
        language: "pt",
        providerMetadata: { gateway: { cost: "0", marketCost: "0.000123" } },
        text: transcript,
      }),
    });
    const paid = await paidProCookie(env);

    const response = await withGateway(fake, () => api("/api/ai/voice-pin", {
      body: voiceForm("voice_request_chain_01"),
      headers: { cookie: paid.cookie },
      method: "POST",
    }, paid.env));

    assert.equal(response.status, 200, await response.clone().text());
    const body = await jsonBody(response);
    assert.equal(body.creditsCharged, 1, "the credits are the ones of today");
    assert.ok(isRecord(body.result));
    assert.equal(body.result.transcript, transcript);
    assert.equal(body.result.detectedLanguage, "pt");
    assert.ok(isRecord(body.usage));
    assert.equal(body.usage.costUsdMicros, 123, "the cost comes from marketCost");
    assert.equal(fake.calls.length, 1, "the first link answers");
    assert.ok(fake.calls[0].url.endsWith("/v4/ai/transcription-model"), fake.calls[0].url);
    assert.equal(fake.calls[0].model, GATEWAY_STT_A);
    assert.equal(fake.calls[0].body.audio, "AQIDBA==", "the clip crossed to the link");
    assert.deepEqual(fake.calls[0].body.providerOptions, { gateway: { disallowPromptTraining: true } });
    assert.equal(await credits(paid.cookie, paid.env), 499);
  });

  test("a transient 503 on the first gateway link passes to the next and uses its result", async () => {
    const env: CloudEnv = {
      ...TEST_ENV,
      AI_GATEWAY_API_KEY: GATEWAY_KEY,
      AI_TRANSCRIPTION_CHAIN: `gateway:${GATEWAY_STT_A},gateway:${GATEWAY_STT_B}`,
    };
    const fake = fakeGateway({
      [`transcription:${GATEWAY_STT_A}`]: () => Response.json(
        { error: { message: "overloaded", type: "server_error" } },
        { status: 503 },
      ),
      [`transcription:${GATEWAY_STT_B}`]: () => Response.json({
        durationInSeconds: 30,
        language: "pt",
        providerMetadata: { gateway: { cost: "0", marketCost: "0.0002" } },
        text: "Alinhe o botão com o título.",
      }),
    });
    const paid = await paidProCookie(env);

    const response = await withGateway(fake, () => api("/api/ai/voice-pin", {
      body: voiceForm("voice_request_chain_02"),
      headers: { cookie: paid.cookie },
      method: "POST",
    }, paid.env));

    assert.equal(response.status, 200, await response.clone().text());
    const body = await jsonBody(response);
    assert.ok(isRecord(body.result));
    assert.equal(body.result.transcript, "Alinhe o botão com o título.");
    assert.ok(isRecord(body.usage));
    assert.equal(body.usage.costUsdMicros, 200, "the cost is the one the answerer reported");
    assert.equal(fake.calls.length, 2);
    assert.equal(fake.calls[0].model, GATEWAY_STT_A);
    assert.equal(fake.calls[1].model, GATEWAY_STT_B);
    assert.equal(await credits(paid.cookie, paid.env), 499, "one call, one credit");
  });

  test("a 401 on a gateway link ends the chain and refunds the credit", async () => {
    const env: CloudEnv = {
      ...TEST_ENV,
      AI_GATEWAY_API_KEY: GATEWAY_KEY,
      AI_TRANSCRIPTION_CHAIN: `gateway:${GATEWAY_STT_A},gateway:${GATEWAY_STT_B}`,
    };
    const fake = fakeGateway({
      [`transcription:${GATEWAY_STT_A}`]: () => Response.json(
        { error: { message: "invalid key", type: "authentication_error" } },
        { status: 401 },
      ),
    });
    const paid = await paidProCookie(env);

    const response = await withGateway(fake, () => api("/api/ai/voice-pin", {
      body: voiceForm("voice_request_chain_03"),
      headers: { cookie: paid.cookie },
      method: "POST",
    }, paid.env));

    assert.equal(response.status, 503);
    const body = await jsonBody(response);
    assert.equal(body.code, "ai_inference_failed");
    assert.match(String(body.error), /credit refunded/);
    assert.equal(fake.calls.length, 1, "a 401 does not pass to the next link");
    assert.equal(await credits(paid.cookie, paid.env), 500);
  });

  test("structures the note through the AI_TEXT_CHAIN gateway link while the binding transcribes", async () => {
    const structured = JSON.stringify({
      acceptanceCriteria: ["Espaço de 8 px entre o título e o botão."],
      comment: "Alinhe o botão ao título e mantenha 8 px de espaço.",
    });
    const base: CloudEnv = {
      ...TEST_ENV,
      AI_GATEWAY_API_KEY: GATEWAY_KEY,
      AI_TEXT_CHAIN: `gateway:${GATEWAY_TEXT_MODEL}`,
    };
    const bindingCalls: Array<{ input: unknown; model: string }> = [];
    const env = aiEnv(async (model, input) => {
      bindingCalls.push({ input, model });
      return {
        text: "É, o botão precisa ficar alinhado, quer dizer, com oito pixels de espaço.",
        transcription_info: { duration: 30, language: "pt" },
      };
    }, base);
    const fake = fakeGateway({
      [`text:${GATEWAY_TEXT_MODEL}`]: () => Response.json({
        content: [{ text: structured, type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        providerMetadata: { gateway: { cost: "0", marketCost: "0.0000100" } },
        usage: {
          inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 120, total: 120 },
          outputTokens: { reasoning: 0, text: 40, total: 40 },
        },
        warnings: [],
      }),
    });
    const paid = await paidProCookie(env);
    const preference = await api("/api/preferences", {
      body: JSON.stringify({ voicePostProcessing: true }),
      headers: { cookie: paid.cookie, "content-type": "application/json" },
      method: "PATCH",
    }, paid.env);
    assert.equal(preference.status, 200);

    const response = await withGateway(fake, () => api("/api/ai/voice-pin", {
      body: voiceForm("voice_request_chain_04"),
      headers: { cookie: paid.cookie },
      method: "POST",
    }, paid.env));

    assert.equal(response.status, 200, await response.clone().text());
    const body = await jsonBody(response);
    assert.equal(body.creditsCharged, 1);
    assert.ok(isRecord(body.result));
    assert.equal(body.result.comment, "Alinhe o botão ao título e mantenha 8 px de espaço.");
    assert.equal(body.result.detectedLanguage, "pt");
    assert.equal(bindingCalls.length, 1, "the transcription stayed on the binding");
    assert.equal(bindingCalls[0].model, TRANSCRIPTION_MODEL);
    assert.equal(fake.calls.length, 1, "the structuring went through the gateway link");
    assert.ok(fake.calls[0].url.endsWith("/v4/ai/language-model"), fake.calls[0].url);
    assert.equal(fake.calls[0].model, GATEWAY_TEXT_MODEL);
    assert.equal(fake.calls[0].body.maxOutputTokens, 768);
    assert.deepEqual(fake.calls[0].body.providerOptions, { gateway: { disallowPromptTraining: true } });
    const prompt = fake.calls[0].body.prompt as Array<Record<string, unknown>>;
    assert.equal(prompt[0].role, "system");
    assert.ok((prompt[1].content as Array<Record<string, unknown>>).some((part) => String(part.text).includes("quer dizer")));
    assert.ok(isRecord(body.usage));
    // The binding's transcription (estimated) plus the link's reported cost.
    assert.equal(body.usage.costUsdMicros, Math.ceil(30 / 60 * 513) + 10);
    assert.equal(body.usage.inputTokens, 120, "the link's usage crossed");
    assert.equal(body.usage.outputTokens, 40);
  });

  test("sends zeroDataRetention only when AI_GATEWAY_ZERO_DATA_RETENTION is \"true\"", async () => {
    const makeEnv = (value?: string): CloudEnv => ({
      ...TEST_ENV,
      AI_GATEWAY_API_KEY: GATEWAY_KEY,
      AI_TRANSCRIPTION_CHAIN: `gateway:${GATEWAY_STT_A}`,
      ...(value !== undefined ? { AI_GATEWAY_ZERO_DATA_RETENTION: value } : {}),
    });
    const cases: Array<[value: string | undefined, expected: boolean]> = [
      [undefined, false],
      ["false", false],
      ["true", true],
    ];
    for (const [value, expected] of cases) {
      const env = makeEnv(value);
      const fake = fakeGateway({
        [`transcription:${GATEWAY_STT_A}`]: () => Response.json({ durationInSeconds: 30, language: "pt", text: "ok." }),
      });
      const paid = await paidProCookie(env);
      const response = await withGateway(fake, () => api("/api/ai/voice-pin", {
        body: voiceForm(`voice_request_zdr_${value ?? "none"}_01`),
        headers: { cookie: paid.cookie },
        method: "POST",
      }, paid.env));
      assert.equal(response.status, 200, await response.clone().text());
      const options = fake.calls[0].body.providerOptions as Record<string, unknown>;
      const gatewayOptions = options.gateway as Record<string, unknown>;
      assert.equal(gatewayOptions.disallowPromptTraining, true, `disallowPromptTraining is always sent (${value ?? "absent"})`);
      assert.equal("zeroDataRetention" in gatewayOptions, expected, `zeroDataRetention only when \"true\" (${value ?? "absent"})`);
    }
  });

  test("keeps the routes and hasAi without the AI binding while a chain is configured and usable", async () => {
    const withChain: CloudEnv = {
      ...TEST_ENV,
      AI_GATEWAY_API_KEY: GATEWAY_KEY,
      AI_TRANSCRIPTION_CHAIN: `gateway:${GATEWAY_STT_A}`,
    };
    assert.equal((await jsonBody(await api("/api/health", {}, withChain))).hasAi, true);

    const none: CloudEnv = { ...TEST_ENV };
    assert.equal((await jsonBody(await api("/api/health", {}, none))).hasAi, false);

    // A chain without the gateway key is not usable: the route answers 503.
    const noKey: CloudEnv = { ...TEST_ENV, AI_TRANSCRIPTION_CHAIN: `gateway:${GATEWAY_STT_A}` };
    assert.equal((await jsonBody(await api("/api/health", {}, noKey))).hasAi, false);

    const paidNoKey = await paidProCookie(noKey, "nokey@example.test");
    const refused = await api("/api/ai/voice-pin", {
      body: voiceForm("voice_request_no_key_01"),
      headers: { cookie: paidNoKey.cookie },
      method: "POST",
    }, paidNoKey.env);
    assert.equal(refused.status, 503);
    assert.equal((await jsonBody(refused)).code, "ai_unavailable");

    // With the key, the same route works without any AI binding.
    const paidChain = await paidProCookie(withChain, "chain@example.test");
    const fake = fakeGateway({
      [`transcription:${GATEWAY_STT_A}`]: () => Response.json({ durationInSeconds: 30, language: "pt", text: "sem binding." }),
    });
    const worked = await withGateway(fake, () => api("/api/ai/voice-pin", {
      body: voiceForm("voice_request_chain_05"),
      headers: { cookie: paidChain.cookie },
      method: "POST",
    }, paidChain.env));
    assert.equal(worked.status, 200, await worked.clone().text());
    assert.ok(isRecord((await jsonBody(worked)).result));

    // And with no AI at all the route answers 503 without touching credits.
    const paidNone = await paidProCookie(none, "none@example.test");
    const unavailable = await api("/api/ai/voice-pin", {
      body: voiceForm("voice_request_unavailable_01"),
      headers: { cookie: paidNone.cookie },
      method: "POST",
    }, paidNone.env);
    assert.equal(unavailable.status, 503);
    assert.equal((await jsonBody(unavailable)).code, "ai_unavailable");
    assert.equal(await credits(paidNone.cookie, paidNone.env), 500);
  });
});
