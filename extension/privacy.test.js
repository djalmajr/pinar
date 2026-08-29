import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./privacy.js", import.meta.url), "utf8");
const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const contentSrc = readFileSync(new URL("./content.js", import.meta.url), "utf8");
const context = vm.createContext({ URL, URLSearchParams });
vm.runInContext(source, context);
const { classifyFieldAttrs, sanitizeCapture, sanitizeUrl } = context.__pinarPrivacy;

const SECRET = "PINAR_FIXTURE_SECRET_s3cretValue";

describe("extension privacy", () => {
  test("injects privacy.js before content.js", () => {
    assert.match(backgroundSrc, /privacy\.js/);
    assert.match(contentSrc, /__pinarPrivacy/);
    assert.match(contentSrc, /data-privacy-mask/);
  });

  test("redacts fixture secrets from a capture payload", () => {
    const result = sanitizeCapture({
      fields: [{ attrs: { type: "password" }, value: SECRET }],
      page: { title: "Login", url: `https://app.example.test/?access_token=${SECRET}` },
      pins: [{ comment: SECRET, text: "Save" }],
    });
    const payload = JSON.stringify(result);
    assert.equal(payload.includes(SECRET), false);
    assert.equal(classifyFieldAttrs({ type: "password" }), "password");
    assert.equal(sanitizeUrl("https://x.test/?token=abc12345").url.includes("abc12345"), false);
  });
});
