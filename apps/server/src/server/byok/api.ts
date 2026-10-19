// F5/S1: the /api/byok routes (F5 contract §2 and §3). A Pro account stores
// its OpenAI-compatible endpoint and key; the key is encrypted at rest
// (crypto.ts) and never comes back — at most its last four characters. The
// URL is validated by the first barrier (url.ts) before anything is stored;
// the egress (fetch.ts) refuses until the EdgeR guard exists (A55, S6).
//
// S2 adds POST /api/byok/test: it decrypts the key only on the server,
// runs the capability detection (detect.ts) through the egress interface
// (a fake in the tests, byokFetch in production), records the result in
// capabilities_json and answers the view. It is limited per user (limit.ts
// plus one test in flight) and, like the other routes, it is Pro-only,
// no-store and origin-checked by the entry point.
//
// The PUT tests before it saves: after the validation it runs the same
// detection on the values it received (the new key, or the stored one
// decrypted when none came), under the same limit as the POST, and stores
// the row only when at least one capability passed, with that result as
// its capabilities_json. When none passed it answers 422 byok_test_failed
// with the tested capabilities and stores nothing.
//
// Errors never echo a value: the key never appears in a response, a log or
// an error, and the catch of the whole route is silent, because a database
// driver can echo a bound parameter into its message. A database without
// the 0034, a row the master key cannot decrypt, or a storage failure all
// answer 503 byok_unavailable — and only the BYOK is unavailable: the rest
// of the Cloud goes on.

import { markCloudPinIndexOwnerStale } from "../assistant/retrieval/store-cloud";
import { planIncludesAi } from "../../lib/entitlements";
import {
  authenticateAgentKeyContext,
  json,
  readJson,
  resolvePrincipal,
  type CloudEnv,
  type Principal,
} from "../cloud-api";
import { byokCrypto } from "./crypto";
import { detectByokCapabilities } from "./detect";
import { byokEgressFor } from "./fetch";
export { setByokEgressForTests } from "./fetch";
import { BYOK_TEST_MAX_PER_HOUR, byokTestConsume } from "./limit";
import { byokRow, deleteByokRow, recordByokCapabilities, saveByokRowIfUnchanged, type ByokStoredRow } from "./store";
import { BYOK_BASE_URL_MAX, isPinarOwnHost, validateByokUrl } from "./url";

const MAX_API_KEY_LENGTH = 4096;
const MAX_MODEL_LENGTH = 200;

// A capability of S2's detection: ok/error and the test date (F5 contract
// §3); embeddings additionally the tested dims. ok is null while a
// capability has no result (the unconfigured view, a row the parser cannot
// read).
export interface ByokCapability {
  error: string | null;
  ok: boolean | null;
  testedAt: string | null;
}

export interface ByokEmbeddingCapability extends ByokCapability {
  dims: number | null;
}

export interface ByokCapabilities {
  chat: ByokCapability;
  embeddings: ByokEmbeddingCapability;
  tools: ByokCapability;
  transcription: ByokCapability;
  vision: ByokCapability;
}

export function untestedCapabilities(): ByokCapabilities {
  return {
    chat: { error: null, ok: null, testedAt: null },
    embeddings: { dims: null, error: null, ok: null, testedAt: null },
    tools: { error: null, ok: null, testedAt: null },
    transcription: { error: null, ok: null, testedAt: null },
    vision: { error: null, ok: null, testedAt: null },
  };
}

// The shape of GET /api/byok and of the PUT/DELETE answers: the configured
// endpoint without the key.
export interface ByokView {
  baseUrl: string | null;
  capabilities: ByokCapabilities;
  configured: boolean;
  keyLast4: string | null;
  models: {
    chat: string | null;
    embedding: string | null;
    transcription: string | null;
  };
  updatedAt: string | null;
}

let byokNowOverride: number | null = null;

export function setByokNowForTests(value: string | number | null) {
  byokNowOverride = value === null ? null : new Date(value).getTime();
}

function byokNowMs(): number {
  return byokNowOverride ?? Date.now();
}

function byokNow(): string {
  return new Date(byokNowMs()).toISOString();
}

// The egress of the test route and of S3's routing (byok/route.ts):
// byokFetch (the refusal until S6) in production, the injected fake in the
// tests (the ByokEgress interface, the same injection for both).

// The one test in flight per account (F5 contract §2), shared by the PUT
// and the test route; it drains in their finally, so it never leaks across
// tests.
const byokTestsInFlight = new Set<string>();

function unconfiguredView(): ByokView {
  return {
    baseUrl: null,
    capabilities: untestedCapabilities(),
    configured: false,
    keyLast4: null,
    models: { chat: null, embedding: null, transcription: null },
    updatedAt: null,
  };
}

function byokView(row: ByokStoredRow): ByokView {
  return {
    baseUrl: row.baseUrl,
    capabilities: capabilitiesOf(row.capabilitiesJson),
    configured: true,
    keyLast4: row.keyLast4,
    models: {
      chat: row.chatModel === "" ? null : row.chatModel,
      embedding: row.embeddingModel === "" ? null : row.embeddingModel,
      transcription: row.transcriptionModel === "" ? null : row.transcriptionModel,
    },
    updatedAt: row.updatedAt,
  };
}

// A capabilities_json that cannot be parsed or shaped is read as untested,
// never as ok: an unknown result must not route anything to the user's
// endpoint (S3 reads these).
export function capabilitiesOf(stored: string): ByokCapabilities {
  const untested = untestedCapabilities();
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return untested;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return untested;
  const record = value as Record<string, unknown>;
  const capability = (key: string): ByokCapability => {
    const item = record[key];
    if (typeof item !== "object" || item === null || Array.isArray(item)) return { error: null, ok: null, testedAt: null };
    const entry = item as Record<string, unknown>;
    return {
      error: typeof entry.error === "string" ? entry.error : null,
      ok: typeof entry.ok === "boolean" ? entry.ok : null,
      testedAt: typeof entry.testedAt === "string" ? entry.testedAt : null,
    };
  };
  const embeddingsItem = record.embeddings;
  const embeddingsBase = typeof embeddingsItem === "object" && embeddingsItem !== null && !Array.isArray(embeddingsItem)
    ? capability("embeddings")
    : { error: null, ok: null, testedAt: null };
  const embeddingsEntry = (typeof embeddingsItem === "object" && embeddingsItem !== null ? embeddingsItem : {}) as Record<string, unknown>;
  return {
    chat: capability("chat"),
    embeddings: { ...embeddingsBase, dims: typeof embeddingsEntry.dims === "number" ? embeddingsEntry.dims : null },
    tools: capability("tools"),
    transcription: capability("transcription"),
    vision: capability("vision"),
  };
}

type ByokActor =
  | { ok: false; response: Response }
  | { ok: true; principal: Principal };

// Every answer of the route — the successes, the refusals and the early
// errors — carries credentials or user state, so nothing may cache it. The
// header is set once here, at the handler return, so no early path (the
// 401, a 400 of validation, the 405) can forget it (security review P3).
function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

// Web session or agent key with a write permission (F5/S1): the agent key
// authenticates as the Pro account it belongs to (the context already
// requires the account's Pro plan); only the manage and full permissions of
// an account-level key may set the endpoint. The web session needs the Pro
// plan, like the assistant (D2: without Pro there is no assistant, BYOK or
// not).
async function byokActor(request: Request, env: CloudEnv): Promise<ByokActor> {
  const agent = await authenticateAgentKeyContext(request, env);
  if (agent !== null) {
    const writes = agent.key.resourceType === "account"
      && (agent.key.permission === "manage" || agent.key.permission === "full");
    if (!writes) {
      return {
        ok: false,
        response: json(
          { code: "byok_forbidden", error: "This agent key cannot manage the BYOK endpoint" },
          403,
        ),
      };
    }
    return { ok: true, principal: agent.principal };
  }
  const principal = await resolvePrincipal(request, env);
  if (principal === null || principal.kind !== "account") {
    return { ok: false, response: json({ code: "byok_unauthorized", error: "Unauthorized" }, 401) };
  }
  if (!planIncludesAi(principal.plan)) {
    // The same answer the assistant gives (requires_pro → 403).
    return {
      ok: false,
      response: json(
        { code: "byok_requires_pro", error: "BYOK requires a Pro plan" },
        403,
      ),
    };
  }
  return { ok: true, principal };
}

function unavailable() {
  return json(
    { code: "byok_unavailable", error: "BYOK is not available on this deployment" },
    503,
  );
}

function badRequest(code: string, error: string) {
  return json({ code, error }, 400);
}

function notAllowedBaseUrl() {
  return badRequest("invalid_base_url", "The base URL is not allowed");
}

function modelValue(value: unknown): string | undefined | "invalid" {
  if (value === undefined) return undefined; // omitted: keep the stored one
  if (typeof value !== "string" || value.length > MAX_MODEL_LENGTH) return "invalid";
  return value;
}

async function readByok(request: Request, env: CloudEnv): Promise<Response> {
  const actor = await byokActor(request, env);
  if (!actor.ok) return actor.response;
  if (await byokCrypto(env.BYOK_MASTER_KEY) === null) return unavailable();
  const row = await byokRow(env, actor.principal.id);
  return json(row === null ? unconfiguredView() : byokView(row));
}

async function updateByok(request: Request, env: CloudEnv): Promise<Response> {
  const actor = await byokActor(request, env);
  if (!actor.ok) return actor.response;
  const body = await readJson(request);

  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl : "";
  if (baseUrl.length === 0 || baseUrl.length > BYOK_BASE_URL_MAX) {
    return badRequest("invalid_base_url", "The base URL is missing or too long");
  }
  const checked = validateByokUrl(baseUrl);
  if (!("normalized" in checked)) return notAllowedBaseUrl();
  // The Pinar is never the destination of a BYOK key: its own host is
  // refused like any other forbidden URL, before the limit, the decryption
  // and any egress.
  if (isPinarOwnHost(checked.normalized, request.url)) return notAllowedBaseUrl();

  // An empty or missing apiKey keeps the stored key; a new endpoint needs
  // one. A pasted key loses the whitespace at its ends first (one that is
  // empty after that counts as omitted); whitespace left in the middle is
  // refused. The key is never echoed back by any answer.
  const trimmedKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const apiKey = trimmedKey !== "" ? trimmedKey : null;
  if (typeof body.apiKey !== "string" && body.apiKey !== undefined) {
    return badRequest("invalid_api_key", "The API key must be a string");
  }
  if (apiKey !== null && apiKey.length > MAX_API_KEY_LENGTH) {
    return badRequest("invalid_api_key", "The API key is too long");
  }
  if (apiKey !== null && /\s/.test(apiKey)) {
    return badRequest("invalid_api_key", "The API key must not contain whitespace");
  }
  const chatModel = modelValue(body.chatModel);
  const embeddingModel = modelValue(body.embeddingModel);
  const transcriptionModel = modelValue(body.transcriptionModel);
  if (chatModel === "invalid" || embeddingModel === "invalid" || transcriptionModel === "invalid") {
    return badRequest("invalid_model", "The model name is missing or too long");
  }

  const crypto = await byokCrypto(env.BYOK_MASTER_KEY);
  if (crypto === null) return unavailable();
  const ownerId = actor.principal.id;
  const current = await byokRow(env, ownerId);
  if (apiKey === null && current === null) {
    return badRequest("api_key_required", "The API key is required to save a new endpoint");
  }

  const chatModelFinal = chatModel ?? current?.chatModel ?? "";
  const embeddingModelFinal = embeddingModel ?? current?.embeddingModel ?? "";
  const transcriptionModelFinal = transcriptionModel ?? current?.transcriptionModel ?? "";
  // The same limit as POST /api/byok/test, only after the validation: one
  // test in flight per account (the check and the mark are one synchronous
  // step) and BYOK_TEST_MAX_PER_HOUR per hour.
  if (byokTestsInFlight.has(ownerId)) return testLimited();
  byokTestsInFlight.add(ownerId);
  try {
    if (!(await byokTestConsume(env, ownerId, byokNowMs()))) return testLimited();
    let testKey: string;
    if (apiKey !== null) {
      testKey = apiKey;
    } else {
      try {
        testKey = await crypto.decrypt(current!.keyCiphertext);
      } catch {
        // A ciphertext the master key cannot read: the BYOK is unavailable,
        // and the error is not logged (a driver or a tag may echo the key).
        return unavailable();
      }
    }
    // The test runs on the values this PUT received, not on the stored row.
    const capabilities = await detectByokCapabilities({
      endpoint: {
        baseUrl: checked.normalized,
        chatModel: chatModelFinal,
        embeddingModel: embeddingModelFinal,
        key: testKey,
        transcriptionModel: transcriptionModelFinal,
      },
      egress: byokEgressFor(env),
      now: byokNow(),
    });
    // Nothing passed: nothing is stored, the previous configuration (if
    // any) stays as it was and the pin index is not marked.
    if (!Object.values(capabilities).some((capability) => capability.ok === true)) {
      return json(
        {
          capabilities,
          code: "byok_test_failed",
          error: "No capability passed the connection test; nothing was saved",
        },
        422,
      );
    }

    let keyCiphertext: string;
    let keyId: string;
    let keyLast4: string;
    if (apiKey !== null) {
      // A fresh random IV and the current key_id (rotation-ready) per write.
      keyCiphertext = await crypto.encrypt(apiKey);
      keyId = crypto.keyId;
      keyLast4 = apiKey.slice(-4);
    } else {
      keyCiphertext = current!.keyCiphertext;
      keyId = current!.keyId;
      keyLast4 = current!.keyLast4;
    }
    const now = byokNow();
    const row: ByokStoredRow = {
      baseUrl: checked.normalized,
      // The result of the test above: the capabilities that failed keep
      // riding the Pinar credits (the routing reads ok === true only).
      capabilitiesJson: JSON.stringify(capabilities),
      chatModel: chatModelFinal,
      createdAt: current?.createdAt ?? now,
      embeddingModel: embeddingModelFinal,
      keyCiphertext,
      keyId,
      keyLast4,
      transcriptionModel: transcriptionModelFinal,
      updatedAt: now,
    };
    // The row lands only if the stored one is still the one read before the
    // test (or still absent, for a new endpoint): a DELETE or another PUT
    // that ran in the middle of the test wins, never a blind upsert.
    if (!(await saveByokRowIfUnchanged(env, ownerId, current, row))) {
      return byokChanged(await byokRow(env, ownerId));
    }
    // F5 contract §1: the vectors of different embedding models do not mix,
    // so a save that changes the embedding model (or moves it to another
    // endpoint) marks the owner's pin index stale, and the next indexing
    // pass re-embeds it with the new model. Best effort: the save already
    // landed.
    const endpointChanged = current !== null && checked.normalized !== current.baseUrl;
    if (embeddingModelFinal !== (current?.embeddingModel ?? "") || (endpointChanged && embeddingModelFinal !== "")) {
      await markCloudPinIndexOwnerStale(env, ownerId);
    }
    return json(byokView(row));
  } finally {
    byokTestsInFlight.delete(ownerId);
  }
}

async function deleteByok(request: Request, env: CloudEnv): Promise<Response> {
  const actor = await byokActor(request, env);
  if (!actor.ok) return actor.response;
  if (await byokCrypto(env.BYOK_MASTER_KEY) === null) return unavailable();
  await deleteByokRow(env, actor.principal.id);
  return json(unconfiguredView());
}

// POST /api/byok/test (F5/S2): the same access as the other routes (Pro,
// the web session or an agent key with a manage/full permission, no-store
// and the entry point's origin check), then the key is decrypted only on
// the server, the capabilities are detected through the egress interface
// and the result is recorded in capabilities_json. The view never carries
// the key. Without a saved endpoint it is 404 byok_not_configured; without
// the master key it is 503 byok_unavailable, like the rest. The limit is
// one test in flight and BYOK_TEST_MAX_PER_HOUR per hour: 429
// byok_test_limited. The result is recorded only while the tested
// configuration is still the stored one (a DELETE or a PUT that landed in
// the middle of the test is not undone nor clobbered): otherwise the
// result is discarded and the answer is 409 byok_changed with the current
// view. In production the egress is byokFetch, which refuses: the
// configured capabilities then record egress_unavailable and nothing
// leaves.
function testLimited() {
  return json(
    { code: "byok_test_limited", error: `Too many connection tests; try again later (limit: ${BYOK_TEST_MAX_PER_HOUR} per hour)` },
    429,
  );
}

function byokChanged(current: ByokStoredRow | null) {
  return json(
    {
      code: "byok_changed",
      error: "The BYOK endpoint changed while the test was running",
      view: current === null ? unconfiguredView() : byokView(current),
    },
    409,
  );
}

async function testByok(request: Request, env: CloudEnv): Promise<Response> {
  const actor = await byokActor(request, env);
  if (!actor.ok) return actor.response;
  const crypto = await byokCrypto(env.BYOK_MASTER_KEY);
  if (crypto === null) return unavailable();
  const ownerId = actor.principal.id;
  const row = await byokRow(env, ownerId);
  if (row === null) {
    return json({ code: "byok_not_configured", error: "The BYOK endpoint is not configured" }, 404);
  }
  // A row saved before the PUT refused the Pinar's own host is refused the
  // same way: no limit consumed, no decryption, no egress, and the row
  // stays as it is.
  if (isPinarOwnHost(row.baseUrl, request.url)) return notAllowedBaseUrl();
  // One test in flight per account: the check and the mark are one
  // synchronous step, so a concurrent request always sees the first one's.
  if (byokTestsInFlight.has(ownerId)) return testLimited();
  byokTestsInFlight.add(ownerId);
  try {
    if (!(await byokTestConsume(env, ownerId, byokNowMs()))) return testLimited();
    let apiKey: string;
    try {
      apiKey = await crypto.decrypt(row.keyCiphertext);
    } catch {
      // A ciphertext the master key cannot read: the BYOK is unavailable,
      // and the error is not logged (a driver or a tag may echo the key).
      return unavailable();
    }
    const capabilities = await detectByokCapabilities({
      endpoint: {
        baseUrl: row.baseUrl,
        chatModel: row.chatModel,
        embeddingModel: row.embeddingModel,
        key: apiKey,
        transcriptionModel: row.transcriptionModel,
      },
      egress: byokEgressFor(env),
      now: byokNow(),
    });
    // The result lands only if the tested configuration is still the stored
    // one (the conditional update of the store, never an upsert): a DELETE
    // or a PUT that ran in the middle of the test wins, and the result is
    // discarded with a 409 that carries the current view.
    const now = byokNow();
    const capabilitiesJson = JSON.stringify(capabilities);
    const recorded = await recordByokCapabilities(env, ownerId, row, capabilitiesJson, now);
    if (!recorded) {
      return byokChanged(await byokRow(env, ownerId));
    }
    return json(byokView({ ...row, capabilitiesJson, updatedAt: now }));
  } finally {
    byokTestsInFlight.delete(ownerId);
  }
}

function byokPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "";
  }
}

export async function handleByokRequest(request: Request, env: CloudEnv): Promise<Response> {
  const method = request.method;
  if (byokPath(request) === "/api/byok/test") {
    if (method !== "POST") {
      return noStore(
        json(
          { code: "method_not_allowed", error: "Method not allowed" },
          405,
          { Allow: "POST" },
        ),
      );
    }
    try {
      return noStore(await testByok(request, env));
    } catch {
      return noStore(unavailable());
    }
  }
  if (method !== "GET" && method !== "PUT" && method !== "DELETE") {
    return noStore(
      json(
        { code: "method_not_allowed", error: "Method not allowed" },
        405,
        { Allow: "DELETE, GET, PUT" },
      ),
    );
  }
  try {
    return noStore(await (method === "GET" ? readByok(request, env) : method === "PUT" ? updateByok(request, env) : deleteByok(request, env)));
  } catch {
    // A table missing (no 0034), a ciphertext the master key cannot
    // decrypt, or a storage error: the BYOK is unavailable, the error is
    // not logged (a driver may echo the bound key), and the rest of the
    // Cloud answers as usual.
    return noStore(unavailable());
  }
}
