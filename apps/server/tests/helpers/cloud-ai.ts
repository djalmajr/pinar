import assert from "node:assert/strict";
import { CURRENT_LEGAL_VERSION } from "../../src/lib/legal-documents";
import {
  type CloudEnv,
  handleCloudApiRequest,
  seedCloudAccountForTests,
} from "../../src/server/cloud-api";

export const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export const REMOTE_FREE_LEGAL_ACCEPTANCE = {
  acceptableUseVersion: CURRENT_LEGAL_VERSION,
  accepted: true,
  locale: "en",
  privacyVersion: CURRENT_LEGAL_VERSION,
  termsVersion: CURRENT_LEGAL_VERSION,
};

export const TEST_ENV: CloudEnv = {
  AUTH_PEPPER: "test-auth-pepper",
  EXTENSION_ORIGIN: "chrome-extension://pinar-test",
  PRICING_AI_CREDITS_1000_BRL_CENTS: "990",
  PRICING_AI_CREDITS_1000_USD_CENTS: "299",
  PRICING_FOUNDER_BRL_CENTS: "12990",
  PRICING_FOUNDER_USD_CENTS: "3900",
  PRICING_MONTHLY_BRL_CENTS: "490",
  PRICING_MONTHLY_USD_CENTS: "299",
  PRICING_STORAGE_20GB_12M_BRL_CENTS: "2990",
  PRICING_STORAGE_20GB_12M_USD_CENTS: "799",
  PRICING_STORAGE_5GB_12M_BRL_CENTS: "990",
  PRICING_STORAGE_5GB_12M_USD_CENTS: "299",
  PRICING_YEARLY_BRL_CENTS: "3990",
  PRICING_YEARLY_USD_CENTS: "1900",
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function jsonBody(response: Response) {
  const body: unknown = await response.json();
  assert.ok(isRecord(body));
  return body;
}

export function api(path: string, init: RequestInit = {}, env: CloudEnv = TEST_ENV) {
  return handleCloudApiRequest(new Request(`https://pinar.test${path}`, init), env);
}

/** Workers AI stub: `run` receives the model id and the request input. */
export function aiEnv(run: (model: string, input: unknown) => Promise<unknown>, base: CloudEnv = TEST_ENV): CloudEnv {
  return {
    ...base,
    AI: { run } as unknown as Ai,
  };
}

function emailBinding() {
  const codes: string[] = [];
  const binding = {
    async send(message: unknown) {
      if (!isRecord(message) || typeof message.text !== "string") throw new Error("email text missing");
      const code = message.text.match(/\b\d{6}\b/)?.[0];
      if (code) codes.push(code);
      return { messageId: `test-${codes.length}` };
    },
  } as unknown as NonNullable<CloudEnv["EMAIL"]>;
  return { binding, codes };
}

/**
 * Signs in a seeded paid account and returns its session cookie plus the env
 * (with the email binding) every later request must reuse.
 */
export async function paidProCookie(env: CloudEnv, email = "ai-pro@example.test", plan: "founder" | "pro" = "pro") {
  const mail = emailBinding();
  const signed = { ...env, EMAIL: mail.binding };
  seedCloudAccountForTests({ billingStatus: "active", email, plan });
  await api("/api/auth/email-codes", {
    body: JSON.stringify({ email }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }, signed);
  const response = await api("/api/auth/email-codes/verify", {
    body: JSON.stringify({
      code: mail.codes[0],
      email,
      legalAcceptance: REMOTE_FREE_LEGAL_ACCEPTANCE,
      returnTo: "/app",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }, signed);
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0] || "";
  assert.match(cookie, /^pinar_session=/);
  return { cookie, env: signed };
}

export interface UploadCaptureInput {
  collectionId?: string;
  id: string;
  page?: { title: string; url: string };
  pins: unknown[];
  reproduction?: unknown;
}

/** Uploads a capture (with a tiny PNG) as the signed-in account. */
export function uploadCapture(cookie: string, input: UploadCaptureInput, env: CloudEnv) {
  return api("/api/shots", {
    body: JSON.stringify({
      collectionId: input.collectionId,
      id: input.id,
      image: VALID_PNG,
      page: input.page ?? { title: `Capture ${input.id}`, url: `https://example.test/${input.id}` },
      pins: input.pins,
      reproduction: input.reproduction,
    }),
    headers: { cookie, "content-type": "application/json" },
    method: "POST",
  }, env);
}

export function postJson(path: string, body: unknown, cookie: string, env: CloudEnv) {
  return api(path, {
    body: JSON.stringify(body),
    headers: { cookie, "content-type": "application/json" },
    method: "POST",
  }, env);
}

export function getJson(path: string, cookie: string, env: CloudEnv) {
  return api(path, { headers: { cookie } }, env);
}
