// F5/S6a: the BYOK egress through the guard's field (EDG-38 §2 and §4),
// integrated with the S3 consumers. The egress is byokEgressFor(env) with
// the BYOK_EGRESS field faked — no setByokEgressForTests: the field is the
// production signal of the guard. The connection test (detectByokCapabilities,
// what POST /api/byok/test runs) and the assistant turn (byokTurnFetch) are
// the S3 paths; cause.ts's mapping of the guard's x-edger-egress-error codes
// is confirmed here, untouched. The fake field is the only network: every
// answer is canned, and the destination crosses only the x-edger-egress-url
// header (proven in fetch.test.ts).

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CloudEnv } from "../cloud-api";
import { ByokAssistantTurnError } from "./cause";
import { detectByokCapabilities } from "./detect";
import { byokEgressFor } from "./fetch";
import { byokTurnFetch } from "./route";

// The fake guard field: every call gets the same canned answer.
function guardField(answer: () => Response): CloudEnv["BYOK_EGRESS"] {
  return {
    fetch: () => Promise.resolve(answer()),
    host: "edger-egress.invalid",
  };
}

const ENDPOINT = {
  baseUrl: "https://api.example.test/v1",
  chatModel: "chat-model",
  embeddingModel: "embed-model",
  key: "sk-byok-test-secret",
  transcriptionModel: "stt-model",
};

// The guard's refusal (EDG-38 §4): the status and the x-edger-egress-error
// header, with a JSON body the app never reads for the cause.
function guardResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code, message: "the guard refused the call" }), {
    headers: { "x-edger-egress-error": code },
    status,
  });
}

describe("the BYOK egress through the guard's field (F5/S6a, EDG-38 §4)", () => {
  test("a 403 EGRESS_HOST_BLOCKED of the guard is endpoint_blocked in the connection test", async () => {
    const env: CloudEnv = { BYOK_EGRESS: guardField(() => guardResponse(403, "EGRESS_HOST_BLOCKED")) };
    const capabilities = await detectByokCapabilities({
      endpoint: ENDPOINT,
      egress: byokEgressFor(env),
      now: "2026-10-18T00:00:00.000Z",
    });
    // The 403 of the catalog stops the detection: every configured
    // capability takes the guard's cause.
    assert.equal(capabilities.chat.error, "endpoint_blocked");
    assert.equal(capabilities.tools.error, "endpoint_blocked");
    assert.equal(capabilities.vision.error, "endpoint_blocked");
    assert.equal(capabilities.embeddings.error, "endpoint_blocked");
    assert.equal(capabilities.transcription.error, "endpoint_blocked");
  });

  test("a 504 EGRESS_TIMEOUT of the guard is timeout in the connection test", async () => {
    const env: CloudEnv = { BYOK_EGRESS: guardField(() => guardResponse(504, "EGRESS_TIMEOUT")) };
    const capabilities = await detectByokCapabilities({
      endpoint: ENDPOINT,
      egress: byokEgressFor(env),
      now: "2026-10-18T00:00:00.000Z",
    });
    // The catalog's 504 falls through and every minimal call times out:
    // each configured capability records the guard's cause.
    assert.equal(capabilities.chat.error, "timeout");
    assert.equal(capabilities.tools.error, "timeout");
    assert.equal(capabilities.vision.error, "timeout");
    assert.equal(capabilities.embeddings.error, "timeout");
    assert.equal(capabilities.transcription.error, "timeout");
  });

  test("a stream cut with an exception on read() is the S3 cut cause, never a truncated response", async () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    const env: CloudEnv = {
      BYOK_EGRESS: {
        fetch: () => {
          // The headers left the guard; it cuts the body mid-stream: the
          // reader's read() throws, the way EDG-38 §4 describes.
          let cut = false;
          const body = new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!cut) {
                cut = true;
                controller.enqueue(bytes('{"choices":[{"message":{"content":"par'));
              } else {
                controller.error(new Error("the guard cut the stream"));
              }
            },
          });
          return Promise.resolve(new Response(body, { headers: { "content-type": "application/json" }, status: 200 }));
        },
        host: "edger-egress.invalid",
      },
    };
    const turnFetch = byokTurnFetch(byokEgressFor(env));
    const response = await turnFetch("https://api.example.test/v1/chat/completions", { method: "POST" });
    assert.equal(response.status, 200);
    // The partial chunk may pass, but the cut must surface as the caused
    // ByokAssistantTurnError — a done (a truncated response settling as
    // the final answer) fails the test.
    await assert.rejects(
      (async () => {
        const reader = response.body!.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) throw new Error("the truncated response settled as the final answer");
            assert.ok(value.byteLength > 0);
          }
        } finally {
          reader.releaseLock();
        }
      })(),
      (error: unknown) =>
        error instanceof ByokAssistantTurnError && error.cause === "endpoint_unreachable",
    );
  });
});
