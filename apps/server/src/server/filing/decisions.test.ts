import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AssistantEndpoint } from "../assistant/models";
import { chooseCollection, FILING_NONE_OPTION, type FilingCandidate, type FilingChoice } from "./choose";
import { decideCollection } from "./decisions";

const endpoint: AssistantEndpoint = {
  apiKey: "decisions-key",
  baseUrl: "https://appliance.example/v1/",
  kind: "appliance",
  model: "qwen3.8-27b",
  thinkingControl: true,
};
const engine = { endpoint, kind: "decisions" } as const;

const candidates: FilingCandidate[] = [
  {
    collectionId: "c-bugs",
    examples: ["Checkout button misaligned", "Login\nerror"],
    label: "Pinar / Bugs",
    lastUsedAt: "2026-10-16T10:00:00.000Z",
  },
  { collectionId: "c-ideas", examples: [], label: "Pinar / Ideas", lastUsedAt: null },
];

const text = "Page: Cart\nURL: https://shop.example/cart\nPin #1: Button overlaps the total";

type Call = { body: Record<string, unknown>; init: RequestInit; url: string };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { body: JSON.parse(String(init?.body)), init: init ?? {}, url: String(input) };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, fetch };
}

function decisionsResponse(choice: string, probabilities: Record<string, unknown>): Response {
  return Response.json({
    decisions: [{ choice, id: "collection", probabilities }],
    model: "qwen3.8-27b",
    object: "decision.list",
    usage: { completion_tokens: 1, prompt_tokens: 120, total_tokens: 121 },
  });
}

const failure = (reason: "error" | "timeout"): FilingChoice => ({ collectionId: null, confidence: 0, engine: "decisions", reason });

describe("chooseCollection with the decisions engine", () => {
  test("posts one question with the labels, None of these last, and the examples in the instructions", async () => {
    const fake = fakeFetch(() => decisionsResponse("Pinar / Bugs", { "None of these": 0.04, "Pinar / Bugs": 0.9, "Pinar / Ideas": 0.06 }));
    const choice = await chooseCollection({ candidates, engine, fetch: fake.fetch, text });
    assert.deepEqual(choice, { collectionId: "c-bugs", confidence: 0.9, engine: "decisions", reason: "chosen" });

    assert.equal(fake.calls.length, 1);
    const [call] = fake.calls;
    assert.equal(call!.url, "https://appliance.example/v1/decisions");
    assert.equal(call!.init.method, "POST");
    assert.equal(call!.init.redirect, "manual");
    assert.deepEqual(call!.init.headers, { Authorization: "Bearer decisions-key", "Content-Type": "application/json" });
    assert.deepEqual(call!.body, {
      instructions: [
        "A web page capture is filed into one of these collections, listed with titles of captures already in them:",
        '- "Pinar / Bugs" (recent captures: "Checkout button misaligned", "Login error")',
        '- "Pinar / Ideas" (no captures yet)',
        'Answer "None of these" when no collection clearly fits the capture.',
      ].join("\n"),
      model: "qwen3.8-27b",
      questions: [
        {
          id: "collection",
          options: ["Pinar / Bugs", "Pinar / Ideas", FILING_NONE_OPTION],
          question: "Which collection should this capture go to?",
        },
      ],
      state: text,
    });
    assert.ok(!String(call!.init.body).includes("decisions-key"));
  });

  test("files at a probability of exactly 0.7 and sends to the Inbox just below it", async () => {
    // Mutation captured: `>=` → `>` on FILING_DECISIONS_MIN sends the 0.7 case to the Inbox.
    const at = fakeFetch(() => decisionsResponse("Pinar / Bugs", { "None of these": 0.1, "Pinar / Bugs": 0.7, "Pinar / Ideas": 0.2 }));
    assert.deepEqual(await chooseCollection({ candidates, engine, fetch: at.fetch, text }), {
      collectionId: "c-bugs",
      confidence: 0.7,
      engine: "decisions",
      reason: "chosen",
    });

    // Mutation captured: dropping the threshold files the 0.69 case.
    const below = fakeFetch(() => decisionsResponse("Pinar / Bugs", { "None of these": 0.1, "Pinar / Bugs": 0.69, "Pinar / Ideas": 0.21 }));
    assert.deepEqual(await chooseCollection({ candidates, engine, fetch: below.fetch, text }), {
      collectionId: null,
      confidence: 0.69,
      engine: "decisions",
      reason: "low_confidence",
    });
  });

  test("None of these goes to the Inbox, whatever its probability, with the best label's probability", async () => {
    const fake = fakeFetch(() => decisionsResponse(FILING_NONE_OPTION, { "None of these": 0.8, "Pinar / Bugs": 0.15, "Pinar / Ideas": 0.05 }));
    assert.deepEqual(await chooseCollection({ candidates, engine, fetch: fake.fetch, text }), {
      collectionId: null,
      confidence: 0.15,
      engine: "decisions",
      reason: "low_confidence",
    });

    const onlyNone = fakeFetch(() => decisionsResponse(FILING_NONE_OPTION, { "None of these": 1 }));
    assert.deepEqual(await chooseCollection({ candidates, engine, fetch: onlyNone.fetch, text }), {
      collectionId: null,
      confidence: 0,
      engine: "decisions",
      reason: "low_confidence",
    });
  });

  const malformed: Array<[string, () => Response]> = [
    ["no decisions", () => Response.json({ object: "decision.list" })],
    ["an empty decisions list", () => Response.json({ decisions: [] })],
    ["a decision for another question", () => Response.json({ decisions: [{ choice: "Pinar / Bugs", id: "other", probabilities: { "Pinar / Bugs": 1 } }] })],
    [
      "a second decision",
      () =>
        Response.json({
          decisions: [
            { choice: "Pinar / Bugs", id: "collection", probabilities: { "Pinar / Bugs": 1 } },
            { choice: "Pinar / Ideas", id: "collection", probabilities: { "Pinar / Ideas": 1 } },
          ],
        }),
    ],
    ["a choice outside the options", () => decisionsResponse("Pinar / Other", { "Pinar / Other": 0.9 })],
    ["a choice that is not a string", () => Response.json({ decisions: [{ choice: 0, id: "collection", probabilities: {} }] })],
    ["a probability given as a string", () => decisionsResponse("Pinar / Bugs", { "Pinar / Bugs": "0.9", "Pinar / Ideas": 0.1 })],
    ["a null probability", () => decisionsResponse("Pinar / Bugs", { "Pinar / Bugs": 0.9, "Pinar / Ideas": null })],
    ["a probability above 1", () => decisionsResponse("Pinar / Bugs", { "Pinar / Bugs": 1.5 })],
    ["a negative probability", () => decisionsResponse("Pinar / Bugs", { "Pinar / Bugs": 0.9, "Pinar / Ideas": -0.1 })],
    ["probabilities that are not an object", () => decisionsResponse("Pinar / Bugs", [0.9, 0.1] as unknown as Record<string, unknown>)],
    ["a probability for an unknown option", () => decisionsResponse("Pinar / Bugs", { "Pinar / Bugs": 0.9, "Pinar / Other": 0.1 })],
    ["a choice without its probability", () => decisionsResponse("Pinar / Bugs", { "Pinar / Ideas": 0.1 })],
    ["a choice that is not the most probable", () => decisionsResponse("Pinar / Bugs", { "Pinar / Bugs": 0.3, "Pinar / Ideas": 0.6 })],
    ["probabilities that sum above 1", () => decisionsResponse("Pinar / Bugs", { "None of these": 0.7, "Pinar / Bugs": 0.9, "Pinar / Ideas": 0.8 })],
    ["probabilities that sum below 1", () => decisionsResponse("Pinar / Bugs", { "Pinar / Bugs": 0.8 })],
    ["a body that is not JSON", () => new Response("not json", { status: 200 })],
    ["status 500", () => new Response("upstream down", { status: 500 })],
  ];
  for (const [name, respond] of malformed) {
    test(`answers error for ${name}`, async () => {
      const fake = fakeFetch(respond);
      assert.deepEqual(await chooseCollection({ candidates, engine, fetch: fake.fetch, text }), failure("error"));
      assert.equal(fake.calls.length, 1);
    });
  }

  test("answers error on a network failure", async () => {
    const fake = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    assert.deepEqual(await chooseCollection({ candidates, engine, fetch: fake.fetch, text }), failure("error"));
  });

  test("refuses a redirect without following it", async () => {
    const fake = fakeFetch(() => new Response(null, { headers: { Location: "https://evil.example/v1/decisions" }, status: 302 }));
    assert.deepEqual(await chooseCollection({ candidates, engine, fetch: fake.fetch, text }), failure("error"));
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0]!.url, "https://appliance.example/v1/decisions");
  });

  for (const baseUrl of [
    "http://appliance.example/v1",
    "https://user:secret@appliance.example/v1",
    "https://appliance.example/v1?key=secret",
    "https://appliance.example/v1#fragment",
    "ftp://appliance.example/v1",
    "not a url",
  ]) {
    test(`refuses the base URL ${JSON.stringify(baseUrl)} without a request`, async () => {
      const fake = fakeFetch(() => decisionsResponse("Pinar / Bugs", { "Pinar / Bugs": 1 }));
      const choice = await chooseCollection({ candidates, engine: { endpoint: { ...endpoint, baseUrl }, kind: "decisions" }, fetch: fake.fetch, text });
      assert.deepEqual(choice, failure("error"));
      assert.equal(fake.calls.length, 0);
    });
  }

  test("answers timeout within 3.5 s when the endpoint never answers", async () => {
    // The fetch ignores its signal too: the race alone has to end the wait.
    const fake = fakeFetch(() => new Promise<Response>(() => {}));
    const started = performance.now();
    const choice = await chooseCollection({ candidates, engine, fetch: fake.fetch, text });
    const elapsed = performance.now() - started;
    assert.deepEqual(choice, failure("timeout"));
    assert.equal(fake.calls.length, 1);
    assert.ok(elapsed >= 2900 && elapsed < 3500, `elapsed ${elapsed} ms`);
  });

  test("the deadline aborts the request itself", async () => {
    const fake = fakeFetch(
      (call) =>
        new Promise<Response>((_, reject) => {
          call.init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    assert.deepEqual(await chooseCollection({ candidates, engine, fetch: fake.fetch, text, timeoutMs: 50 }), failure("timeout"));
    assert.equal(fake.calls[0]!.init.signal!.aborted, true);
  });

  test("an aborted caller signal sends nothing", async () => {
    const fake = fakeFetch(() => decisionsResponse("Pinar / Bugs", { "Pinar / Bugs": 1 }));
    const controller = new AbortController();
    controller.abort();
    assert.deepEqual(await chooseCollection({ candidates, engine, fetch: fake.fetch, signal: controller.signal, text }), failure("error"));
    await assert.rejects(decideCollection({ candidates, endpoint, fetch: fake.fetch, signal: controller.signal, text }));
    assert.equal(fake.calls.length, 0);
  });

  test("the caller's signal cuts a request in flight", async () => {
    const controller = new AbortController();
    const fake = fakeFetch(() => {
      setTimeout(() => controller.abort(), 10);
      return new Promise<Response>(() => {});
    });
    const started = performance.now();
    assert.deepEqual(await chooseCollection({ candidates, engine, fetch: fake.fetch, signal: controller.signal, text }), failure("error"));
    assert.ok(performance.now() - started < 1000);
    assert.equal(fake.calls[0]!.init.signal!.aborted, true);
  });
});

describe("decideCollection errors", () => {
  const secrets = ["appliance.example", "decisions-key", "upstream", "Pinar / Bugs"];
  const cases: Array<[string, () => Response, string]> = [
    ["status", () => new Response("upstream says decisions-key", { status: 500 }), "decisions request failed (status 500)"],
    ["invalid JSON", () => new Response("upstream {", { status: 200 }), "decisions request returned invalid JSON"],
    ["malformed", () => Response.json({ decisions: [{ choice: "Pinar / Bugs", id: "upstream" }] }), "decisions response invalid"],
    ["redirect", () => new Response(null, { headers: { Location: "https://appliance.example/x" }, status: 307 }), "assistant endpoint redirect refused"],
    [
      "network",
      () => {
        throw new TypeError("connect failed to https://appliance.example with decisions-key");
      },
      "decisions request failed",
    ],
  ];
  for (const [name, respond, message] of cases) {
    test(`a ${name} failure carries a fixed message, never the URL, the key or a body`, async () => {
      const fake = fakeFetch(respond);
      const error = await decideCollection({ candidates, endpoint, fetch: fake.fetch, text }).then(
        () => assert.fail("expected a rejection"),
        (reason: unknown) => reason as Error,
      );
      assert.equal(error.message, message);
      for (const secret of secrets) assert.ok(!error.message.includes(secret), `${name} leaks ${secret}`);
    });
  }
});
