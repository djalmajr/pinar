import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, test } from "node:test";
import { pinarHome } from "@pinar/cli/paths";
import { handleApiRequest, resetLocalApiForTests } from "../api.local";
import { handleLocalAiRequest, setLocalAiDependenciesForTests } from "./local-ai";

const EXTENSION_ORIGIN = "chrome-extension://pinaaaaaaaaaaaaaaaaaaaaaaa";
const HOSTILE_ORIGIN = "http://evil.example";
const ENDPOINT = "http://127.0.0.1:9473/v1";
const LLM_MODEL = "qwen3.8-27b";
const TRANSCRIPTION_MODEL = "parakeet-tdt-0.6b-v3";

let root = "";
let previousHome: string | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jsonBody(response: Response) {
  const body: unknown = await response.json();
  assert.ok(isRecord(body));
  return body;
}

// Full local API entry, used for the capability/authentication test: it also
// exercises the origin/capability policy in front of the /api/ai routes.
function requestFull(path: string, init: RequestInit = {}) {
  return handleApiRequest(new Request(`http://127.0.0.1:17373${path}`, init));
}

// Same /api/ai/* entry the local API uses (handleLocalAiRequest), without the
// capability policy: keeps the route tests off the history database.
async function requestAi(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await handleLocalAiRequest(
    new Request(`http://127.0.0.1:17373${path}`, init),
    pinarHome(),
    {
      getSession: () => null,
      saveSession: () => { throw new Error("voice pin never persists sessions"); },
    },
  );
  assert.ok(response, `expected the local AI router to answer ${path}`);
  return response;
}

function voiceForm(requestId: string, options: { audio?: Blob; durationSeconds?: number | string; language?: string } = {}) {
  const form = new FormData();
  if (requestId) form.set("requestId", requestId);
  form.set("durationSeconds", String(options.durationSeconds ?? 30));
  form.set("language", options.language ?? "pt");
  form.set(
    "audio",
    options.audio ?? new Blob([new TextEncoder().encode("voice-bytes")], { type: "audio/webm" }),
    "pin.webm",
  );
  return form;
}

// Windows (Defender + delayed SQLite handle release) can keep the temp root
// briefly busy right after close, so retry the cleanup with a bounded delay.
async function removeWithRetry(path: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(path, { force: true, recursive: true });
      return;
    } catch (error) {
      if (String(error).includes("EBUSY") && attempt < 19) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw error;
    }
  }
}

function seedAiSettings(overrides: Record<string, unknown> = {}) {
  writeFileSync(join(root, "ai.json"), JSON.stringify({
    endpoint: ENDPOINT,
    mode: "local",
    model: LLM_MODEL,
    transcriptionModel: TRANSCRIPTION_MODEL,
    ...overrides,
  }));
}

function seedPreferences(voicePostProcessing: boolean) {
  writeFileSync(join(root, "preferences.json"), JSON.stringify({ voicePostProcessing }));
}

function fakeVault(secret: string | null = null) {
  let stored = secret;
  return {
    clear: async () => { stored = null; },
    get: async () => stored,
    set: async (value: string) => { stored = value; },
  };
}

interface FakeCall { init?: RequestInit; url: string }

function fakeFetch(handlers: {
  chat?: (init: RequestInit | undefined) => { content: string; usage?: { completion_tokens: number; prompt_tokens: number } };
  models?: { id: string }[];
  transcribe?: (init: RequestInit | undefined) => { body: Record<string, unknown>; headers?: Record<string, string> };
}) {
  const calls: FakeCall[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ init, url });
    if (url.endsWith("/audio/transcriptions")) {
      const result = handlers.transcribe?.(init);
      if (!result) return Response.json({ error: "no transcribe handler" }, { status: 500 });
      return new Response(JSON.stringify(result.body), {
        headers: { "Content-Type": "application/json", ...result.headers },
        status: 200,
      });
    }
    if (url.endsWith("/chat/completions")) {
      const result = handlers.chat?.(init);
      if (!result) return Response.json({ error: "no chat handler" }, { status: 500 });
      return Response.json({
        choices: [{ message: { content: result.content } }],
        model: LLM_MODEL,
        usage: result.usage,
      });
    }
    if (url.endsWith("/models")) {
      return Response.json({ data: handlers.models ?? [] });
    }
    return Response.json({ error: `unexpected url ${url}` }, { status: 500 });
  };
  return { calls, fetcher };
}

describe("POST /api/ai/voice-pin (local)", () => {
  beforeEach(async () => {
    previousHome = process.env.PINAR_HOME;
    root = await mkdtemp(join(tmpdir(), "pinar-local-voice-"));
    process.env.PINAR_HOME = root;
    resetLocalApiForTests();
  });

  afterEach(async () => {
    resetLocalApiForTests();
    if (previousHome === undefined) delete process.env.PINAR_HOME;
    else process.env.PINAR_HOME = previousHome;
    await removeWithRetry(root);
  });

  test("returns the raw transcription without structuring when the preference is off", async () => {
    const transcript = "O botão precisa ficar alinhado com o título.";
    const { calls, fetcher } = fakeFetch({
      transcribe: () => ({ body: { duration: 30, language: "pt", text: transcript } }),
    });
    setLocalAiDependenciesForTests({ fetch: fetcher, vault: fakeVault() });
    seedAiSettings();

    const response = await requestAi("/api/ai/voice-pin", {
      body: voiceForm("voice_local_raw_0001"),
      method: "POST",
    });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await jsonBody(response);
    assert.equal(body.ok, true);
    assert.equal(body.creditsCharged, 0);
    assert.equal(body.idempotent, undefined);
    assert.equal(body.truncated, undefined);
    assert.ok(isRecord(body.result));
    assert.equal(body.result.transcript, transcript);
    assert.equal(body.result.comment, transcript);
    assert.deepEqual(body.result.acceptanceCriteria, []);
    assert.equal(body.result.detectedLanguage, "pt");
    assert.ok(isRecord(body.usage));
    assert.equal(body.usage.costUsdMicros, 0);
    assert.equal(body.usage.inputTokens, 0);
    assert.equal(body.usage.outputTokens, 0);
    assert.equal(body.usage.model, TRANSCRIPTION_MODEL);
    assert.equal(body.usage.provider, "local");

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${ENDPOINT}/audio/transcriptions`);
    const form = calls[0].init?.body as FormData;
    const file = form.get("file");
    assert.ok(file instanceof File);
    // The provider gets the fixed name derived from the audio type, never the
    // client file name.
    assert.equal(file.name, "audio.webm");
    assert.match(file.type, /^(?:audio|video)\/webm$/);
    assert.equal(await file.text(), "voice-bytes");
    assert.equal(form.get("model"), TRANSCRIPTION_MODEL);
    assert.equal(form.get("language"), "pt");
    assert.equal(form.get("response_format"), null);
    assert.equal(new Headers(calls[0].init?.headers).get("authorization"), null);
  });

  test("derives the provider file name from the audio type and drops the client name", async () => {
    const { calls, fetcher } = fakeFetch({
      transcribe: () => ({ body: { duration: 5, language: "pt", text: "olá" } }),
    });
    setLocalAiDependenciesForTests({ fetch: fetcher, vault: fakeVault() });
    seedAiSettings();

    const form = new FormData();
    form.set("requestId", "voice_local_name_001");
    form.set("durationSeconds", "30");
    form.set("language", "pt");
    form.set("audio", new File([new TextEncoder().encode("ogg-bytes")], "../../etc/cron.d/evil name.ogg", { type: "audio/ogg" }), "client-name.ogg");

    const response = await requestAi("/api/ai/voice-pin", { body: form, method: "POST" });
    assert.equal(response.status, 200, await response.clone().text());

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${ENDPOINT}/audio/transcriptions`);
    const providerForm = calls[0].init?.body as FormData;
    const file = providerForm.get("file");
    assert.ok(file instanceof File);
    assert.equal(file.name, "audio.ogg");
    assert.equal(file.type, "audio/ogg");
    assert.equal(await file.text(), "ogg-bytes");
  });

  test("structures the transcript when voicePostProcessing is on and the LLM model is configured", async () => {
    const transcript = "É, tipo, o botão, o botão precisa ficar alinhado, né, com o título.";
    const { calls, fetcher } = fakeFetch({
      chat: (init) => {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, LLM_MODEL);
        assert.deepEqual(body.response_format, { type: "json_object" });
        assert.equal(body.messages[0].role, "system");
        assert.match(String(body.messages[0].content), /remove stutters, filler words/);
        assert.match(String(body.messages[0].content), /untrusted user data/);
        assert.deepEqual(JSON.parse(String(body.messages[1].content)), { language: "pt", transcript });
        return {
          content: JSON.stringify({
            acceptanceCriteria: ["O espaço entre o título e o botão é de 8 px."],
            comment: "Alinhe o botão ao título e mantenha 8 px de espaço.",
          }),
          usage: { completion_tokens: 28, prompt_tokens: 42 },
        };
      },
      transcribe: () => ({ body: { duration: 30, language: "pt", text: transcript } }),
    });
    setLocalAiDependenciesForTests({ fetch: fetcher, vault: fakeVault() });
    seedAiSettings();
    seedPreferences(true);

    const response = await requestAi("/api/ai/voice-pin", {
      body: voiceForm("voice_local_struct_001"),
      method: "POST",
    });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await jsonBody(response);
    assert.equal(body.ok, true);
    assert.equal(body.creditsCharged, 0);
    assert.ok(isRecord(body.result));
    assert.equal(body.result.transcript, transcript);
    assert.equal(body.result.comment, "Alinhe o botão ao título e mantenha 8 px de espaço.");
    assert.deepEqual(body.result.acceptanceCriteria, ["O espaço entre o título e o botão é de 8 px."]);
    assert.equal(body.result.detectedLanguage, "pt");
    assert.ok(isRecord(body.usage));
    assert.equal(body.usage.costUsdMicros, 0);
    assert.equal(body.usage.inputTokens, 42);
    assert.equal(body.usage.outputTokens, 28);
    assert.equal(body.usage.model, `${TRANSCRIPTION_MODEL} + ${LLM_MODEL}`);
    assert.equal(body.usage.provider, "local");

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, `${ENDPOINT}/audio/transcriptions`);
    assert.equal(calls[1].url, `${ENDPOINT}/chat/completions`);
  });

  test("skips structuring when the preference is on but the LLM model is not configured", async () => {
    const transcript = "Aumente o contraste do aviso.";
    const { calls, fetcher } = fakeFetch({
      transcribe: () => ({ body: { duration: 12, language: "en", text: transcript } }),
    });
    setLocalAiDependenciesForTests({ fetch: fetcher, vault: fakeVault() });
    seedAiSettings({ model: "" });
    seedPreferences(true);

    const response = await requestAi("/api/ai/voice-pin", {
      body: voiceForm("voice_local_nollm_001"),
      method: "POST",
    });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await jsonBody(response);
    assert.equal(body.result.comment, transcript);
    assert.deepEqual(body.result.acceptanceCriteria, []);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${ENDPOINT}/audio/transcriptions`);
  });

  test("reports a truncated transcription without failing the request", async () => {
    const { fetcher } = fakeFetch({
      transcribe: () => ({
        body: { duration: 30, language: "pt", text: "texto cortado" },
        headers: { "X-ASR-Truncated": "true" },
      }),
    });
    setLocalAiDependenciesForTests({ fetch: fetcher, vault: fakeVault() });
    seedAiSettings();

    const response = await requestAi("/api/ai/voice-pin", {
      body: voiceForm("voice_local_trunc_001"),
      method: "POST",
    });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await jsonBody(response);
    assert.equal(body.ok, true);
    assert.equal(body.truncated, true);
    assert.equal(body.result.transcript, "texto cortado");
  });

  test("returns 503 ai_unavailable when AI is disabled or no transcription model is configured", async () => {
    const { calls, fetcher } = fakeFetch({
      transcribe: () => ({ body: { text: "x" } }),
    });
    setLocalAiDependenciesForTests({ fetch: fetcher, vault: fakeVault() });

    seedAiSettings({ mode: "disabled" });
    const disabled = await requestAi("/api/ai/voice-pin", {
      body: voiceForm("voice_local_503_a_001"),
      method: "POST",
    });
    assert.equal(disabled.status, 503);
    assert.deepEqual(await jsonBody(disabled), {
      code: "ai_unavailable",
      error: "Configure a transcription model in Settings → AI",
    });

    seedAiSettings({ transcriptionModel: "" });
    const noModel = await requestAi("/api/ai/voice-pin", {
      body: voiceForm("voice_local_503_b_001"),
      method: "POST",
    });
    assert.equal(noModel.status, 503);
    assert.deepEqual(await jsonBody(noModel), {
      code: "ai_unavailable",
      error: "Configure a transcription model in Settings → AI",
    });

    assert.equal(calls.length, 0);
  });

  test("requires the BYOK key and sends it as a bearer header when stored", async () => {
    const { calls, fetcher } = fakeFetch({
      transcribe: (init) => {
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sk-voice-key");
        return { body: { duration: 5, language: "pt", text: "olá" } };
      },
    });
    setLocalAiDependenciesForTests({ fetch: fetcher, vault: fakeVault() });
    seedAiSettings({ mode: "byok" });

    const withoutKey = await requestAi("/api/ai/voice-pin", {
      body: voiceForm("voice_local_byok_0001"),
      method: "POST",
    });
    assert.equal(withoutKey.status, 401);
    assert.deepEqual(await jsonBody(withoutKey), {
      code: "ai_auth_failed",
      error: "An API key is required for BYOK",
    });

    setLocalAiDependenciesForTests({ fetch: fetcher, vault: fakeVault("sk-voice-key") });
    const withKey = await requestAi("/api/ai/voice-pin", {
      body: voiceForm("voice_local_byok_0002"),
      method: "POST",
    });
    assert.equal(withKey.status, 200, await withKey.clone().text());
    const body = await jsonBody(withKey);
    assert.equal(body.usage.provider, "byok");
    assert.equal(calls.length, 1);
  });

  test("rejects invalid requests with the same codes as the cloud route", async () => {
    const { calls, fetcher } = fakeFetch({
      transcribe: () => ({ body: { text: "x" } }),
    });
    setLocalAiDependenciesForTests({ fetch: fetcher, vault: fakeVault() });
    seedAiSettings();

    const badRequestId = await requestAi("/api/ai/voice-pin", {
      body: voiceForm("short"),
      method: "POST",
    });
    assert.equal(badRequestId.status, 400);
    assert.deepEqual(await jsonBody(badRequestId), { error: "valid requestId required" });

    const missingRequestId = await requestAi("/api/ai/voice-pin", {
      body: voiceForm(""),
      method: "POST",
    });
    assert.equal(missingRequestId.status, 400);
    assert.deepEqual(await jsonBody(missingRequestId), { error: "valid requestId required" });

    for (const [index, durationSeconds] of [0, 121, -5, "abc"].entries()) {
      const response = await requestAi("/api/ai/voice-pin", {
        body: voiceForm(`voice_local_dur_${String(index).padStart(4, "0")}`, { durationSeconds }),
        method: "POST",
      });
      assert.equal(response.status, 400, `duration ${durationSeconds}: ${await response.clone().text()}`);
      assert.deepEqual(await jsonBody(response), {
        code: "invalid_audio_duration",
        error: "audio duration must be between 1 and 120 seconds",
      });
    }

    const emptyAudio = await requestAi("/api/ai/voice-pin", {
      body: voiceForm("voice_local_empty_01", { audio: new Blob([], { type: "audio/webm" }) }),
      method: "POST",
    });
    assert.equal(emptyAudio.status, 400);
    assert.deepEqual(await jsonBody(emptyAudio), {
      code: "invalid_audio",
      error: "audio file is missing or too large",
    });

    const oversized = await requestAi("/api/ai/voice-pin", {
      body: voiceForm("voice_local_big_00001", {
        audio: new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "audio/webm" }),
      }),
      method: "POST",
    });
    assert.equal(oversized.status, 400);
    assert.deepEqual(await jsonBody(oversized), {
      code: "invalid_audio",
      error: "audio file is missing or too large",
    });

    const missingAudio = new FormData();
    missingAudio.set("requestId", "voice_local_noaud_01");
    missingAudio.set("durationSeconds", "30");
    missingAudio.set("language", "pt");
    const noAudio = await requestAi("/api/ai/voice-pin", { body: missingAudio, method: "POST" });
    assert.equal(noAudio.status, 400);
    assert.deepEqual(await jsonBody(noAudio), {
      code: "invalid_audio",
      error: "audio file is missing or too large",
    });

    const unsupported = await requestAi("/api/ai/voice-pin", {
      body: (() => {
        const form = new FormData();
        form.set("requestId", "voice_local_flac_0001");
        form.set("durationSeconds", "30");
        form.set("language", "pt");
        form.set("audio", new Blob([new Uint8Array(4)], { type: "audio/flac" }), "pin.flac");
        return form;
      })(),
      method: "POST",
    });
    assert.equal(unsupported.status, 415);
    const unsupportedBody = await jsonBody(unsupported);
    assert.equal(unsupportedBody.code, "unsupported_audio");
    assert.match(String(unsupportedBody.error), /^audio format '[^']+' is not supported$/);

    const notMultipart = await requestAi("/api/ai/voice-pin", {
      body: JSON.stringify({
        durationSeconds: 30,
        language: "pt",
        requestId: "voice_local_json_01",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(notMultipart.status, 400);
    assert.deepEqual(await jsonBody(notMultipart), { error: "multipart form data required" });

    assert.equal(calls.length, 0);
  });

  test("applies the same local capability rule as the other /api/ai routes", async () => {
    const { calls, fetcher } = fakeFetch({
      transcribe: () => ({ body: { duration: 5, language: "pt", text: "olá" } }),
    });
    setLocalAiDependenciesForTests({ fetch: fetcher, vault: fakeVault() });
    seedAiSettings();

    const denied = await requestFull("/api/ai/voice-pin", {
      body: voiceForm("voice_local_auth_0001"),
      headers: { origin: EXTENSION_ORIGIN },
      method: "POST",
    });
    assert.equal(denied.status, 401);
    assert.deepEqual(await jsonBody(denied), { error: "unauthorized" });

    const pairing = await requestFull("/api/local/capability", { headers: { origin: EXTENSION_ORIGIN } });
    assert.equal(pairing.status, 200);
    const token = String((await jsonBody(pairing)).token);

    const allowed = await requestFull("/api/ai/voice-pin", {
      body: voiceForm("voice_local_auth_0001"),
      headers: { origin: EXTENSION_ORIGIN, "x-pinar-capability": token },
      method: "POST",
    });
    assert.equal(allowed.status, 200, await allowed.clone().text());

    const hostile = await requestFull("/api/ai/voice-pin", {
      body: voiceForm("voice_local_auth_0001"),
      headers: { origin: HOSTILE_ORIGIN, "x-pinar-capability": token },
      method: "POST",
    });
    assert.equal(hostile.status, 401);
    assert.deepEqual(await jsonBody(hostile), { error: "unauthorized" });

    assert.equal(calls.length, 1);
  });

  test("settings expose and persist a trimmed transcriptionModel capped at 200 characters", async () => {
    const { fetcher } = fakeFetch({ models: [{ id: LLM_MODEL }] });
    setLocalAiDependenciesForTests({ fetch: fetcher, vault: fakeVault() });
    seedAiSettings();

    const listed = await jsonBody(await requestAi("/api/ai/settings"));
    assert.equal(listed.ok, true);
    assert.equal(listed.transcriptionModel, TRANSCRIPTION_MODEL);
    assert.equal(listed.model, LLM_MODEL);

    const longModel = "m".repeat(205);
    const patched = await requestAi("/api/ai/settings", {
      body: JSON.stringify({
        endpoint: ENDPOINT,
        mode: "local",
        model: LLM_MODEL,
        transcriptionModel: `  ${longModel}  `,
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    assert.equal(patched.status, 200, await patched.clone().text());
    const patchedBody = await jsonBody(patched);
    assert.equal(patchedBody.transcriptionModel, "m".repeat(200));
    assert.equal(patchedBody.model, LLM_MODEL);
    assert.equal(
      JSON.parse(readFileSync(join(root, "ai.json"), "utf8")).transcriptionModel,
      "m".repeat(200),
    );
  });

  test("the connection test accepts a transcriptionModel without validating it", async () => {
    const { calls, fetcher } = fakeFetch({ models: [{ id: LLM_MODEL }] });
    setLocalAiDependenciesForTests({ fetch: fetcher, vault: fakeVault() });
    seedAiSettings();

    const response = await requestAi("/api/ai/settings/test", {
      body: JSON.stringify({
        endpoint: ENDPOINT,
        mode: "local",
        model: LLM_MODEL,
        transcriptionModel: "whisper-large-v3",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await jsonBody(response), { model: LLM_MODEL, ok: true, provider: "local" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${ENDPOINT}/models`);
  });
});
