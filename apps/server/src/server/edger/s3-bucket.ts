import { AwsClient } from "aws4fetch";
import type { CloudEnv } from "../cloud-api";

// S3-compatible bucket adapter for the self-hosted EdgeR runtime. The bucket
// stays on R2 but is reached through the S3 API with SigV4 signing; pointing
// `endpoint` at Garage or MinIO is the only change needed to move.

const REQUEST_TIMEOUT_MS = 30_000;

// The only response headers writeHttpMetadata may copy, mirroring the R2
// binding's behavior for the shot delivery endpoint.
const HTTP_METADATA_HEADERS = [
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-language",
  "content-type",
  "expires",
] as const;

export interface S3BucketConfig {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  fetch?: typeof fetch;
  region?: string;
  secretAccessKey: string;
}

// Annotating the return with the binding's type is the cast-free proof that
// this adapter can replace the R2 binding in CloudEnv.PINAR_BUCKET.
export type S3Bucket = NonNullable<CloudEnv["PINAR_BUCKET"]>;

// fetch's BodyInit accepts only views backed by a plain ArrayBuffer, while the
// R2 contract types the value as a view over ArrayBufferLike. Views created
// from arrayBuffer() already are; anything exotic is copied instead of
// failing to sign.
function fetchBody(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return value.buffer instanceof ArrayBuffer ? (value as Uint8Array<ArrayBuffer>) : new Uint8Array(value);
}

export function createS3Bucket(config: S3BucketConfig): S3Bucket {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    region: config.region ?? "auto",
    secretAccessKey: config.secretAccessKey,
    service: "s3",
  });
  const base = config.endpoint.replace(/\/+$/, "");

  const objectUrl = (key: string) =>
    `${base}/${config.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

  const request = async (method: string, key: string, init: RequestInit = {}) => {
    // `client.sign` (not `client.fetch`) keeps the injected `fetch` in control
    // of transport; the signed Request carries the timeout signal.
    const signed = await client.sign(objectUrl(key), {
      ...init,
      method,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return fetchImpl(signed);
  };

  return {
    async delete(key) {
      const response = await request("DELETE", key);
      if (response.status !== 200 && response.status !== 204 && response.status !== 404) {
        // Only the status: never the key, the signature or the response body.
        throw new Error(`s3 delete failed: ${response.status}`);
      }
    },
    async get(key) {
      const response = await request("GET", key);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`s3 get failed: ${response.status}`);
      if (!response.body) throw new Error(`s3 get failed: ${response.status}`);
      return {
        body: response.body,
        httpEtag: response.headers.get("etag") ?? "",
        writeHttpMetadata(headers: Headers): void {
          for (const name of HTTP_METADATA_HEADERS) {
            const value = response.headers.get(name);
            if (value !== null) headers.set(name, value);
          }
        },
      };
    },
    async put(key, value, options) {
      const response = await request("PUT", key, {
        body: fetchBody(value),
        headers: { "content-type": options.httpMetadata.contentType },
      });
      if (!response.ok) throw new Error(`s3 put failed: ${response.status}`);
    },
  };
}
