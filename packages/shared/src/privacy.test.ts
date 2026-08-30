import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatClipboard } from "../../../extension/format.js";
import {
  classifyFieldAttrs,
  parseExtraKeys,
  REDACTION_PLACEHOLDER,
  sanitizeCapture,
  sanitizeUrl,
} from "./privacy/index.js";
import { encodeVisualCaptureJson, formatVisualContextMarkdown, parseVisualCapture } from "./visual-context/index.js";

const PASSWORD = "PINAR_FIXTURE_SECRET_s3cretValue";
const TOKEN = "tok_live_fixture_9f3aXXXX";
const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmaXh0dXJlIn0.signaturefixtureXXX";
const QUERY = "https://app.example.test/callback?access_token=AT_FIXTURE_secret99&q=ok#refresh_token=RT_FIXTURE_secret88";

function leakHaystack(values: unknown[]) {
  return JSON.stringify(values);
}

describe("privacy sanitizer", () => {
  test("classifies password, token, payment, and otp fields", () => {
    assert.equal(classifyFieldAttrs({ type: "password" }), "password");
    assert.equal(classifyFieldAttrs({ autocomplete: "current-password" }), "password");
    assert.equal(classifyFieldAttrs({ name: "api_key", type: "text" }), "token");
    assert.equal(classifyFieldAttrs({ id: "stripe-token" }), "token");
    assert.equal(classifyFieldAttrs({ autocomplete: "cc-number" }), "payment");
    assert.equal(classifyFieldAttrs({ autocomplete: "one-time-code" }), "otp");
    assert.equal(classifyFieldAttrs({ type: "email" }), null);
    assert.equal(classifyFieldAttrs({ autocomplete: "email" }), null);
    assert.equal(classifyFieldAttrs({ name: "search", type: "text" }), null);
  });

  test("parses extra query keys without empty entries", () => {
    assert.deepEqual(parseExtraKeys(" reset,Invite ; TRACE"), ["reset", "invite", "trace"]);
  });

  test("strips configured query and hash secrets from the URL", () => {
    const result = sanitizeUrl(QUERY, ["invite"]);
    assert.equal(result.url.includes("AT_FIXTURE_secret99"), false);
    assert.equal(result.url.includes("RT_FIXTURE_secret88"), false);
    assert.match(result.url, /access_token=%5Bredacted%5D|access_token=\[redacted\]/);
    assert.ok(result.redacted.includes("secret-query"));
    assert.ok(result.redacted.includes("secret-hash"));
    assert.equal(result.secrets.includes("AT_FIXTURE_secret99"), true);
  });

  test("fixture secrets never appear in JSON, Markdown, HTML, or encoded captures", () => {
    const sanitized = sanitizeCapture({
      fields: [
        { attrs: { name: "password", type: "password" }, value: PASSWORD },
        { attrs: { id: "api_key", type: "text" }, value: TOKEN },
      ],
      page: {
        title: `Session ${PASSWORD}`,
        url: `https://app.example.test/login?token=${TOKEN}&keep=1`,
      },
      pins: [{
        comment: `Reset with ${PASSWORD} and ${JWT}`,
        fingerprint: { id: "api_key", text: TOKEN },
        innerText: TOKEN,
        path: `form > input[value=${PASSWORD}]`,
        selector: "#api_key",
        text: TOKEN,
      }],
      unevaluated: true,
    });

    const clipboard = formatClipboard({
      captureId: "cap_privacy",
      page: sanitized.page,
      pins: sanitized.pins as object[],
      privacy: sanitized.privacy,
      schemaVersion: 1,
      sentAt: "2026-08-29T00:00:00.000Z",
      shot: "/tmp/pinar-shot.png",
    });
    const capture = parseVisualCapture({
      captureId: "cap_privacy",
      page: sanitized.page,
      pins: sanitized.pins,
      privacy: sanitized.privacy,
      warnings: sanitized.warnings,
    });
    const markdown = formatVisualContextMarkdown(capture);
    const encoded = encodeVisualCaptureJson(capture);
    const haystack = leakHaystack([
      sanitized,
      clipboard.plain,
      clipboard.html,
      markdown,
      encoded,
      capture,
    ]);

    assert.equal(haystack.includes(PASSWORD), false);
    assert.equal(haystack.includes(TOKEN), false);
    assert.equal(haystack.includes(JWT), false);
    assert.equal(haystack.includes("AT_FIXTURE"), false);
    assert.match(clipboard.plain, /Redacted:/);
    assert.match(clipboard.html, /Redacted:/);
    assert.match(markdown, /Redacted: /);
    assert.equal(sanitized.privacy.unevaluated, true);
    assert.ok(sanitized.privacy.redacted.includes("password"));
    assert.ok(sanitized.privacy.redacted.includes("token"));
    assert.ok(sanitized.privacy.redacted.includes("unevaluated"));
    assert.ok(sanitized.warnings.includes("privacy_redacted"));
    assert.ok(sanitized.warnings.includes("privacy_unevaluated"));
    assert.equal(JSON.stringify(sanitized).includes("PINAR_FIXTURE"), false);
    assert.equal((sanitized.pins[0] as { comment: string }).comment.includes(REDACTION_PLACEHOLDER), true);
  });

  test("does not treat ordinary page copy as a secret", () => {
    const sanitized = sanitizeCapture({
      page: { title: "Pricing", url: "https://app.example.test/pricing?plan=pro" },
      pins: [{ comment: "Make the CTA bolder", text: "Get started" }],
    });
    assert.deepEqual(sanitized.privacy.redacted, []);
    assert.equal(sanitized.privacy.unevaluated, false);
    assert.equal((sanitized.pins[0] as { comment: string }).comment, "Make the CTA bolder");
    assert.match(sanitized.page.url, /plan=pro/);
  });

  test("does not treat email field values as secrets", () => {
    const email = "user@example.test";
    const sanitized = sanitizeCapture({
      fields: [{ attrs: { type: "email" }, value: email }],
      page: { title: "Signup", url: "https://app.example.test/signup" },
      pins: [{ comment: `Fix ${email}`, text: "Email" }],
    });
    assert.equal(sanitized.privacy.redacted.includes("email"), false);
    assert.equal((sanitized.pins[0] as { comment: string }).comment.includes(email), true);
  });
});
