import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateArgs, type ToolInputSchema } from "./validate";

const schema: ToolInputSchema = {
  properties: {
    limit: { maximum: 50, minimum: 1, type: "integer" },
    name: { maxLength: 80, type: "string" },
  },
  required: ["limit"],
  type: "object",
};

describe("validateArgs (moved from scripts/assistant-bench/tools.ts)", () => {
  test("valid arguments pass", () => {
    assert.deepEqual(validateArgs(schema, { limit: 5, name: "ok" }), []);
  });

  test("required field missing", () => {
    assert.deepEqual(validateArgs(schema, { name: "x" }), ["limit is missing"]);
  });

  test("wrong type and bounds are reported", () => {
    assert.deepEqual(validateArgs(schema, { limit: "five" }), ["limit has invalid type (expected integer)"]);
    assert.deepEqual(validateArgs(schema, { limit: 0 }), ["limit is below minimum 1"]);
    assert.deepEqual(validateArgs(schema, { limit: 51 }), ["limit is above maximum 50"]);
    assert.deepEqual(validateArgs(schema, { limit: 1, name: "n".repeat(81) }), ["name exceeds maxLength 80"]);
  });

  test("undeclared properties are reported", () => {
    assert.deepEqual(validateArgs(schema, { limit: 1, extra: true }), ["extra is not declared"]);
  });

  test("arguments must be a JSON object", () => {
    assert.deepEqual(validateArgs(schema, ["nope"]), ["arguments must be a JSON object"]);
    assert.deepEqual(validateArgs(schema, null), ["arguments must be a JSON object"]);
  });

  test("anyOf accepts one variant and reports when none match", () => {
    // (the top-level arguments are always a JSON object, so the variants
    // are object shapes, as in the real tool inputSchemas)
    const variants: ToolInputSchema = {
      anyOf: [
        { properties: { a: { type: "string" } }, required: ["a"], type: "object" },
        { properties: { n: { type: "integer" } }, required: ["n"], type: "object" },
      ],
    };
    assert.deepEqual(validateArgs(variants, { a: "x" }), []);
    assert.deepEqual(validateArgs(variants, { n: 1 }), []);
    const problems = validateArgs(variants, { n: "x" });
    assert.equal(problems.length, 1);
    assert.ok(problems[0].includes("does not match any allowed variant"), problems[0]);
  });

  test("nested properties and array items", () => {
    const nested: ToolInputSchema = {
      properties: { inner: { properties: { tag: { type: "string" } }, required: ["tag"], type: "object" } },
      required: ["inner"],
      type: "object",
    };
    assert.deepEqual(validateArgs(nested, {}), ["inner is missing"]);
    assert.deepEqual(validateArgs(nested, { inner: {} }), ["inner.tag is missing"]);
    assert.deepEqual(validateArgs(nested, { inner: { tag: 1 } }), ["inner.tag has invalid type (expected string)"]);

    const items: ToolInputSchema = {
      properties: { tags: { items: { type: "string" }, type: "array" } },
      type: "object",
    };
    assert.deepEqual(validateArgs(items, { tags: ["a", 1] }), ["tags[1] has invalid type (expected string)"]);
  });
});
