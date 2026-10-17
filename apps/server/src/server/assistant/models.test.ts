import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { generateText } from "ai";
import {
  assistantLanguageModel,
  assistantProviderOptions,
  detectThinkingControl,
  resetThinkingControlCacheForTests,
  type AssistantEndpoint,
} from "./models";

// Fake fetch that captures URL, headers and (when present) the parsed JSON
// body, and answers with a fixed response.
function fakeFetch(response: () => Response) {
  const calls: { body?: unknown; headers: Record<string, string>; url: string }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers as HeadersInit | undefined).entries());
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ body, headers, url });
    return response();
  }) as typeof fetch;
  return { calls, fetch };
}

function chatResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", index: 0, message: { content, role: "assistant" } }],
      id: "chatcmpl-1",
      model: "mock-model",
      usage: { completion_tokens: 2, prompt_tokens: 1, total_tokens: 3 },
    }),
    { headers: { "content-type": "application/json" }, status: 200 },
  );
}

const appliance: AssistantEndpoint = {
  apiKey: "appliance-key",
  baseUrl: "https://appliance.example/v1",
  kind: "appliance",
  model: "pinar-1",
  thinkingControl: true,
};

const byok: AssistantEndpoint = {
  apiKey: "sk-byok-key",
  baseUrl: "https://byok.example/v1",
  kind: "openai-compatible",
  model: "gpt-mock",
  thinkingControl: false,
};

describe("assistantLanguageModel + assistantProviderOptions", () => {
  test("thinkingControl=true puts chat_template_kwargs.enable_thinking=false in the body (appliance)", async () => {
    const { calls, fetch } = fakeFetch(() => chatResponse("ok"));
    const model = assistantLanguageModel(appliance, {
      conversationId: "conv-1",
      fetch,
      requestId: "req-1",
    });
    const { text } = await generateText({
      maxRetries: 0,
      messages: [{ content: "oi", role: "user" }],
      model,
      providerOptions: assistantProviderOptions(appliance),
    });
    assert.equal(text, "ok");
    const call = calls[0];
    assert.equal(call.url, "https://appliance.example/v1/chat/completions");
    assert.equal(call.body["model"], "pinar-1");
    assert.deepEqual(call.body["chat_template_kwargs"], { enable_thinking: false });
  });

  test("thinkingControl=true on byok puts the same key under the byok name and in the body", async () => {
    const endpoint: AssistantEndpoint = { ...byok, thinkingControl: true };
    const options = assistantProviderOptions(endpoint);
    assert.deepEqual(options, {
      byok: { chat_template_kwargs: { enable_thinking: false } },
    });
    const { calls, fetch } = fakeFetch(() => chatResponse("ok"));
    const model = assistantLanguageModel(endpoint, { conversationId: "conv-2", fetch, requestId: "req-2" });
    const { text } = await generateText({
      maxRetries: 0,
      messages: [{ content: "oi", role: "user" }],
      model,
      providerOptions: options,
    });
    assert.equal(text, "ok");
    assert.deepEqual(calls[0].body["chat_template_kwargs"], { enable_thinking: false });
  });

  test("thinkingControl=false keeps providerOptions empty and the body without the key", async () => {
    const options = assistantProviderOptions(byok);
    assert.deepEqual(options, {});
    const { calls, fetch } = fakeFetch(() => chatResponse("ok"));
    const model = assistantLanguageModel(byok, { conversationId: "conv-3", fetch, requestId: "req-3" });
    await generateText({
      maxRetries: 0,
      messages: [{ content: "oi", role: "user" }],
      model,
      providerOptions: options,
    });
    assert.equal(calls[0].body["chat_template_kwargs"], undefined);
  });

  test("X-Conversation-Id and X-Request-Id appear only on the appliance; the key goes to Authorization", async () => {
    const applianceFake = fakeFetch(() => chatResponse("ok"));
    const applianceModel = assistantLanguageModel(appliance, {
      conversationId: "conv-1",
      fetch: applianceFake.fetch,
      requestId: "req-1",
    });
    await generateText({ maxRetries: 0, messages: [{ content: "oi", role: "user" }], model: applianceModel });
    // header names are normalized to lowercase by the Headers capture
    assert.equal(applianceFake.calls[0].headers["x-conversation-id"], "conv-1");
    assert.equal(applianceFake.calls[0].headers["x-request-id"], "req-1");
    assert.equal(applianceFake.calls[0].headers["authorization"], "Bearer appliance-key");

    const byokFake = fakeFetch(() => chatResponse("ok"));
    const byokModel = assistantLanguageModel(byok, {
      conversationId: "conv-2",
      fetch: byokFake.fetch,
      requestId: "req-2",
    });
    await generateText({ maxRetries: 0, messages: [{ content: "oi", role: "user" }], model: byokModel });
    assert.equal(byokFake.calls[0].headers["x-conversation-id"], undefined);
    assert.equal(byokFake.calls[0].headers["x-request-id"], undefined);
    assert.equal(byokFake.calls[0].headers["authorization"], "Bearer sk-byok-key");
  });

  test("a 302 is refused with 'assistant endpoint redirect refused' and no URL in the message", async () => {
    const { fetch } = fakeFetch(() => new Response(null, { headers: { location: "https://evil.example/steal" }, status: 302 }));
    const model = assistantLanguageModel(appliance, { conversationId: "conv-1", fetch, requestId: "req-1" });
    await assert.rejects(
      async () => {
        await generateText({ maxRetries: 0, messages: [{ content: "oi", role: "user" }], model });
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.ok(message.includes("assistant endpoint redirect refused"), message);
        assert.ok(!message.includes("evil.example"), "the redirect target must not leak");
        assert.ok(!message.includes("appliance.example"), "the endpoint URL must not leak");
        return true;
      },
    );
  });

  test("invalid URLs are refused with 'invalid assistant endpoint', never echoing the URL or key", () => {
    const context = { conversationId: "c", requestId: "r" };
    const invalid = [
      "http://example.com/v1", // http off loopback
      "http://10.0.0.5/v1",
      "ftp://localhost/v1", // other protocol
      "https://user:pass@example.com/v1", // userinfo
      "https://example.com/v1?k=secret", // query
      "https://example.com/v1#frag", // fragment
      "not a url",
    ];
    for (const baseUrl of invalid) {
      assert.throws(
        () =>
          assistantLanguageModel(
            { apiKey: "sk-secret", baseUrl, kind: "openai-compatible", model: "m", thinkingControl: false },
            context,
          ),
        (error: unknown) => {
          assert.ok(error instanceof Error, "must be a plain Error");
          assert.equal(error.message, "invalid assistant endpoint");
          assert.ok(!error.message.includes(baseUrl), "the URL must not leak");
          assert.ok(!error.message.includes("sk-secret"), "the key must not leak");
          return true;
        },
        `expected rejection for ${baseUrl}`,
      );
    }
    // valid URLs do not throw
    const valid = [
      "https://appliance.example/v1",
      "http://localhost:8787/v1",
      "http://127.0.0.1:8787/v1",
      "http://[::1]:8787/v1",
    ];
    for (const baseUrl of valid) {
      assert.doesNotThrow(
        () =>
          assistantLanguageModel(
            { apiKey: "k", baseUrl, kind: "openai-compatible", model: "m", thinkingControl: false },
            context,
          ),
        `expected acceptance for ${baseUrl}`,
      );
    }
  });
});

describe("detectThinkingControl", () => {
  test("returns true only when the model entry advertises the chat_template_kwargs knob", async () => {
    resetThinkingControlCacheForTests();
    const { calls, fetch } = fakeFetch(() =>
      new Response(
        JSON.stringify({
          data: [
            { id: "other", reasoning_control: { via: "chat_template_kwargs.enable_thinking" } },
            { id: "m1", reasoning_control: { via: "chat_template_kwargs.enable_thinking" } },
          ],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    const value = await detectThinkingControl({ apiKey: "k", baseUrl: "https://meta.example/v1", fetch, model: "m1" });
    assert.equal(value, true);
    assert.equal(calls[0].url, "https://meta.example/v1/models");
    assert.equal(calls[0].headers["authorization"], "Bearer k");
  });

  test("returns false when the metadata is absent or the via differs", async () => {
    resetThinkingControlCacheForTests();
    const missing = fakeFetch(() =>
      new Response(JSON.stringify({ data: [{ id: "m1" }] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    assert.equal(
      await detectThinkingControl({ apiKey: "k", baseUrl: "https://meta.example/v1", fetch: missing.fetch, model: "m1" }),
      false,
    );

    const otherVia = fakeFetch(() =>
      new Response(
        JSON.stringify({ data: [{ id: "m1", reasoning_control: { via: "reasoning_effort" } }] }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    assert.equal(
      await detectThinkingControl({ apiKey: "k", baseUrl: "https://meta.example/v1", fetch: otherVia.fetch, model: "m1" }),
      false,
    );
  });

  test("returns false on 500, bad JSON, network error and without leaking the key", async () => {
    resetThinkingControlCacheForTests();
    resetThinkingControlCacheForTests();
    const status500 = fakeFetch(() => new Response("boom", { status: 500 }));
    assert.equal(
      await detectThinkingControl({ apiKey: "k", baseUrl: "https://meta.example/v1", fetch: status500.fetch, model: "m1" }),
      false,
    );

    resetThinkingControlCacheForTests();
    const badJson = fakeFetch(() => new Response("{not json", { headers: { "content-type": "application/json" }, status: 200 }));
    assert.equal(
      await detectThinkingControl({ apiKey: "k", baseUrl: "https://meta.example/v1", fetch: badJson.fetch, model: "m1" }),
      false,
    );

    resetThinkingControlCacheForTests();
    const network = { fetch: (async () => {
      throw new Error("fetch failed");
    }) as typeof fetch };
    assert.equal(
      await detectThinkingControl({ apiKey: "k", baseUrl: "https://meta.example/v1", fetch: network.fetch, model: "m1" }),
      false,
    );

    // without a key there is no Authorization header
    resetThinkingControlCacheForTests();
    const noKey = fakeFetch(() => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await detectThinkingControl({ baseUrl: "https://meta.example/v1", fetch: noKey.fetch, model: "m1" });
    assert.equal(noKey.calls[0].headers["authorization"], undefined);
  });

  test("caches per baseUrl + model for 10 minutes and the test reset drops the cache", async () => {
    resetThinkingControlCacheForTests();
    const { calls, fetch } = fakeFetch(() =>
      new Response(
        JSON.stringify({ data: [{ id: "m1", reasoning_control: { via: "chat_template_kwargs.enable_thinking" } }] }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    const input = { apiKey: "k", baseUrl: "https://meta.example/v1", fetch, model: "m1" };
    assert.equal(await detectThinkingControl(input), true);
    assert.equal(await detectThinkingControl(input), true);
    assert.equal(calls.length, 1, "the second call must come from the cache");

    // a different model or base URL is a different cache entry
    assert.equal(await detectThinkingControl({ ...input, model: "m2" }), false);
    assert.equal(calls.length, 2);

    resetThinkingControlCacheForTests();
    assert.equal(await detectThinkingControl(input), true);
    assert.equal(calls.length, 3, "after the reset the detection runs again");
  });
});
