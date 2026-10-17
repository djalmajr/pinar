import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  assistantIndexCostLog,
  GATEWAY_OPENAI_BASE_URL,
  gatewayIndexCost,
  gatewayPrivacyOptions,
  gatewayResponseCostMicros,
  priceTimesTokensMicros,
  usageTokens,
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
  test("providerMetadata.gateway.cost in USD micros, rounded up; anything else is null", () => {
    assert.equal(gatewayResponseCostMicros({ providerMetadata: { gateway: { cost: "0.00000012" } } }), 1);
    assert.equal(gatewayResponseCostMicros({ providerMetadata: { gateway: { cost: "0.0011" } } }), 1100);
    assert.equal(gatewayResponseCostMicros({ providerMetadata: { gateway: { cost: "0" } } }), 0);
    for (const body of [
      null,
      {},
      { providerMetadata: {} },
      { providerMetadata: { gateway: {} } },
      { providerMetadata: { gateway: { cost: 0.001 } } },
      { providerMetadata: { gateway: { cost: "-0.001" } } },
      { providerMetadata: { gateway: { cost: "1e-6" } } },
      { providerMetadata: { gateway: { cost: "" } } },
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

  test("the gateway's figure first, then the table, then none", () => {
    let tableCalls = 0;
    const table = (value: number | null) => () => {
      tableCalls += 1;
      return value;
    };
    assert.deepEqual(gatewayIndexCost({ providerMetadata: { gateway: { cost: "0.000005" } } }, table(99)), { costSource: "gateway", costUsdMicros: 5 });
    assert.equal(tableCalls, 0, "the table is not read when the gateway reports the cost");
    assert.deepEqual(gatewayIndexCost({ providerMetadata: { gateway: { cost: "n/a" } } }, table(99)), { costSource: "table", costUsdMicros: 99 });
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
