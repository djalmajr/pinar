import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CloudEnv } from "../cloud-api";
import { createS3Bucket } from "./s3-bucket";

interface RecordedCall {
  body: Uint8Array;
  headers: Record<string, string>;
  method: string;
  signal: AbortSignal;
  url: string;
}

// Fake fetch that records every signed request instead of hitting the network.
function createFakeFetch(respond: (request: Request) => Response) {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const request = input instanceof Request ? input : new Request(String(input));
    const raw = request.body ? await new Response(request.body).arrayBuffer() : new ArrayBuffer(0);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({ body: new Uint8Array(raw), headers, method: request.method, signal: request.signal, url: request.url });
    return respond(request);
  };
  return { calls, fetch: fetchImpl };
}

const CONFIG = {
  accessKeyId: "AKIA-TEST-KEY",
  bucket: "pinar-prd",
  endpoint: "https://acc.r2.cloudflarestorage.com/",
  secretAccessKey: "test-secret-access-key",
};

// Assignability proof: the factory return type is R2Bucket-compatible without a cast.
function makeBucket(respond: (request: Request) => Response) {
  const fake = createFakeFetch(respond);
  const bucket: NonNullable<CloudEnv["PINAR_BUCKET"]> = createS3Bucket({ ...CONFIG, fetch: fake.fetch });
  return { bucket, fake };
}

// Key with a space and a slash: each segment is percent-encoded and joined by "/".
const KEY = "2026 10/shot one.png";
const EXPECTED_URL = "https://acc.r2.cloudflarestorage.com/pinar-prd/2026%2010/shot%20one.png";

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  throw new Error("expected the call to reject");
}

function assertSignedRequest(call: RecordedCall, method: string) {
  assert.equal(call.method, method);
  assert.equal(call.url, EXPECTED_URL);
  assert.ok(call.headers.authorization.startsWith("AWS4-HMAC-SHA256"));
  assert.ok(call.headers["x-amz-date"].length > 0);
  assert.ok(call.headers["x-amz-content-sha256"].length > 0);
  assert.ok(call.signal instanceof AbortSignal);
  assert.equal(call.signal.aborted, false);
}

// ---- SigV4 verification, independent of aws4fetch (crypto.subtle only) ----

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { hash: "SHA-256", name: "HMAC" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data)));
}

// RFC 3986 canonical URI: decode each pathname segment and re-encode once
// (encodeURIComponent plus !'()* — what S3 expects). No double encoding.
function canonicalUri(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) =>
      encodeURIComponent(decodeURIComponent(segment)).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

// AWS canonical header value: trim and collapse internal whitespace runs.
function canonicalHeaderValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

interface ParsedAuthorization {
  scope: string;
  signature: string;
  signedHeaders: string[];
}

function parseAuthorization(header: string): ParsedAuthorization {
  const match = header.match(
    /^AWS4-HMAC-SHA256 Credential=[^/]+\/([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/,
  );
  if (!match) throw new Error(`unparseable SigV4 authorization header: ${header}`);
  return { scope: match[1], signature: match[3], signedHeaders: match[2].split(";") };
}

// Recomputes the SigV4 signature from the request the fake fetch received:
// canonical request (method, canonical URI, empty query, the headers listed in
// the header's own SignedHeaders in lowercase and sorted order, payload hash
// from x-amz-content-sha256); string-to-sign (AWS4-HMAC-SHA256, x-amz-date,
// <date>/<region>/s3/aws4_request scope); derived key (AWS4<secret> -> date
// -> region -> s3 -> aws4_request). It compares the result with the Signature=
// carried by the authorization header. Written against crypto.subtle on
// purpose so aws4fetch cannot satisfy it by convention.
async function verifySigV4Signature(
  request: Request,
  secretAccessKey: string,
): Promise<{ computed: string; stated: string; valid: boolean }> {
  const authorization = request.headers.get("authorization");
  if (!authorization) throw new Error("missing authorization header");
  const { scope, signedHeaders, signature } = parseAuthorization(authorization);
  const url = new URL(request.url);
  const canonicalHeaders = signedHeaders
    .map((name) => `${name}:${canonicalHeaderValue(name === "host" ? url.host : (request.headers.get(name) ?? ""))}`)
    .join("\n");
  const payloadHash = request.headers.get("x-amz-content-sha256");
  if (!payloadHash) throw new Error("missing x-amz-content-sha256 header");
  const canonicalRequest = [
    request.method,
    canonicalUri(url.pathname),
    "",
    canonicalHeaders,
    "",
    signedHeaders.join(";"),
    payloadHash,
  ].join("\n");
  const [date, region, service] = scope.split("/");
  if (!date || !region || service !== "s3") throw new Error(`unexpected credential scope: ${scope}`);
  const amzDate = request.headers.get("x-amz-date");
  if (!amzDate) throw new Error("missing x-amz-date header");
  const canonicalHash = toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalRequest))),
  );
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, canonicalHash].join("\n");
  const dateKey = await hmacSha256(new TextEncoder().encode(`AWS4${secretAccessKey}`), date);
  const regionKey = await hmacSha256(dateKey, region);
  const serviceKey = await hmacSha256(regionKey, service);
  const signingKey = await hmacSha256(serviceKey, "aws4_request");
  const computed = toHex(await hmacSha256(signingKey, stringToSign));
  return { computed, stated: signature, valid: computed === signature };
}

function rebuildRequest(call: RecordedCall): Request {
  return new Request(call.url, { headers: new Headers(call.headers), method: call.method });
}

async function assertValidSigV4(call: RecordedCall) {
  const result = await verifySigV4Signature(rebuildRequest(call), CONFIG.secretAccessKey);
  assert.ok(
    result.valid,
    `SigV4 signature mismatch for ${call.method} ${call.url}: stated=${result.stated} computed=${result.computed}`,
  );
}

describe("createS3Bucket", () => {
  test("put signs a path-style URL with the encoded key and sends the bytes with the content-type", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { bucket, fake } = makeBucket(() => new Response(null, { status: 200 }));
    await bucket.put(KEY, bytes, { httpMetadata: { contentType: "image/png" } });
    assert.equal(fake.calls.length, 1);
    assertSignedRequest(fake.calls[0], "PUT");
    assert.equal(fake.calls[0].headers["content-type"], "image/png");
    assert.deepEqual([...fake.calls[0].body], [...bytes]);
  });

  test("get resolves to null on 404", async () => {
    const { bucket, fake } = makeBucket(() => new Response("no such key", { status: 404 }));
    const object = await bucket.get(KEY);
    assert.equal(object, null);
    assertSignedRequest(fake.calls[0], "GET");
  });

  test("get streams the 200 body, exposes the etag, and copies only the allowed headers", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([9, 8, 7]));
        controller.close();
      },
    });
    const { bucket, fake } = makeBucket(() => new Response(stream, {
      headers: {
        "cache-control": "public, max-age=86400",
        "content-disposition": "inline; filename=\"shot.png\"",
        "content-encoding": "gzip",
        "content-language": "en",
        "content-type": "image/png",
        etag: "\"abc-123\"",
        expires: "Tue, 01 Oct 2026 00:00:00 GMT",
        "server": "cloudflare",
        "x-amz-request-id": "REQ-1",
      },
      status: 200,
    }));
    const object = await bucket.get(KEY);
    assertSignedRequest(fake.calls[0], "GET");
    assert.ok(object);
    assert.ok(object.body instanceof ReadableStream);
    assert.deepEqual([...new Uint8Array(await new Response(object.body).arrayBuffer())], [9, 8, 7]);
    assert.equal(object.httpEtag, "\"abc-123\"");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    assert.equal(headers.get("content-type"), "image/png");
    assert.equal(headers.get("content-language"), "en");
    assert.equal(headers.get("content-disposition"), "inline; filename=\"shot.png\"");
    assert.equal(headers.get("content-encoding"), "gzip");
    assert.equal(headers.get("cache-control"), "public, max-age=86400");
    assert.equal(headers.get("expires"), "Tue, 01 Oct 2026 00:00:00 GMT");
    assert.equal(headers.has("server"), false);
    assert.equal(headers.has("x-amz-request-id"), false);
  });

  test("get returns an empty httpEtag and copies only the headers that are present", async () => {
    const { bucket } = makeBucket(() => new Response("data", { headers: { "content-type": "image/png" }, status: 200 }));
    const object = await bucket.get(KEY);
    assert.ok(object);
    assert.equal(object.httpEtag, "");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    assert.equal(headers.get("content-type"), "image/png");
    assert.equal(headers.has("cache-control"), false);
    assert.equal(headers.has("content-encoding"), false);
    assert.equal(headers.has("expires"), false);
  });

  test("delete treats 200, 204 and 404 as success", async () => {
    for (const status of [200, 204, 404]) {
      const { bucket, fake } = makeBucket(() => new Response(null, { status }));
      await bucket.delete(KEY);
      assert.equal(fake.calls.length, 1);
      assertSignedRequest(fake.calls[0], "DELETE");
    }
  });

  test("a 500 on each operation rejects with the exact message and no secret material", async () => {
    // The failure body deliberately leaks credentials: they must not surface.
    const leaky = () => new Response(`oops ${CONFIG.accessKeyId} ${CONFIG.secretAccessKey}`, { status: 500 });
    const put = makeBucket(leaky);
    const putError = await captureError(
      put.bucket.put(KEY, new Uint8Array([1]), { httpMetadata: { contentType: "image/png" } }),
    );
    assert.equal(putError.message, "s3 put failed: 500");
    assert.ok(!putError.message.includes(CONFIG.accessKeyId));
    assert.ok(!putError.message.includes(CONFIG.secretAccessKey));

    const get = makeBucket(leaky);
    const getError = await captureError(get.bucket.get(KEY));
    assert.equal(getError.message, "s3 get failed: 500");

    const del = makeBucket(leaky);
    const deleteError = await captureError(del.bucket.delete(KEY));
    assert.equal(deleteError.message, "s3 delete failed: 500");
  });

  test("a 403 on get rejects with the status, not a null object", async () => {
    const { bucket } = makeBucket(() => new Response("forbidden", { status: 403 }));
    const error = await captureError(bucket.get(KEY));
    assert.equal(error.message, "s3 get failed: 403");
  });

  test("verifies the SigV4 signature on put, get and delete for plain, spaced and hostile keys", async () => {
    for (const key of ["abc.png", "2026 10/shot one.png", "a+b%c/ação.png"]) {
      const { bucket, fake } = makeBucket(() => new Response("ok", { status: 200 }));
      await bucket.put(key, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/png" } });
      await bucket.get(key);
      await bucket.delete(key);
      assert.equal(fake.calls.length, 3);
      for (const call of fake.calls) {
        await assertValidSigV4(call);
      }
    }
  });

  test("rejects a request whose signature was replaced by 64 zeros", async () => {
    const { bucket, fake } = makeBucket(() => new Response("ok", { status: 200 }));
    await bucket.put("abc.png", new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/png" } });
    const call = fake.calls[0];
    const prefix = call.headers.authorization.match(/^(AWS4-HMAC-SHA256 Credential=[^,]+, SignedHeaders=[^,]+, )/);
    assert.ok(prefix, "the authorization header must carry Credential= and SignedHeaders=");
    // Same request as received, only the signature replaced by 64 zeros.
    const tampered = new Request(call.url, {
      headers: new Headers({ ...call.headers, authorization: `${prefix[1]}Signature=${"0".repeat(64)}` }),
      method: call.method,
    });
    const result = await verifySigV4Signature(tampered, CONFIG.secretAccessKey);
    assert.equal(result.valid, false, "a 64-zero signature must be rejected");
    assert.notEqual(result.computed, "0".repeat(64));
  });
});
