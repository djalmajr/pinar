import { createClient } from "@libsql/client";
import type { CloudEnv } from "../cloud-api";
import type { FilingThresholdEnv } from "../filing/constants";
import { createLibsqlD1 } from "./libsql-d1";
import { createRestEmail } from "./email-rest";
import { createS3Bucket } from "./s3-bucket";
import { createOpenAiCompatibleAi } from "./openai-compatible-ai";

const CLOUDFLARE_ACCOUNT_ID = /^[0-9a-f]{32}$/;

// The fake host the EdgeR injects as EDGER_EGRESS_HOST: a simple DNS name
// (letters, digits, dots and hyphens) — no scheme, port or path. Anything
// else counts as absent (EDG-38 §2).
const EGRESS_HOST = /^[A-Za-z0-9.-]+$/;

/** The opaque handle of the guard's HTTP client (Deno.HttpClient). */
type EgressHttpClient = object;
/**
 * The minimal shape of Deno.createHttpClient (the project has no Deno
 * types): the unix-socket proxy of the EdgeR's per-worker guard client
 * (EDG-38 §2).
 */
type CreateEgressHttpClient = (options: { proxy: { path: string; transport: "unix" } }) => EgressHttpClient;

// The minimal shape of the Deno global this file relies on (the project
// does not depend on Deno's types). Read at call time, never at module
// top, so the bundle also loads in Bun (the EdgeR smoke imports every
// chunk there).
interface DenoLike {
  createHttpClient?: CreateEgressHttpClient;
}

// The CloudEnv string fields read from a variable of the same name.
const STRING_FIELDS = [
  "ADMIN_API_KEY",
  // The assistant chain (F4): optional, outside the all-or-nothing AI group.
  "AI_GATEWAY_API_KEY",
  "AI_GATEWAY_ZERO_DATA_RETENTION",
  // The voice chains (D5): optional, outside the all-or-nothing AI group.
  "AI_TEXT_CHAIN",
  "AI_TRANSCRIPTION_CHAIN",
  "ASSISTANT_CHAIN",
  "ASSISTANT_ENABLED",
  "AUTH_PEPPER",
  // The BYOK master key (F5/S1): 32 bytes, base64. It is an EdgeR app
  // secret (EDG-38): the manifest lists its name under secrets and the
  // EdgeR vault injects the value into this worker's env at spawn. Absent
  // or invalid keeps the BYOK answering 503 byok_unavailable. The egress
  // guard's signal is the EDGER_EGRESS_SOCKET the EdgeR itself injects
  // (S6), not a variable of the Cloud env.
  "BYOK_MASTER_KEY",
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
 *
 * `createHttpClient` is the factory of the BYOK egress guard's client
 * (EDG-38 §2): in production it is the EdgeR's Deno global (read at call
 * time when the parameter is not given); the tests inject a fake. Without
 * it — or without the socket or a valid host — the BYOK_EGRESS field is
 * absent and byokFetch keeps refusing; nothing here throws over a missing
 * guard, and the socket path never enters an error or a log.
 */
export function edgerCloudEnv(
  read: (name: string) => string | undefined,
  createHttpClient?: CreateEgressHttpClient,
): CloudEnv {
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

  // The BYOK egress guard (F5/S6a, EDG-38 §2): the EdgeR injects the
  // per-worker Unix socket and the fake host into this worker's env, and
  // only where its Deno runtime can create the guard's client. The client
  // is created once, with the unix-socket proxy, and the fetch is bound to
  // it (Deno's `client` init, absent from the standard RequestInit): the
  // destination crosses only the x-edger-egress-url header, never as the
  // fetch's target. The names are read only when the factory is available:
  // in a runtime without it (Bun, the local and the smoke runtimes) the
  // guard cannot exist, so the env is never queried for them. Any missing
  // piece (the factory, the socket, a valid host) keeps the field absent
  // and byokFetch refusing — absence is the refusal, and a client the
  // runtime cannot build is not surfaced (the error may quote the socket
  // path, which never enters a log).
  const createEgressClient =
    createHttpClient ?? (globalThis as { Deno?: DenoLike }).Deno?.createHttpClient;
  if (typeof createEgressClient === "function") {
    const egressSocket = value("EDGER_EGRESS_SOCKET");
    const egressHost = value("EDGER_EGRESS_HOST");
    if (egressSocket !== undefined && egressHost !== undefined && EGRESS_HOST.test(egressHost)) {
      try {
        const client = createEgressClient({ proxy: { path: egressSocket, transport: "unix" } });
        env.BYOK_EGRESS = {
          host: egressHost,
          fetch: (input, init) => fetch(input, { ...init, client } as RequestInit & { client: unknown }),
        };
      } catch {
        // The field stays absent: the refusal stands.
      }
    }
  }

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
