import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CloudEnv } from "../cloud-api";
import { createRestEmail } from "./email-rest";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const API_TOKEN = "cf-test-token-xyz";
const ENDPOINT_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/email/sending/send`;

interface RecordedCall {
  body: string;
  headers: Record<string, string>;
  method: string;
  redirect: RequestRedirect;
  signal: AbortSignal | null;
  url: string;
}

// Fake fetch that records the request instead of hitting the network.
function createFakeFetch(respond: () => Response) {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({
      body: typeof init?.body === "string" ? init.body : "",
      headers,
      method: init?.method ?? "GET",
      redirect: init?.redirect ?? "follow",
      signal: init?.signal ?? null,
      url: String(input),
    });
    return respond();
  };
  return { calls, fetch: fetchImpl };
}

// The exact shape Pinar sends today (see cloud-api.ts invitation/code/storage emails).
function pinarMessage() {
  return {
    from: { email: "noreply@pinar.dev", name: "Pinar" },
    html: "<p>Your Pinar sign-in code is:</p><p><strong>123456</strong></p>",
    subject: "Your Pinar sign-in code",
    text: "Your Pinar sign-in code is 123456. It expires in 10 minutes.",
    to: "dev@example.com",
  };
}

// Assignability proof: the factory return type is SendEmail-compatible without a cast.
function makeEmail(respond: () => Response) {
  const fake = createFakeFetch(respond);
  const email: NonNullable<CloudEnv["EMAIL"]> = createRestEmail({
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    fetch: fake.fetch,
  });
  return { email, fake };
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  throw new Error("expected the call to reject");
}

function jsonEnvelope(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("createRestEmail", () => {
  test("sends the Pinar message through the REST endpoint with the Cinzel body shape", async () => {
    const { email, fake } = makeEmail(() => jsonEnvelope({ errors: [], result: { message_id: "msg-123" }, success: true }));
    const result = await email.send(pinarMessage());
    assert.deepEqual(result, { messageId: "msg-123" });
    assert.equal(fake.calls.length, 1);
    const call = fake.calls[0];
    assert.equal(call.url, ENDPOINT_URL);
    assert.equal(call.method, "POST");
    assert.equal(call.headers.authorization, `Bearer ${API_TOKEN}`);
    assert.equal(call.headers["content-type"], "application/json");
    assert.equal(call.redirect, "error");
    assert.ok(call.signal instanceof AbortSignal);
    assert.equal(call.signal.aborted, false);
    assert.deepEqual(JSON.parse(call.body), {
      from: "noreply@pinar.dev",
      html: "<p>Your Pinar sign-in code is:</p><p><strong>123456</strong></p>",
      subject: "Your Pinar sign-in code",
      text: "Your Pinar sign-in code is 123456. It expires in 10 minutes.",
      to: "dev@example.com",
    });
  });

  test("returns an empty messageId when the response carries none", async () => {
    const { email } = makeEmail(() => jsonEnvelope({ errors: [], success: true }));
    const result = await email.send(pinarMessage());
    assert.deepEqual(result, { messageId: "" });
  });

  test("rejects a 4xx response with the status and numeric Cloudflare codes, never the token", async () => {
    const { email } = makeEmail(() =>
      jsonEnvelope(
        {
          errors: [
            { code: 1001, message: "unauthorized from" },
            { code: "not-a-number" },
            { code: 1200 },
          ],
          success: false,
        },
        400,
      ),
    );
    const error = await captureError(email.send(pinarMessage()));
    assert.equal(error.message, "email send failed: 400 1001, 1200");
    assert.ok(!error.message.includes(API_TOKEN));
    assert.ok(!error.message.includes("unauthorized from"));
  });

  test("rejects a 200 response with success: false", async () => {
    const { email } = makeEmail(() => jsonEnvelope({ errors: [], success: false }));
    const error = await captureError(email.send(pinarMessage()));
    assert.equal(error.message, "email send failed: 200");
  });

  test("rejects a failed response with no JSON body using the status only", async () => {
    const { email } = makeEmail(() => new Response("bad gateway", { status: 502 }));
    const error = await captureError(email.send(pinarMessage()));
    assert.equal(error.message, "email send failed: 502");
  });

  test("rejects an EmailMessage (the raw cloudflare:email object) without calling fetch", async () => {
    const { email, fake } = makeEmail(() => jsonEnvelope({ errors: [], success: true }));
    const emailMessage = {
      from: "noreply@pinar.dev",
      raw: new ReadableStream<Uint8Array>(),
      to: "dev@example.com",
    } as EmailMessage;
    const error = await captureError(email.send(emailMessage));
    assert.equal(error.message, "EmailMessage is not supported by the REST email adapter");
    assert.equal(fake.calls.length, 0);
  });
});
