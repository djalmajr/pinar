// F5/S1: the /api/byok routes (F5 contract §2 and §3). A Pro account stores
// its OpenAI-compatible endpoint and key; the key is encrypted at rest
// (crypto.ts) and never comes back — at most its last four characters. The
// URL is validated by the first barrier (url.ts) before anything is stored;
// the egress (fetch.ts) refuses until the EdgeR guard exists (A55, S6).
//
// Errors never echo a value: the key never appears in a response, a log or
// an error, and the catch of the whole route is silent, because a database
// driver can echo a bound parameter into its message. A database without
// the 0034, a row the master key cannot decrypt, or a storage failure all
// answer 503 byok_unavailable — and only the BYOK is unavailable: the rest
// of the Cloud goes on.
//
// Detection of the capabilities is S2 (POST /api/byok/test): every save
// records them as untested, and untested capabilities route nowhere.

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
import { byokRow, deleteByokRow, saveByokRow, type ByokStoredRow } from "./store";
import { BYOK_BASE_URL_MAX, validateByokUrl } from "./url";

const MAX_API_KEY_LENGTH = 4096;
const MAX_MODEL_LENGTH = 200;

// A capability of S2's detection: ok/error and the test date (F5 contract
// §3); embeddings additionally the tested dims. S1 writes only the
// untested state; ok stays null until S2 tests the endpoint.
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

function byokNow(): string {
  return new Date(byokNowOverride ?? Date.now()).toISOString();
}

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
function capabilitiesOf(stored: string): ByokCapabilities {
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
          { "Cache-Control": "no-store" },
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
        { "Cache-Control": "no-store" },
      ),
    };
  }
  return { ok: true, principal };
}

function unavailable() {
  return json(
    { code: "byok_unavailable", error: "BYOK is not available on this deployment" },
    503,
    { "Cache-Control": "no-store" },
  );
}

function badRequest(code: string, error: string) {
  return json({ code, error }, 400);
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
  return json(row === null ? unconfiguredView() : byokView(row), 200, { "Cache-Control": "no-store" });
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
  if (!("normalized" in checked)) return badRequest("invalid_base_url", "The base URL is not allowed");

  // An empty or missing apiKey keeps the stored key; a new endpoint needs
  // one. The key is never echoed back by any answer.
  const apiKey = typeof body.apiKey === "string" && body.apiKey !== "" ? body.apiKey : null;
  if (typeof body.apiKey !== "string" && body.apiKey !== undefined) {
    return badRequest("invalid_api_key", "The API key must be a string");
  }
  if (apiKey !== null && apiKey.length > MAX_API_KEY_LENGTH) {
    return badRequest("invalid_api_key", "The API key is too long");
  }
  const chatModel = modelValue(body.chatModel);
  const embeddingModel = modelValue(body.embeddingModel);
  const transcriptionModel = modelValue(body.transcriptionModel);
  if (chatModel === "invalid" || embeddingModel === "invalid" || transcriptionModel === "invalid") {
    return badRequest("invalid_model", "The model name is missing or too long");
  }

  const crypto = await byokCrypto(env.BYOK_MASTER_KEY);
  if (crypto === null) return unavailable();
  const current = await byokRow(env, actor.principal.id);
  let keyCiphertext: string;
  let keyId: string;
  let keyLast4: string;
  if (apiKey !== null) {
    // A fresh random IV and the current key_id (rotation-ready) per write.
    keyCiphertext = await crypto.encrypt(apiKey);
    keyId = crypto.keyId;
    keyLast4 = apiKey.slice(-4);
  } else if (current !== null) {
    keyCiphertext = current.keyCiphertext;
    keyId = current.keyId;
    keyLast4 = current.keyLast4;
  } else {
    return badRequest("api_key_required", "The API key is required to save a new endpoint");
  }

  const now = byokNow();
  const row: ByokStoredRow = {
    baseUrl: checked.normalized,
    // S2's detection is what tests the endpoint: every save starts from
    // the untested capabilities (F5 contract §1).
    capabilitiesJson: JSON.stringify(untestedCapabilities()),
    chatModel: chatModel ?? current?.chatModel ?? "",
    createdAt: current?.createdAt ?? now,
    embeddingModel: embeddingModel ?? current?.embeddingModel ?? "",
    keyCiphertext,
    keyId,
    keyLast4,
    transcriptionModel: transcriptionModel ?? current?.transcriptionModel ?? "",
    updatedAt: now,
  };
  await saveByokRow(env, actor.principal.id, row);
  return json(byokView(row), 200, { "Cache-Control": "no-store" });
}

async function deleteByok(request: Request, env: CloudEnv): Promise<Response> {
  const actor = await byokActor(request, env);
  if (!actor.ok) return actor.response;
  if (await byokCrypto(env.BYOK_MASTER_KEY) === null) return unavailable();
  await deleteByokRow(env, actor.principal.id);
  return json(unconfiguredView(), 200, { "Cache-Control": "no-store" });
}

export async function handleByokRequest(request: Request, env: CloudEnv): Promise<Response> {
  const method = request.method;
  if (method !== "GET" && method !== "PUT" && method !== "DELETE") {
    return json(
      { code: "method_not_allowed", error: "Method not allowed" },
      405,
      { Allow: "DELETE, GET, PUT" },
    );
  }
  try {
    return await (method === "GET" ? readByok(request, env) : method === "PUT" ? updateByok(request, env) : deleteByok(request, env));
  } catch {
    // A table missing (no 0034), a ciphertext the master key cannot
    // decrypt, or a storage error: the BYOK is unavailable, the error is
    // not logged (a driver may echo the bound key), and the rest of the
    // Cloud answers as usual.
    return unavailable();
  }
}
