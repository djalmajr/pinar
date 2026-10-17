import { expect, test } from "bun:test";
import { BenchHttpError, BenchProtocolError, BenchTransportError, buildChatBody, chatStream, parseRetryAfterMs } from "./client";
import type { BenchClientOptions } from "./client";
import { llmToolDefs } from "./tools";
import type { ChatMessage } from "./types";
import { makeFakeFetch, type ScriptedResponse } from "./test-utils";

const API_KEY = "sk-test-NAO-VAZAR";

function baseOptions(script: ScriptedResponse[], overrides: Partial<BenchClientOptions> = {}): {
  options: BenchClientOptions;
  fake: ReturnType<typeof makeFakeFetch>;
  delays: number[];
} {
  const fake = makeFakeFetch(script);
  const delays: number[] = [];
  const options: BenchClientOptions = {
    apiKey: API_KEY,
    baseUrl: "https://appliance.example/v1",
    conversationId: "conv-1",
    delayImpl: (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    },
    fetchImpl: fake.fetchImpl,
    messages: [
      { content: "systema", role: "system" },
      { content: "olá", role: "user" },
    ],
    model: "qwen3.8-27b",
    tools: llmToolDefs(false),
    ...overrides,
  };
  return { fake, delays, options };
}

const text = (content: string) => ({ choices: [{ delta: { content } }] });
const finish = (reason: string) => ({ choices: [{ delta: {}, finish_reason: reason }] });
const usage = (prompt: number, completion: number, reasoning?: number) => ({
  choices: [],
  usage: {
    completion_tokens: completion,
    prompt_tokens: prompt,
    ...(reasoning === undefined ? {} : { completion_tokens_details: { reasoning_tokens: reasoning } }),
  },
});

test("acumula tool_calls em pedaços, em qualquer ordem, por índice", async () => {
  const script: ScriptedResponse[] = [
    {
      chunks: [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { function: { arguments: "{\"sessionId\":", name: "pinar_lis" }, id: "call_a", index: 0 },
                  { function: { arguments: "{\"pinId\":", name: "pinar_get" }, id: "call_b", index: 1 },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { function: { arguments: "\"abc\"}", name: "t_sessions" }, index: 0 },
                  { function: { arguments: "\"p1\",\"sessionId\":\"abc\"}", name: "_pin" }, index: 1 },
                ],
              },
            },
          ],
        },
        finish("tool_calls"),
        usage(4, 9, 2),
      ],
    },
  ];
  const { fake, options } = baseOptions(script);
  const result = await chatStream(options);
  expect(fake.requests.length).toBe(1);
  expect(result.text).toBe("");
  expect(result.finishReason).toBe("tool_calls");
  expect(result.toolCalls.length).toBe(2);
  expect(result.toolCalls[0].id).toBe("call_a");
  expect(result.toolCalls[0].name).toBe("pinar_list_sessions");
  expect(result.toolCalls[0].args).toEqual({ sessionId: "abc" });
  expect(result.toolCalls[1].name).toBe("pinar_get_pin");
  expect(result.toolCalls[1].args).toEqual({ pinId: "p1", sessionId: "abc" });
  expect(result.toolCalls.every((call) => call.jsonError === null)).toBe(true);
  expect(result.usage).toEqual({ completionTokens: 9, promptTokens: 4, reasoningTokens: 2 });
});

test("args vazios significam objeto vazio, não JSON inválido", async () => {
  const script: ScriptedResponse[] = [
    {
      chunks: [
        { choices: [{ delta: { tool_calls: [{ function: { name: "pinar_list_projects" }, id: "c1", index: 0 }] } }] },
        finish("tool_calls"),
      ],
    },
  ];
  const { options } = baseOptions(script);
  const result = await chatStream(options);
  expect(result.toolCalls[0].args).toEqual({});
  expect(result.toolCalls[0].jsonError).toBeNull();
});

test("reasoning_content não conta como visível", async () => {
  const script: ScriptedResponse[] = [
    {
      chunks: [
        { choices: [{ delta: { reasoning_content: "raciocínio longo…" } }] },
        text("Oi"),
        finish("stop"),
      ],
    },
  ];
  const { options } = baseOptions(script);
  const result = await chatStream(options);
  expect(result.text).toBe("Oi");
  expect(result.ttftAnyMs).not.toBeNull();
  expect(result.ttftVisibleMs).not.toBeNull();
  expect(result.ttftVisibleMs as number).toBeGreaterThanOrEqual(result.ttftAnyMs as number);
});

test("só raciocínio: ttftAny chega, ttftVisible nunca", async () => {
  const script: ScriptedResponse[] = [
    {
      chunks: [
        { choices: [{ delta: { reasoning_content: "só pensamento" } }] },
        finish("stop"),
        usage(2, 3),
      ],
    },
  ];
  const { options } = baseOptions(script);
  const result = await chatStream(options);
  expect(result.ttftAnyMs).not.toBeNull();
  expect(result.ttftVisibleMs).toBeNull();
  expect(result.text).toBe("");
});

test("usage do último chunk vence a de um chunk anterior", async () => {
  const early = { choices: [{ delta: { content: "a" } }], usage: { completion_tokens: 1, prompt_tokens: 1 } };
  const script: ScriptedResponse[] = [
    { chunks: [early, finish("stop"), usage(40, 7)] },
  ];
  const { options } = baseOptions(script);
  const result = await chatStream(options);
  expect(result.usage).toEqual({ completionTokens: 7, promptTokens: 40, reasoningTokens: null });
});

test("término explícito: [DONE] encerra; finish_reason sem [DONE] também vale", async () => {
  // finish_reason "stop" e o fake emite [DONE] no fim: ok.
  const { options: withDone, fake } = baseOptions([{ chunks: [text("fim"), finish("stop")] }]);
  const result = await chatStream(withDone);
  expect(result.text).toBe("fim");
  expect(fake.requests.length).toBe(1);
  // Sem [DONE] mas com finish_reason: também é término explícito.
  const raw = "data: " + JSON.stringify(text("só com finish")) + "\n\n"
    + "data: " + JSON.stringify(finish("stop")) + "\n\n";
  const { options: noDone } = baseOptions([], { fetchImpl: async () => new Response(raw) });
  const resultNoDone = await chatStream(noDone);
  expect(resultNoDone.text).toBe("só com finish");
  expect(resultNoDone.finishReason).toBe("stop");
});

test("stream sem [DONE] nem finish_reason vira erro de protocolo sanitizado", async () => {
  const raw = "data: " + JSON.stringify(text("Personal")) + "\n\n";
  let calls = 0;
  const { options } = baseOptions([], { fetchImpl: async () => { calls += 1; return new Response(raw); } });
  let caught: unknown;
  try {
    await chatStream(options);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BenchProtocolError);
  expect((caught as Error).message).toBe("stream ended without an explicit end marker");
  expect(String(caught)).not.toContain("Personal");
  expect(calls).toBe(1);
});

test("[DONE] libera o transporte: conexão aberta ou erro tardio não quebra o caso (F7)", async () => {
  // F7: ao receber [DONE] o client para de ler e cancela o reader:
  // conteúdo que nunca chega (conexão aberta) nem erro de transporte
  // tardio podem pendurar ou reprovar um caso já completo.
  const encoder = new TextEncoder();
  const doneThenHang = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("data: " + JSON.stringify(text("antes")) + "\n\n"));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      // O stream continua aberto: nunca enqueues nem close mais nada.
    },
  });
  const { options: hangOptions } = baseOptions([], {
    fetchImpl: async () => new Response(doneThenHang, { status: 200 }),
  });
  const hung = await chatStream(hangOptions);
  expect(hung.text).toBe("antes");
  expect(hung.finishReason).toBe(null);

  const doneThenError = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("data: " + JSON.stringify(text("x")) + "\n\n"));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      setTimeout(() => controller.error(new Error("socket blown after DONE")), 5);
    },
  });
  const { options: errorOptions } = baseOptions([], {
    fetchImpl: async () => new Response(doneThenError, { status: 200 }),
  });
  const errored = await chatStream(errorOptions);
  expect(errored.text).toBe("x");
});

test("evento JSON inválido vira erro de protocolo sanitizado, sem o payload", async () => {
  const secretPayload = "{not-json-with-the-key sk-test-NAO-VAZAR inside}";
  const raw = "data: " + secretPayload + "\n\n";
  let calls = 0;
  const { options } = baseOptions([], { fetchImpl: async () => { calls += 1; return new Response(raw); } });
  let caught: unknown;
  try {
    await chatStream(options);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BenchProtocolError);
  expect((caught as Error).message).toBe("stream event is not valid JSON");
  expect(String(caught)).not.toContain("sk-test-NAO-VAZAR");
  expect(String(caught)).not.toContain("not-json-with-the-key");
  expect(calls).toBe(1);
});

test("503: respeita Retry-After numérico e só tenta de novo antes do primeiro byte", async () => {
  const script: ScriptedResponse[] = [
    { retryAfter: "7", status: 503 },
    { chunks: [text("ok"), usage(3, 2)] },
  ];
  const { delays, fake, options } = baseOptions(script);
  const result = await chatStream(options);
  expect(result.text).toBe("ok");
  expect(result.attempts).toBe(2);
  expect(fake.requests.length).toBe(2);
  expect(delays).toEqual([7000]);
  expect(fake.requests[0].headers["X-Conversation-Id"]).toBe("conv-1");
  expect(fake.requests[1].headers["X-Conversation-Id"]).toBe("conv-1");
  expect(fake.requests[0].headers["X-Request-Id"]).not.toBe(fake.requests[1].headers["X-Request-Id"]);
  expect(fake.requests[0].headers["X-Request-Id"]).toMatch(/^[0-9a-f-]{36}$/);
});

test("Retry-After em data HTTP: atraso até a data; inválido ou passado usa o padrão", () => {
  const now = Date.now();
  const future = new Date(now + 5000).toUTCString();
  // toUTCString tem precisão de segundo: o atraso fica em (4000, 5000].
  expect(parseRetryAfterMs(future, now)).toBeGreaterThan(4000);
  expect(parseRetryAfterMs(future, now)).toBeLessThanOrEqual(5000);
  const past = new Date(now - 1500).toUTCString();
  expect(parseRetryAfterMs(past, now)).toBe(500);
  expect(parseRetryAfterMs("banana", now)).toBe(500);
  expect(parseRetryAfterMs("7", now)).toBe(7000);
  expect(parseRetryAfterMs(null, now)).toBe(500);
});

test("503 esgotando o orçamento: 1 tentativa + 3 retries e depois erro", async () => {
  const script: ScriptedResponse[] = [
    { status: 503 },
    { retryAfter: "1", status: 503 },
    { status: 503 },
    { status: 503 },
  ];
  const { delays, fake, options } = baseOptions(script, { maxRetries: 3 });
  let caught: unknown;
  try {
    await chatStream(options);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BenchHttpError);
  expect((caught as BenchHttpError).status).toBe(503);
  expect(fake.requests.length).toBe(4);
  expect(delays).toEqual([500, 1000, 500]);
});

test("Retry-After inválido usa o padrão", async () => {
  const script: ScriptedResponse[] = [
    { retryAfter: "banana", status: 503 },
    { chunks: [text("de volta")] },
  ];
  const { delays, options } = baseOptions(script);
  await chatStream(options);
  expect(delays).toEqual([500]);
});

test("falha de transporte no meio do stream: erro sanitizado, sem retry", async () => {
  const script: ScriptedResponse[] = [
    { chunks: [text("meio")], streamError: true },
  ];
  const { fake, options } = baseOptions(script);
  let caught: unknown;
  try {
    await chatStream(options);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BenchTransportError);
  expect((caught as Error).message).toBe("transport failure while reading the stream");
  expect(String(caught)).not.toContain("scripted stream failure");
  expect(fake.requests.length).toBe(1);
});

test("respostas 2xx completas não repetem o POST", async () => {
  const script: ScriptedResponse[] = [{ chunks: [text("fim"), usage(1, 1)] }];
  const { fake, options } = baseOptions(script);
  const result = await chatStream(options);
  expect(result.attempts).toBe(1);
  expect(fake.requests.length).toBe(1);
});

test("a chave só vai no header e nunca aparece no erro (message do corpo 401)", async () => {
  const script: ScriptedResponse[] = [{ status: 401 }];
  const { fake, options } = baseOptions(script);
  let caught: unknown;
  try {
    await chatStream(options);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BenchHttpError);
  const rendered = `${caught}`;
  expect(rendered).not.toContain(API_KEY);
  expect((caught as BenchHttpError).status).toBe(401);
  expect(rendered).toContain("appliance_error");
  expect(fake.requests[0].headers["Authorization"]).toBe(`Bearer ${API_KEY}`);
  expect(fake.requests[0].headers["X-Request-Id"]).toMatch(/^[0-9a-f-]{36}$/);
  expect(fake.requests[0].method).toBe("POST");
  expect(fake.requests[0].url).toBe("https://appliance.example/v1/chat/completions");
  expect(fake.requests[0].redirect).toBe("error");
});

test("chave sintética ecoada em error.type: redigida do erro", async () => {
  const key = "sk-synthetic-review-secret";
  const { fake, options } = baseOptions([], {
    apiKey: key,
    fetchImpl: async () => new Response(JSON.stringify({ error: { type: key } }), { status: 401 }),
  });
  let caught: unknown;
  try {
    await chatStream(options);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BenchHttpError);
  const rendered = String(caught);
  expect(rendered).not.toContain(key);
  expect((caught as BenchHttpError).message).toBe("HTTP 401");
  expect((caught as BenchHttpError).detail).toBe("");
});

test("chave sintética ecoada em error.code: redigida do erro", async () => {
  const key = "sk-synthetic-code-echo";
  const { options } = baseOptions([], {
    apiKey: key,
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: key, message: "ignore me" } }), { status: 403 }),
  });
  let caught: unknown;
  try {
    await chatStream(options);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BenchHttpError);
  expect((caught as BenchHttpError).message).toBe("HTTP 403");
  expect(String(caught)).not.toContain(key);
});

test("exceção de transporte ecoando a chave: normalizada, sem o valor", async () => {
  const key = "sk-synthetic-transport-echo";
  const { fake, options } = baseOptions([], {
    apiKey: key,
    fetchImpl: async () => {
      throw new Error(`upstream rejected, echoed ${key} in the socket error`);
    },
  });
  let caught: unknown;
  try {
    await chatStream(options);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BenchTransportError);
  const rendered = String(caught);
  expect((caught as BenchTransportError).message).toBe("transport failure while contacting the chat endpoint");
  expect(rendered).not.toContain(key);
  expect(fake.requests.length).toBe(0);
});

test("chave ecoada no texto do stream: redigida do resultado", async () => {
  const key = "sk-synthetic-stream-echo";
  const { options } = baseOptions([], {
    apiKey: key,
    fetchImpl: async () => {
      const wire =
        "data: " + JSON.stringify({ choices: [{ delta: { content: `olá ${key} fim` } }] }) + "\n\n" +
        "data: [DONE]\n\n";
      return new Response(wire);
    },
  });
  const result = await chatStream(options);
  expect(result.text).toBe("olá *** fim");
  expect(result.text).not.toContain(key);
});

test("chave ecoada nos argumentos do tool call: redigida antes do parse", async () => {
  const key = "sk-synthetic-args-echo";
  const { options } = baseOptions([], {
    apiKey: key,
    fetchImpl: async () => {
      const wire =
        "data: " + JSON.stringify({
          choices: [{
            delta: {
              tool_calls: [
                { function: { arguments: `{"query":"${key}"}`, name: "pinar_list_sessions" }, id: "c1", index: 0 },
              ],
            },
          }],
        }) + "\n\n" +
        "data: " + JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }) + "\n\n";
      return new Response(wire);
    },
  });
  const result = await chatStream(options);
  expect(result.toolCalls.length).toBe(1);
  expect(JSON.stringify(result.toolCalls)).not.toContain(key);
  expect(result.toolCalls[0].argsRaw).toContain("***");
});

test("chave ecoada em args com escapes JSON: redigida DEPOIS do parse (F6)", async () => {
  // O texto bruto do wire NÃO contém a chave literal (o 1º caractere vai
  // como \u0073), mas o objeto decodificado a contém: a redação precisa
  // cobrir o resultado do parse, não só o texto bruto.
  const key = "sk-synthetic-escape-echo";
  const escapedKey = "\\u0073k-synthetic-escape-echo";
  const { options } = baseOptions([], {
    apiKey: key,
    fetchImpl: async () => {
      const wire =
        "data: " + JSON.stringify({
          choices: [{
            delta: {
              tool_calls: [
                { function: { arguments: `{"note":"${escapedKey}"}`, name: "pinar_list_sessions" }, id: `call-${key}`, index: 0 },
              ],
            },
          }],
        }) + "\n\n" +
        "data: " + JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }) + "\n\n";
      return new Response(wire);
    },
  });
  const result = await chatStream(options);
  expect(result.toolCalls.length).toBe(1);
  const dumped = JSON.stringify(result.toolCalls);
  expect(dumped).not.toContain(key);
  expect((result.toolCalls[0].args as { note: string }).note).toBe("***");
  // O id do call também é redigido (a appliance pode ecoar a chave nele).
  expect(result.toolCalls[0].id).toContain("***");
  expect(result.toolCalls[0].id).not.toContain(key);
});

test("chave ecoada como NOME de propriedade: redigida e re-serializada sem a chave (#1)", async () => {
  // A appliance pode ecoar a chave como nome de propriedade (aqui com o 1º
  // caractere escapado): a redação cobre nomes E valores, e os argumentos
  // reenviados são a serialização do objeto sanitizado — nunca o bruto,
  // cujo escape ainda decodificaria a chave.
  const key = "sk-synthetic-prop-echo";
  const escapedKey = "\\u0073k-synthetic-prop-echo";
  const { options } = baseOptions([], {
    apiKey: key,
    fetchImpl: async () => {
      const wire =
        "data: " + JSON.stringify({
          choices: [{
            delta: {
              tool_calls: [
                { function: { arguments: `{"${escapedKey}":"x"}`, name: "pinar_list_sessions" }, id: "c1", index: 0 },
              ],
            },
          }],
        }) + "\n\n" +
        "data: " + JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }) + "\n\n";
      return new Response(wire);
    },
  });
  const result = await chatStream(options);
  expect(result.toolCalls.length).toBe(1);
  // Nada da chave sobrevive no resultado serializado.
  expect(JSON.stringify(result.toolCalls)).not.toContain(key);
  // Nem após o JSON.parse dos argumentos reenviados (a serialização é do
  // objeto sanitizado, não do wire bruto).
  const replayed = JSON.parse(result.toolCalls[0].argsRaw) as Record<string, unknown>;
  expect(JSON.stringify(replayed)).not.toContain(key);
  expect(Object.keys(replayed)).toEqual(["***"]);
  expect(replayed["***"]).toBe("x");
});

test("corpo estritamente abaixo de 16 MiB: a fronteira é rejeitada", async () => {
  // O body cresce exatamente 1 byte por caractere ASCII do content:
  // fill = limite - tamanho do body com content vazio.
  const base = baseOptions([]);
  const sizeOf = (fill: number): number => {
    const body = buildChatBody({
      messages: [{ content: "x".repeat(fill), role: "user" }],
      model: base.options.model,
      parallelToolCalls: undefined,
      thinking: "omit",
      tools: base.options.tools,
    });
    return new TextEncoder().encode(JSON.stringify(body)).length;
  };
  const empty = sizeOf(0);
  const fill = 16 * 1024 * 1024 - empty;
  expect(sizeOf(fill)).toBe(16 * 1024 * 1024);
  const { fake, options } = baseOptions([], {
    messages: [{ content: "x".repeat(fill), role: "user" }],
  });
  let caught: unknown;
  try {
    await chatStream(options);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BenchProtocolError);
  expect((caught as Error).message).toContain("16777216");
  expect(fake.requests.length).toBe(0);
});

test("o body carrega flags só quando pedidas", () => {
  const messages: ChatMessage[] = [{ content: "oi", role: "user" }];
  const tools = llmToolDefs(true);
  const omit = buildChatBody({ messages, model: "m", parallelToolCalls: undefined, thinking: "omit", tools });
  expect(omit).not.toHaveProperty("chat_template_kwargs");
  expect(omit).not.toHaveProperty("parallel_tool_calls");
  expect(omit.stream).toBe(true);
  expect(omit.stream_options).toEqual({ include_usage: true });
  expect((omit.tools as Array<{ function: { strict?: boolean } }>)[0].function.strict).toBe(true);

  const off = buildChatBody({ messages, model: "m", parallelToolCalls: false, thinking: "off", tools: [] });
  expect(off.chat_template_kwargs).toEqual({ enable_thinking: false });
  expect(off.parallel_tool_calls).toBe(false);

  const on = buildChatBody({ messages, model: "m", parallelToolCalls: true, thinking: "on", tools: [] });
  expect(on.chat_template_kwargs).toEqual({ enable_thinking: true });
  expect(on.parallel_tool_calls).toBe(true);
});

test("baseUrl não-HTTPS é rejeitado pelo cliente exportado, sem enviar nada", async () => {
  const { fake, options } = baseOptions([], { baseUrl: "http://appliance.example/v1" });
  let caught: unknown;
  try {
    await chatStream(options);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BenchProtocolError);
  expect((caught as Error).message).toBe("baseUrl must use HTTPS");
  expect(fake.requests.length).toBe(0);
});
