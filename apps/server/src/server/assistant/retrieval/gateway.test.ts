import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  assistantIndexCostLog,
  GATEWAY_OPENAI_BASE_URL,
  gatewayIndexCost,
  gatewayPrivacyOptions,
  gatewayResponseCostMicros,
  priceTimesTokensMicros,
  recordIndexCost,
  usageTokens,
  type IndexCostEntry,
} from "./gateway";

describe("gateway call options", () => {
  test("the OpenAI-compatible base URL of the contract", () => {
    assert.equal(GATEWAY_OPENAI_BASE_URL, "https://ai-gateway.vercel.sh/v1");
  });

  test("disallowPromptTraining always; zeroDataRetention only when asked", () => {
    assert.deepEqual(gatewayPrivacyOptions({ zeroDataRetention: false }), { gateway: { disallowPromptTraining: true } });
    assert.deepEqual(gatewayPrivacyOptions({ zeroDataRetention: true }), { gateway: { disallowPromptTraining: true, zeroDataRetention: true } });
  });
});

describe("gateway costs", () => {
  test("providerMetadata.gateway in USD micros, rounded up: marketCost wins, else cost; anything else is null", () => {
    // BYOK: cost is 0 and the real cost is marketCost (the 2026-10-17 live shape).
    assert.equal(
      gatewayResponseCostMicros({ providerMetadata: { gateway: { cost: "0", marketCost: "0.0000035", surchargeCost: "0", gatewayCost: "0", enabledDisallowPromptTraining: true } } }),
      4,
      "0.0000035 USD = 3.5 micros, rounded up; not the 0 of cost",
    );
    // system credential: cost and marketCost are equal.
    assert.equal(gatewayResponseCostMicros({ providerMetadata: { gateway: { cost: "0.0000264", marketCost: "0.0000264" } } }), 27, "0.0000264 USD = 26.4 micros, rounded up");
    // without marketCost the cost is used, as before.
    assert.equal(gatewayResponseCostMicros({ providerMetadata: { gateway: { cost: "0.00000012" } } }), 1);
    assert.equal(gatewayResponseCostMicros({ providerMetadata: { gateway: { cost: "0.0011" } } }), 1100);
    assert.equal(gatewayResponseCostMicros({ providerMetadata: { gateway: { cost: "0" } } }), 0);
    // a malformed marketCost falls back to the cost, and vice versa.
    assert.equal(gatewayResponseCostMicros({ providerMetadata: { gateway: { cost: "0.000005", marketCost: "n/a" } } }), 5);
    assert.equal(gatewayResponseCostMicros({ providerMetadata: { gateway: { cost: "0.001", marketCost: "1e-6" } } }), 1000);
    assert.equal(gatewayResponseCostMicros({ providerMetadata: { gateway: { cost: "-0.001", marketCost: "0.000005" } } }), 5);
    // a numeric marketCost is not a decimal string: it does not shadow the cost.
    assert.equal(gatewayResponseCostMicros({ providerMetadata: { gateway: { cost: "0", marketCost: 0.0000035 } } }), 0);
    for (const body of [
      null,
      {},
      { providerMetadata: {} },
      { providerMetadata: { gateway: {} } },
      { providerMetadata: { gateway: { cost: 0.001 } } },
      { providerMetadata: { gateway: { cost: "-0.001" } } },
      { providerMetadata: { gateway: { cost: "1e-6" } } },
      { providerMetadata: { gateway: { cost: "" } } },
      { providerMetadata: { gateway: { cost: "-0.001", marketCost: "-1" } } },
      { providerMetadata: { gateway: { marketCost: 0.0000035 } } },
      { providerMetadata: { gateway: [] } },
      { cost: "0.001" },
    ]) {
      assert.equal(gatewayResponseCostMicros(body), null, JSON.stringify(body));
    }
  });

  test("price × tokens is exact and rounded up", () => {
    assert.equal(priceTimesTokensMicros("0.00000002", 1000), 20);
    assert.equal(priceTimesTokensMicros("0.00000002", 1), 1, "0.02 micros rounds up to 1");
    assert.equal(priceTimesTokensMicros("0.00000002", 0), 0);
    assert.equal(priceTimesTokensMicros("0.000000135", 3), 1);
    assert.equal(priceTimesTokensMicros("0.000000135", 10_000), 1350);
    assert.equal(priceTimesTokensMicros("2", 3), 6_000_000);
    for (const [price, tokens] of [[null, 10], ["0.1", null], ["abc", 10], ["-0.1", 10], ["0.1", -1], ["0.1", 1.5]] as const) {
      assert.equal(priceTimesTokensMicros(price, tokens), null, `${price} × ${tokens}`);
    }
  });

  test("usage tokens are read only as non-negative integers", () => {
    assert.equal(usageTokens({ usage: { prompt_tokens: 12 } }, "prompt_tokens"), 12);
    for (const body of [null, {}, { usage: null }, { usage: { prompt_tokens: "12" } }, { usage: { prompt_tokens: -1 } }, { usage: { prompt_tokens: 1.5 } }]) {
      assert.equal(usageTokens(body, "prompt_tokens"), null, JSON.stringify(body));
    }
  });

  test("the gateway's figure first (marketCost, else cost), then the table, then none", () => {
    let tableCalls = 0;
    const table = (value: number | null) => () => {
      tableCalls += 1;
      return value;
    };
    assert.deepEqual(gatewayIndexCost({ providerMetadata: { gateway: { cost: "0", marketCost: "0.0000035" } } }, table(99)), { costSource: "gateway", costUsdMicros: 4 });
    assert.equal(tableCalls, 0, "the table is not read when the gateway reports the marketCost");
    assert.deepEqual(gatewayIndexCost({ providerMetadata: { gateway: { cost: "0.000005" } } }, table(99)), { costSource: "gateway", costUsdMicros: 5 });
    assert.equal(tableCalls, 0, "the table is not read when the gateway reports the cost");
    assert.deepEqual(gatewayIndexCost({ providerMetadata: { gateway: { cost: "n/a" } } }, table(99)), { costSource: "table", costUsdMicros: 99 });
    assert.equal(tableCalls, 1);
    assert.deepEqual(gatewayIndexCost({ providerMetadata: { gateway: { cost: "n/a", marketCost: "1e-6" } } }, table(99)), { costSource: "table", costUsdMicros: 99 });
    assert.equal(tableCalls, 2, "both figures malformed: the table is used");
    assert.deepEqual(gatewayIndexCost({}, table(0)), { costSource: "table", costUsdMicros: 0 });
    assert.deepEqual(gatewayIndexCost({}, table(null)), { costSource: "none", costUsdMicros: null });
  });
});

describe("assistantIndexCostLog", () => {
  const lines: unknown[][] = [];
  let original: typeof console.log;
  beforeEach(() => {
    lines.length = 0;
    original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args);
    };
  });
  afterEach(() => {
    console.log = original;
  });

  test("one JSON line with exactly message, kind, model, costUsdMicros and costSource", () => {
    assistantIndexCostLog({ costSource: "table", costUsdMicros: 20, kind: "embedding", model: "openai/text-embedding-3-small" });
    assistantIndexCostLog({ costSource: "none", costUsdMicros: null, kind: "caption", model: "anthropic/claude-haiku-5.5" });
    assert.equal(lines.length, 2);
    assert.ok(lines.every((args) => args.length === 1 && typeof args[0] === "string"));
    assert.equal(lines[0]![0], '{"message":"assistant_index_cost","kind":"embedding","model":"openai/text-embedding-3-small","costUsdMicros":20,"costSource":"table"}');
    assert.equal(lines[1]![0], '{"message":"assistant_index_cost","kind":"caption","model":"anthropic/claude-haiku-5.5","costUsdMicros":null,"costSource":"none"}');
  });

  test("fields outside the entry never reach the line", () => {
    const entry = { apiKey: "vck-secret", baseUrl: GATEWAY_OPENAI_BASE_URL, costSource: "gateway" as const, costUsdMicros: 1, kind: "embedding" as const, model: "m", text: "texto da pessoa" };
    assistantIndexCostLog(entry);
    assert.deepEqual(Object.keys(JSON.parse(String(lines[0]![0]))), ["message", "kind", "model", "costUsdMicros", "costSource"]);
    for (const forbidden of ["vck-secret", "ai-gateway", "https://", "texto da pessoa"]) assert.ok(!String(lines[0]![0]).includes(forbidden), forbidden);
  });
});

describe("recordIndexCost", () => {
  const entry: IndexCostEntry = { costSource: "gateway", costUsdMicros: 7, kind: "embedding", model: "openai/text-embedding-3-small" };
  const errors: unknown[][] = [];
  let original: typeof console.error;
  beforeEach(() => {
    errors.length = 0;
    original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
  });
  afterEach(() => {
    console.error = original;
  });

  test("hands the entry to the call's recorder and waits for it; without one, nothing", async () => {
    const recorded: IndexCostEntry[] = [];
    let settled = false;
    await recordIndexCost({ record: async (item) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      recorded.push(item);
      settled = true;
    }, zeroDataRetention: false }, entry);
    assert.equal(settled, true, "awaited");
    assert.deepEqual(recorded, [entry]);
    await recordIndexCost({ zeroDataRetention: false }, entry);
    assert.deepEqual(errors, []);
  });

  test("a failing recorder is logged with the kind and model only, and does not throw", async () => {
    await recordIndexCost({ record: async () => {
      throw new Error("D1_ERROR: no such table: assistant_index_costs vck-secret");
    }, zeroDataRetention: false }, entry);
    assert.deepEqual(errors.map((args) => args.map(String)), [
      ['{"message":"assistant_index_cost_record_failed","kind":"embedding","model":"openai/text-embedding-3-small"}'],
    ]);
  });
});
