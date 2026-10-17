import { createClient } from "@libsql/client";
import type { CloudEnv } from "../cloud-api";
import type { FilingThresholdEnv } from "../filing/constants";
import { createLibsqlD1 } from "./libsql-d1";
import { createRestEmail } from "./email-rest";
import { createS3Bucket } from "./s3-bucket";
import { createOpenAiCompatibleAi } from "./openai-compatible-ai";

const CLOUDFLARE_ACCOUNT_ID = /^[0-9a-f]{32}$/;

// The CloudEnv string fields read from a variable of the same name.
const STRING_FIELDS = [
  "ADMIN_API_KEY",
  // The assistant chain (F4): optional, outside the all-or-nothing AI group.
  "AI_GATEWAY_API_KEY",
  "AI_GATEWAY_ZERO_DATA_RETENTION",
  "ASSISTANT_CHAIN",
  "ASSISTANT_ENABLED",
  "AUTH_PEPPER",
  "CLOUD_TRIAL_ENABLED",
  "COMPLIMENTARY_PRO_USER_IDS",
  "EXTENSION_ORIGIN",
  // Optional: the ops address of the assistant margin alerts.
  "OPS_ALERT_EMAIL",
  "PRICING_AI_CREDITS_500_BRL_CENTS",
  "PRICING_AI_CREDITS_500_USD_CENTS",
  "PRICING_STORAGE_1GB_12M_BRL_CENTS",
  "PRICING_STORAGE_1GB_12M_USD_CENTS",
  "PRICING_STORAGE_5GB_12M_BRL_CENTS",
  "PRICING_STORAGE_5GB_12M_USD_CENTS",
  "PRICING_YEARLY_BRL_CENTS",
  "PRICING_YEARLY_USD_CENTS",
  "STRIPE_PRICE_AI_CREDITS_500",
  "STRIPE_PRICE_BR_AI_CREDITS_500",
  "STRIPE_PRICE_BR_STORAGE_1GB_12M",
  "STRIPE_PRICE_BR_STORAGE_5GB_12M",
  "STRIPE_PRICE_BR_YEARLY",
  "STRIPE_PRICE_STORAGE_1GB_12M",
  "STRIPE_PRICE_STORAGE_5GB_12M",
  "STRIPE_PRICE_YEARLY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
] as const;

/**
 * Builds the CloudEnv for the self-hosted EdgeR runtime from environment
 * variables (the worker has no bindings). `read` is injected so the tests
 * control the values; nothing here reads `process.env` or `Deno.env`
 * directly. An empty or blank value counts as absent. Error messages carry
 * only variable names, never values.
 */
export function edgerCloudEnv(read: (name: string) => string | undefined): CloudEnv {
  const value = (name: string) => {
    const raw = read(name);
    return raw === undefined || raw.trim() === "" ? undefined : raw;
  };

  const env: CloudEnv & FilingThresholdEnv = {};
  for (const field of STRING_FIELDS) {
    env[field] = value(field);
  }

  const deploymentEnv = value("DEPLOYMENT_ENV");
  if (deploymentEnv !== undefined) {
    if (deploymentEnv !== "local" && deploymentEnv !== "staging" && deploymentEnv !== "production") {
      throw new Error("invalid DEPLOYMENT_ENV");
    }
    env.DEPLOYMENT_ENV = deploymentEnv;
  }

  const databaseUrl = value("DATABASE_URL");
  if (databaseUrl) {
    let client: ReturnType<typeof createClient>;
    try {
      client = createClient({
        url: databaseUrl,
        authToken: value("DATABASE_AUTH_TOKEN"),
        intMode: "number",
      });
    } catch {
      // The client's parse errors quote the whole URL, credentials included.
      throw new Error("invalid DATABASE_URL");
    }
    env.DB = createLibsqlD1(client);
  }

  const s3 = requiredGroup(
    "S3",
    {
      S3_ACCESS_KEY_ID: value("S3_ACCESS_KEY_ID"),
      S3_BUCKET: value("S3_BUCKET"),
      S3_ENDPOINT: value("S3_ENDPOINT"),
      S3_SECRET_ACCESS_KEY: value("S3_SECRET_ACCESS_KEY"),
    },
    ["S3_ACCESS_KEY_ID", "S3_BUCKET", "S3_ENDPOINT", "S3_SECRET_ACCESS_KEY"],
  );
  if (Object.keys(s3).length > 0) {
    env.PINAR_BUCKET = createS3Bucket({
      accessKeyId: s3.S3_ACCESS_KEY_ID,
      bucket: s3.S3_BUCKET,
      endpoint: s3.S3_ENDPOINT,
      region: value("S3_REGION"),
      secretAccessKey: s3.S3_SECRET_ACCESS_KEY,
    });
  }

  const accountId = value("CLOUDFLARE_ACCOUNT_ID");
  if (accountId !== undefined && !CLOUDFLARE_ACCOUNT_ID.test(accountId)) {
    // It enters the URL of an authenticated request, so it must be exactly
    // a 32-char lowercase hex account id.
    throw new Error("invalid CLOUDFLARE_ACCOUNT_ID");
  }
  const email = requiredGroup(
    "email",
    {
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_EMAIL_API_TOKEN: value("CLOUDFLARE_EMAIL_API_TOKEN"),
    },
    ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_EMAIL_API_TOKEN"],
  );
  if (Object.keys(email).length > 0) {
    env.EMAIL = createRestEmail({
      accountId: email.CLOUDFLARE_ACCOUNT_ID,
      apiToken: email.CLOUDFLARE_EMAIL_API_TOKEN,
    });
  }

  // The assistant reads the raw strings (its own endpoint); they stand
  // alone, so an explicit appliance chain needs no AI_MODEL (A46).
  const aiBaseUrl = value("AI_BASE_URL");
  const aiApiKey = value("AI_API_KEY");
  const aiModel = value("AI_MODEL");
  const transcriptionModel = value("AI_TRANSCRIPTION_MODEL");
  if (aiModel !== undefined || transcriptionModel !== undefined) {
    // The metered AI binding (transcription and reproduction) uses AI_MODEL
    // and AI_TRANSCRIPTION_MODEL for real, so it needs its full group.
    const ai = requiredGroup(
      "AI",
      {
        AI_API_KEY: aiApiKey,
        AI_BASE_URL: aiBaseUrl,
        AI_MODEL: aiModel,
        AI_TRANSCRIPTION_MODEL: transcriptionModel,
      },
      ["AI_API_KEY", "AI_BASE_URL", "AI_MODEL", "AI_TRANSCRIPTION_MODEL"],
    );
    // The runner implements only the run() calls cloud-api and voice-pin make.
    env.AI = createOpenAiCompatibleAi({
      apiKey: ai.AI_API_KEY,
      baseUrl: ai.AI_BASE_URL,
      chatModel: ai.AI_MODEL,
      transcriptionModel: ai.AI_TRANSCRIPTION_MODEL,
    }) as unknown as Ai;
  } else if ((aiBaseUrl !== undefined) !== (aiApiKey !== undefined)) {
    // Without the models the URL and the key are a pair: with one of them
    // present (blank counts as absent), the other must be too, so a broken
    // pair fails loudly instead of booting with hasAssistant: false (A46).
    throw new Error(`incomplete AI configuration: missing ${aiBaseUrl === undefined ? "AI_BASE_URL" : "AI_API_KEY"}`);
  }
  if (aiBaseUrl !== undefined) env.AI_BASE_URL = aiBaseUrl;
  if (aiApiKey !== undefined) env.AI_API_KEY = aiApiKey;
  if (aiModel !== undefined) env.AI_MODEL = aiModel;
  // Optional and outside the group: its absence never turns the AI off
  // (the pin search is then textual).
  const embeddingModel = value("AI_EMBEDDING_MODEL");
  if (embeddingModel !== undefined) env.AI_EMBEDDING_MODEL = embeddingModel;

  // The filing similarity thresholds (F3.5 §1): raw text, validated where
  // they are read (filing/constants.ts). Optional and outside every group,
  // like AI_EMBEDDING_MODEL: one alone stands, and absence never fails.
  const filingSimilarityMin = value("FILING_SIMILARITY_MIN");
  if (filingSimilarityMin !== undefined) env.FILING_SIMILARITY_MIN = filingSimilarityMin;
  const filingSimilarityMargin = value("FILING_SIMILARITY_MARGIN");
  if (filingSimilarityMargin !== undefined) env.FILING_SIMILARITY_MARGIN = filingSimilarityMargin;

  return env;
}

/**
 * Returns the values when every required name is present, nothing when the
 * whole group is absent, and throws `incomplete <group> configuration:
 * missing <names>` (alphabetical, names only) when only part of the group is
 * present.
 */
function requiredGroup(
  group: "S3" | "email" | "AI",
  values: Record<string, string | undefined>,
  names: readonly string[],
): Record<string, string> {
  const present: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const value = values[name];
    if (value !== undefined) present[name] = value;
    else missing.push(name);
  }
  if (missing.length === names.length) return {};
  if (missing.length > 0) {
    throw new Error(`incomplete ${group} configuration: missing ${missing.join(", ")}`);
  }
  return present;
}
