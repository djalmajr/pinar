// F5/S1: the BYOK endpoint store (F5 contract §3). One row per account; the
// ciphertext, the key id and the last four characters of the key — never
// the key itself. With a database the row lives in byok_endpoints (the
// migration 0034); without one (the in-memory deployment) the same behavior
// runs on the memory map. A database without the 0034 throws here; the API
// turns that into 503 byok_unavailable and nothing else of the Cloud breaks.

import type { CloudEnv } from "../cloud-api";

export interface ByokStoredRow {
  baseUrl: string;
  capabilitiesJson: string;
  chatModel: string;
  createdAt: string;
  embeddingModel: string;
  keyCiphertext: string;
  keyId: string;
  keyLast4: string;
  transcriptionModel: string;
  updatedAt: string;
}

const memoryByokEndpoints = new Map<string, ByokStoredRow>();

export function resetByokMemoryStateForTests() {
  memoryByokEndpoints.clear();
}

const SELECT_BYOK_ROW = `
  SELECT base_url, key_ciphertext, key_last4, key_id, chat_model, embedding_model,
         transcription_model, capabilities_json, created_at, updated_at
  FROM byok_endpoints
  WHERE owner_id = ?
`;

function rowFromRecord(row: Record<string, unknown>): ByokStoredRow {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    baseUrl: text(row.base_url),
    capabilitiesJson: text(row.capabilities_json),
    chatModel: text(row.chat_model),
    createdAt: text(row.created_at),
    embeddingModel: text(row.embedding_model),
    keyCiphertext: text(row.key_ciphertext),
    keyId: text(row.key_id),
    keyLast4: text(row.key_last4),
    transcriptionModel: text(row.transcription_model),
    updatedAt: text(row.updated_at),
  };
}

export async function byokRow(env: CloudEnv, ownerId: string): Promise<ByokStoredRow | null> {
  if (env.DB) {
    const row = await env.DB.prepare(SELECT_BYOK_ROW).bind(ownerId).first();
    return row === null ? null : rowFromRecord(row);
  }
  return memoryByokEndpoints.get(ownerId) ?? null;
}

export async function deleteByokRow(env: CloudEnv, ownerId: string): Promise<void> {
  if (env.DB) {
    await env.DB.prepare("DELETE FROM byok_endpoints WHERE owner_id = ?").bind(ownerId).run();
    return;
  }
  memoryByokEndpoints.delete(ownerId);
}

/**
 * Records the result of the test in capabilities_json and updated_at only
 * while the configuration the test ran against is still the stored one (the
 * same base URL, the same key ciphertext and the same models; F5/S2 review
 * fix): a DELETE or a PUT that landed while the test was in flight leaves
 * the row as that write left it, and the caller discards the result. It is
 * never an upsert — the test cannot resurrect a deleted row, nor clobber a
 * newer save. Returns whether the update hit.
 */
export async function recordByokCapabilities(
  env: CloudEnv,
  ownerId: string,
  row: ByokStoredRow,
  capabilitiesJson: string,
  updatedAt: string,
): Promise<boolean> {
  if (env.DB) {
    const result = await env.DB.prepare(`
      UPDATE byok_endpoints
      SET capabilities_json = ?, updated_at = ?
      WHERE owner_id = ? AND base_url = ? AND key_ciphertext = ?
        AND chat_model = ? AND embedding_model = ? AND transcription_model = ?
    `).bind(capabilitiesJson, updatedAt, ownerId, row.baseUrl, row.keyCiphertext, row.chatModel, row.embeddingModel, row.transcriptionModel).run();
    return Number(result.meta?.changes ?? 0) > 0;
  }
  const current = memoryByokEndpoints.get(ownerId);
  if (
    current === undefined ||
    current.baseUrl !== row.baseUrl ||
    current.keyCiphertext !== row.keyCiphertext ||
    current.chatModel !== row.chatModel ||
    current.embeddingModel !== row.embeddingModel ||
    current.transcriptionModel !== row.transcriptionModel
  ) {
    return false;
  }
  current.capabilitiesJson = capabilitiesJson;
  current.updatedAt = updatedAt;
  return true;
}

/**
 * Writes the row a PUT tested only while the stored row is still the one
 * the PUT read before its test (the same base URL, key ciphertext and
 * models), or, for a new endpoint, while there is still no row: a DELETE or
 * another PUT that landed while the test was in flight leaves the row as
 * that write left it, and the caller answers 409. It is never a blind
 * upsert. Returns whether the write hit.
 */
export async function saveByokRowIfUnchanged(
  env: CloudEnv,
  ownerId: string,
  expected: ByokStoredRow | null,
  row: ByokStoredRow,
): Promise<boolean> {
  if (env.DB) {
    if (expected === null) {
      const result = await env.DB.prepare(`
        INSERT INTO byok_endpoints (
          owner_id, base_url, key_ciphertext, key_last4, key_id,
          chat_model, embedding_model, transcription_model, capabilities_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id) DO NOTHING
      `).bind(
        ownerId,
        row.baseUrl,
        row.keyCiphertext,
        row.keyLast4,
        row.keyId,
        row.chatModel,
        row.embeddingModel,
        row.transcriptionModel,
        row.capabilitiesJson,
        row.createdAt,
        row.updatedAt,
      ).run();
      return Number(result.meta?.changes ?? 0) > 0;
    }
    const result = await env.DB.prepare(`
      UPDATE byok_endpoints
      SET base_url = ?, key_ciphertext = ?, key_last4 = ?, key_id = ?,
          chat_model = ?, embedding_model = ?, transcription_model = ?,
          capabilities_json = ?, updated_at = ?
      WHERE owner_id = ? AND base_url = ? AND key_ciphertext = ?
        AND chat_model = ? AND embedding_model = ? AND transcription_model = ?
    `).bind(
      row.baseUrl,
      row.keyCiphertext,
      row.keyLast4,
      row.keyId,
      row.chatModel,
      row.embeddingModel,
      row.transcriptionModel,
      row.capabilitiesJson,
      row.updatedAt,
      ownerId,
      expected.baseUrl,
      expected.keyCiphertext,
      expected.chatModel,
      expected.embeddingModel,
      expected.transcriptionModel,
    ).run();
    return Number(result.meta?.changes ?? 0) > 0;
  }
  const current = memoryByokEndpoints.get(ownerId);
  if (expected === null ? current !== undefined : (
    current === undefined ||
    current.baseUrl !== expected.baseUrl ||
    current.keyCiphertext !== expected.keyCiphertext ||
    current.chatModel !== expected.chatModel ||
    current.embeddingModel !== expected.embeddingModel ||
    current.transcriptionModel !== expected.transcriptionModel
  )) {
    return false;
  }
  memoryByokEndpoints.set(ownerId, { ...row });
  return true;
}
