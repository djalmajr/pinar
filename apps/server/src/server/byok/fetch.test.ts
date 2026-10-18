import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ByokEgressGuard } from "../cloud-api";
import { ByokEgressUnavailableError, byokFetch, type ByokEgress } from "./fetch";

// The fake guard field: records what byokFetch sends and answers with the
// canned response. The destination never leaves the x-edger-egress-url
// header (asserted below), and this fake is the only network the tests use.
function fakeGuard(answer: (input: string, init: RequestInit | undefined) => Response): {
  calls: Array<{ input: string; init: RequestInit | undefined }>;
  guard: ByokEgressGuard;
} {
  const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
  const guard: ByokEgressGuard = {
    fetch: (input, init) => {
      calls.push({ input, init });
      return Promise.resolve(answer(input, init));
    },
    host: "edger-egress.invalid",
  };
  return { calls, guard };
}

const DESTINATION = "https://api.example.test/v1/chat/completions";

describe("byokFetch without the guard (F5/S1, A55)", () => {
  test("refuses with ByokEgressUnavailableError", async () => {
    // The EdgeR has not injected the guard: no egress at all, and no
    // fallback. Its signal is the EDGER_EGRESS_SOCKET the EdgeR injects, so
    // the refusal stands for any env without the field (EDG-38 §2).
    await assert.rejects(
      byokFetch({}, DESTINATION, { method: "POST" }),
      (error: unknown) => error instanceof ByokEgressUnavailableError,
    );
  });

  test("the refusal carries no value, so it can be surfaced or logged safely", async () => {
    const url = "https://api.example.test/v1?sk-byok-test-secret=1";
    await assert.rejects(
      byokFetch({}, url),
      (error: unknown) =>
        error instanceof ByokEgressUnavailableError
        && !String(error.message).includes("api.example.test")
        && !String(error.message).includes("sk-byok-test-secret"),
    );
  });

  test("the signature is the injectable egress of the BYOK layer", async () => {
    // S2's capability tests (and their fakes) receive an egress through this
    // same signature; without the field it is a refusal.
    const egress: ByokEgress = (url, init) => byokFetch({}, url, init);
    await assert.rejects(egress("https://api.example.test/v1/models"), (error: unknown) => error instanceof ByokEgressUnavailableError);
  });
});

describe("byokFetch with the guard (F5/S6a, EDG-38 §2)", () => {
  test("calls http://<host>/ and puts the destination in x-edger-egress-url", async () => {
    const { calls, guard } = fakeGuard(() => new Response("ok"));
    const response = await byokFetch({ BYOK_EGRESS: guard }, DESTINATION, { method: "POST" });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.input, "http://edger-egress.invalid/");
    const headers = calls[0]!.init?.headers;
    assert.ok(headers instanceof Headers);
    assert.equal(headers.get("x-edger-egress-url"), DESTINATION);
  });

  test("x-edger-egress-url replaces any value the caller sent", async () => {
    const { calls, guard } = fakeGuard(() => new Response("ok"));
    await byokFetch({ BYOK_EGRESS: guard }, DESTINATION, {
      headers: { "x-edger-egress-url": "https://injected.example/v1" },
    });
    const headers = calls[0]!.init?.headers;
    assert.ok(headers instanceof Headers);
    assert.equal(headers.get("x-edger-egress-url"), DESTINATION);
  });

  test("the method, the Authorization, the other headers, the body and the signal arrive", async () => {
    const { calls, guard } = fakeGuard(() => new Response("ok"));
    const controller = new AbortController();
    await byokFetch(
      { BYOK_EGRESS: guard },
      DESTINATION,
      {
        body: '{"model":"chat-model"}',
        headers: { Authorization: "Bearer sk-byok-test-secret", "Content-Type": "application/json" },
        method: "POST",
        signal: controller.signal,
      },
    );
    assert.equal(calls.length, 1);
    const init = calls[0]!.init!;
    assert.equal(init.method, "POST");
    assert.equal(init.body, '{"model":"chat-model"}');
    assert.equal(init.signal, controller.signal);
    const headers = init.headers as Headers;
    assert.equal(headers.get("authorization"), "Bearer sk-byok-test-secret");
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(headers.get("x-edger-egress-url"), DESTINATION);
  });

  test("the response comes back untouched, a streaming body read in chunks included", async () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    const chunks = ['{"choices":[', '1]}'];
    let next = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (next < chunks.length) {
          controller.enqueue(bytes(chunks[next]!));
          next += 1;
        } else {
          controller.close();
        }
      },
    });
    const canned = new Response(body, { headers: { "content-type": "application/json" }, status: 200 });
    const { guard } = fakeGuard(() => canned);
    const response = await byokFetch({ BYOK_EGRESS: guard }, DESTINATION);
    assert.equal(response, canned, "the response is not wrapped");
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const parts: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(new TextDecoder().decode(value));
    }
    assert.deepEqual(parts, chunks, "the body streams in the same pieces, untouched");
  });

  test("an aborted AbortSignal reaches the field's function", async () => {
    const { calls, guard } = fakeGuard(() => new Response("ok"));
    const controller = new AbortController();
    controller.abort();
    await byokFetch({ BYOK_EGRESS: guard }, DESTINATION, { signal: controller.signal });
    const signal = calls[0]!.init?.signal;
    assert.equal(signal, controller.signal);
    assert.equal(signal!.aborted, true);
  });

  test("no path calls the global fetch with the destination", async () => {
    // The global fetch fails the test if any path (the guard call, the
    // refusal or an error) reaches it with the destination.
    const called: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: unknown) => {
      called.push(String(input));
      return Promise.reject(new Error("direct fetch to the destination"));
    }) as typeof fetch;
    try {
      const { guard } = fakeGuard(() => new Response("ok"));
      const response = await byokFetch({ BYOK_EGRESS: guard }, DESTINATION, { method: "POST" });
      assert.equal(response.status, 200, "the field's fetch answers, not the global one");
      await assert.rejects(
        byokFetch({}, DESTINATION, { method: "POST" }),
        (error: unknown) => error instanceof ByokEgressUnavailableError,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.deepEqual(called, [], "the global fetch was never called");
  });
});
