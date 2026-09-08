import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { CloudEnv } from "../cloud-api";
import { resetCloudMemoryStateForTests } from "../cloud-api";
import {
  aiEnv,
  getJson,
  isRecord,
  jsonBody,
  paidProCookie,
  postJson,
  uploadCapture,
} from "../../../tests/helpers/cloud-ai";

const PRIMARY = "rgb(0, 105, 168)";
const INK = "rgb(17, 24, 39)";
const WHITE = "rgb(255, 255, 255)";
const INTER = "Inter, system-ui, sans-serif";

function snapshotPin(number: number, root: Record<string, unknown>) {
  return {
    comment: `Pin ${number}`,
    coords: { x: 10 * number, y: 20 },
    number,
    pinId: `pin_design_${number}`,
    snapshot: { fonts: [{ family: "Inter", weight: "600" }], icons: [], nodeCount: 1, root, truncated: false, version: 1 },
    type: "point",
  };
}

function buttonRoot(label: string) {
  return {
    styles: {
      "background-color": PRIMARY,
      "border-radius": "8px",
      "box-shadow": "rgba(0, 0, 0, 0.1) 0px 1px 2px 0px",
      color: WHITE,
      "font-family": INTER,
      "font-size": "14px",
      "font-weight": "600",
      "line-height": "20px",
      padding: "8px 16px",
    },
    tag: "button",
    text: label,
  };
}

function headingRoot(text: string) {
  return {
    styles: { color: INK, "font-family": INTER, "font-size": "32px", "font-weight": "700", "line-height": "40px", "margin-bottom": "24px" },
    tag: "h1",
    text,
  };
}

async function createCollection(cookie: string, env: CloudEnv) {
  const project = await jsonBody(await postJson("/api/projects", { name: "Design" }, cookie, env));
  assert.ok(isRecord(project.project));
  const collection = await jsonBody(await postJson(`/api/projects/${String(project.project.id)}/collections`, { name: "Reference" }, cookie, env));
  assert.ok(isRecord(collection.collection));
  return String(collection.collection.id);
}

async function uploadReferenceCaptures(cookie: string, collectionId: string, env: CloudEnv, count = 10) {
  for (let index = 0; index < count; index += 1) {
    const root = index % 2 === 0 ? buttonRoot(`Action ${index}`) : headingRoot(`Title ${index}`);
    const response = await uploadCapture(cookie, {
      collectionId,
      id: `design_capture_${index}`,
      page: { title: `Page ${index}`, url: `https://acme.test/page-${index % 4}` },
      pins: [snapshotPin(1, root)],
    }, env);
    assert.equal(response.status, 201);
  }
}

async function creditBalance(cookie: string, env: CloudEnv) {
  const body = await jsonBody(await getJson("/api/account/entitlements", cookie, env));
  assert.ok(isRecord(body.aiCredits));
  return body.aiCredits.balance;
}

function modelReply(payload: unknown) {
  return {
    output: [{ content: [{ text: JSON.stringify(payload), type: "output_text" }], type: "message" }],
    usage: { input_tokens: 900, output_tokens: 300 },
  };
}

const NAMED_REPLY = {
  colors: [{ name: "Primary", value: "#0069a8" }, { name: "ink", value: "#111827" }, { name: "ghost", value: "#ff00ff" }],
  fonts: [{ name: "sans", value: "Inter" }],
  identity: "Azul confiante sobre fundos claros. Tipografia Inter com pesos firmes.",
  radii: [{ name: "md", value: "8px" }],
  shadows: [{ name: "sm", value: "rgba(0, 0, 0, 0.1) 0px 1px 2px 0px" }],
  spacing: [{ name: "2", value: "8px" }, { name: "4", value: "16px" }],
  typography: [{ name: "button", size: "14px" }, { name: "display", size: "32px" }],
};

describe("design system extraction", () => {
  beforeEach(() => resetCloudMemoryStateForTests());

  test("rejects a sample below three snapshots without charging credits", async () => {
    // ARRANGE
    let calls = 0;
    const env = aiEnv(async () => {
      calls += 1;
      return modelReply(NAMED_REPLY);
    });
    const paid = await paidProCookie(env);
    const collectionId = await createCollection(paid.cookie, paid.env);
    await uploadReferenceCaptures(paid.cookie, collectionId, paid.env, 2);

    // ACT
    const response = await postJson("/api/ai/design-system", {
      collectionId,
      language: "en",
      requestId: "design_request_too_small_01",
    }, paid.cookie, paid.env);

    // ASSERT
    assert.equal(response.status, 422);
    const body = await jsonBody(response);
    assert.equal(body.code, "insufficient_sample");
    assert.equal(body.pins, 2);
    assert.equal(body.minimum, 3);
    assert.equal(calls, 0);
    assert.equal(await creditBalance(paid.cookie, paid.env), 200);
  });

  test("extracts, names and stores the design system of a collection", async () => {
    // ARRANGE
    const calls: Array<{ input: unknown; model: string }> = [];
    const env = aiEnv(async (model, input) => {
      calls.push({ input, model });
      return modelReply(NAMED_REPLY);
    });
    const paid = await paidProCookie(env);
    const collectionId = await createCollection(paid.cookie, paid.env);
    await uploadReferenceCaptures(paid.cookie, collectionId, paid.env);

    // ACT
    const response = await postJson("/api/ai/design-system", {
      collectionId,
      language: "pt",
      requestId: "design_request_success_01",
    }, paid.cookie, paid.env);

    // ASSERT
    assert.equal(response.status, 200);
    const body = await jsonBody(response);
    assert.equal(body.ok, true);
    assert.equal(body.creditsCharged, 15);
    assert.equal(body.idempotent, false);
    assert.ok(isRecord(body.aiCredits));
    assert.equal(body.aiCredits.balance, 185);
    assert.ok(isRecord(body.usage));
    assert.equal(body.usage.model, "@cf/openai/gpt-oss-120b");

    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, "@cf/openai/gpt-oss-120b");
    assert.ok(isRecord(calls[0].input));
    assert.equal(calls[0].input.max_output_tokens, 3072);
    assert.match(String(calls[0].input.instructions), /untrusted data/);
    assert.equal(typeof calls[0].input.input, "string");
    const payload: unknown = JSON.parse(String(calls[0].input.input));
    assert.ok(isRecord(payload) && isRecord(payload.sample));
    assert.equal(payload.language, "pt");
    assert.equal(payload.sample.domain, "acme.test");
    assert.ok(Array.isArray(payload.sample.colors));
    assert.deepEqual(payload.sample.colors.map((token) => isRecord(token) && token.value).sort(), ["#0069a8", "#111827", "#ffffff"]);

    const result = body.result;
    assert.ok(isRecord(result));
    assert.equal(result.version, 1);
    assert.equal(result.identity, NAMED_REPLY.identity);
    assert.equal(result.model, "@cf/openai/gpt-oss-120b");
    assert.deepEqual(result.sample, { domain: "acme.test", pages: 4, pins: 10 });
    assert.ok(Array.isArray(result.colors));
    const colors = result.colors.filter(isRecord);
    assert.equal(colors.find((token) => token.value === "#0069a8")?.name, "primary");
    assert.equal(colors.find((token) => token.value === "#111827")?.name, "ink");
    assert.ok(!colors.some((token) => token.value === "#ff00ff"));
    assert.equal(colors.find((token) => token.value === "#ffffff")?.name, "color-3");
    assert.ok(Array.isArray(result.typography));
    assert.equal(result.typography.filter(isRecord).find((token) => token.value === "14px")?.name, "button");
    assert.deepEqual(result.warnings, []);

    const stored = await getJson(`/api/collections/${collectionId}/design-system`, paid.cookie, paid.env);
    assert.equal(stored.status, 200);
    const storedBody = await jsonBody(stored);
    assert.deepEqual(storedBody.designSystem, result);
    assert.ok(isRecord(storedBody.exports));
    assert.match(String(storedBody.exports.css), /^:root \{\n {2}--color-primary: #0069a8;/);
    assert.ok(String(storedBody.exports.tailwind).startsWith("@theme {\n"));
    assert.match(String(storedBody.exports.markdown), /^# acme\.test design system\n/);
    const tokens: unknown = JSON.parse(String(storedBody.exports.tokens));
    assert.ok(isRecord(tokens) && isRecord(tokens.color));
    assert.deepEqual(tokens.color.primary, { $type: "color", $value: "#0069a8" });
  });

  test("replays the stored result for the same requestId without a second inference", async () => {
    // ARRANGE
    let calls = 0;
    const env = aiEnv(async () => {
      calls += 1;
      return modelReply(NAMED_REPLY);
    });
    const paid = await paidProCookie(env);
    const collectionId = await createCollection(paid.cookie, paid.env);
    await uploadReferenceCaptures(paid.cookie, collectionId, paid.env);
    const request = () => postJson("/api/ai/design-system", {
      collectionId,
      language: "en",
      requestId: "design_request_replay_001",
    }, paid.cookie, paid.env);
    const first = await jsonBody(await request());

    // ACT
    const replay = await jsonBody(await request());

    // ASSERT
    assert.equal(replay.idempotent, true);
    assert.deepEqual(replay.result, first.result);
    assert.equal(calls, 1);
    assert.equal(await creditBalance(paid.cookie, paid.env), 185);
  });

  test("hides the design system from accounts that do not own the collection", async () => {
    // ARRANGE
    const env = aiEnv(async () => modelReply(NAMED_REPLY));
    const owner = await paidProCookie(env, "owner@example.test");
    const collectionId = await createCollection(owner.cookie, owner.env);
    await uploadReferenceCaptures(owner.cookie, collectionId, owner.env);
    const other = await paidProCookie(env, "other@example.test");

    // ACT
    const read = await getJson(`/api/collections/${collectionId}/design-system`, other.cookie, other.env);
    const extract = await postJson("/api/ai/design-system", {
      collectionId,
      requestId: "design_request_other_0001",
    }, other.cookie, other.env);

    // ASSERT
    assert.equal(read.status, 404);
    assert.equal(extract.status, 404);
    assert.equal(await creditBalance(other.cookie, other.env), 200);
  });

  test("returns null before any extraction and refunds an unusable model reply", async () => {
    // ARRANGE
    const env = aiEnv(async () => ({ response: "Sorry, I cannot help with that." }));
    const paid = await paidProCookie(env);
    const collectionId = await createCollection(paid.cookie, paid.env);
    await uploadReferenceCaptures(paid.cookie, collectionId, paid.env);
    const before = await jsonBody(await getJson(`/api/collections/${collectionId}/design-system`, paid.cookie, paid.env));

    // ACT
    const response = await postJson("/api/ai/design-system", {
      collectionId,
      requestId: "design_request_invalid_01",
    }, paid.cookie, paid.env);

    // ASSERT
    assert.equal(before.designSystem, null);
    assert.equal(before.exports, null);
    assert.equal(response.status, 503);
    assert.equal((await jsonBody(response)).code, "invalid_ai_response");
    assert.equal(await creditBalance(paid.cookie, paid.env), 200);
    const after = await jsonBody(await getJson(`/api/collections/${collectionId}/design-system`, paid.cookie, paid.env));
    assert.equal(after.designSystem, null);
  });

  test("requires a signed-in account", async () => {
    // ARRANGE
    const env = aiEnv(async () => modelReply(NAMED_REPLY));

    // ACT
    const response = await postJson("/api/ai/design-system", {
      collectionId: "col_missing",
      requestId: "design_request_anon_00001",
    }, "", env);

    // ASSERT
    assert.equal(response.status, 401);
  });
});
