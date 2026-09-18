import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import {
  aiEnv,
  api,
  getJson,
  isRecord,
  jsonBody,
  paidProCookie,
} from "../../../tests/helpers/cloud-ai";
import { resetCloudMemoryStateForTests } from "../cloud-api";

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

  test("transcribes and structures a short Portuguese pin without returning audio", async () => {
    const calls: Array<{ input: unknown; model: string }> = [];
    const env = aiEnv(async (model, input) => {
      calls.push({ input, model });
      if (model === TRANSCRIPTION_MODEL) {
        return {
          text: "O botão precisa ficar alinhado com o título e manter oito pixels de espaço.",
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
    assert.equal(body.result.transcript, "O botão precisa ficar alinhado com o título e manter oito pixels de espaço.");
    assert.equal(body.result.comment, "Alinhe o botão ao título e mantenha 8 px de espaço.");
    assert.equal(body.result.detectedLanguage, "pt");
    assert.equal(JSON.stringify(body).includes("AQIDBA=="), false);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].model, TRANSCRIPTION_MODEL);
    assert.ok(isRecord(calls[0].input));
    assert.equal(calls[0].input.audio, "AQIDBA==");
    assert.equal(calls[1].model, STRUCTURING_MODEL);
    assert.equal(await credits(paid.cookie, paid.env), 199);
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
    assert.equal(callCount, 2);
    assert.equal(await credits(paid.cookie, paid.env), 198);
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
    assert.equal(await credits(paid.cookie, paid.env), 200);
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
    assert.equal(await credits(paid.cookie, paid.env), 200);
  });
});
