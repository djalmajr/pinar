import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readResponseRecord } from "./api-data";

describe("readResponseRecord", () => {
  test("reads JSON objects", async () => {
    assert.deepEqual(await readResponseRecord(Response.json({ ok: true })), { ok: true });
  });

  test("returns null for non-JSON responses", async () => {
    assert.equal(await readResponseRecord(new Response("404 Not Found", { status: 404 })), null);
  });
});
