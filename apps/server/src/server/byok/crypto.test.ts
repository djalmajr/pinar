import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ByokDecryptError, byokCrypto, parseByokMasterKey } from "./crypto";

// 32 bytes of a fixed value, base64 — a test master key, not a real one.
const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");

describe("byokCrypto", () => {
  test("round trips a key and keeps the format v1:<key_id>:<iv b64>:<ct b64>", async () => {
    const crypto = await byokCrypto(MASTER_KEY);
    assert.ok(crypto);
    assert.match(crypto.keyId, /^[0-9a-f]{8}$/);
    const ciphertext = await crypto.encrypt("sk-byok-test-key");
    const [version, keyId, iv, cipher] = ciphertext.split(":");
    assert.equal(version, "v1");
    assert.equal(keyId, crypto.keyId);
    assert.equal(Buffer.from(iv, "base64").length, 12, "a 12-byte IV travels with the ciphertext");
    assert.ok(Buffer.from(cipher, "base64").length > 0);
    assert.equal(await crypto.decrypt(ciphertext), "sk-byok-test-key");
  });

  test("uses a different random IV on every write of the same key", async () => {
    const crypto = await byokCrypto(MASTER_KEY);
    assert.ok(crypto);
    const first = await crypto.encrypt("sk-byok-test-key");
    const second = await crypto.encrypt("sk-byok-test-key");
    assert.notEqual(first, second, "same plaintext, same key: the IV must differ");
    const firstParts = first.split(":");
    const secondParts = second.split(":");
    assert.equal(firstParts[0], secondParts[0], "the version stays the same");
    assert.equal(firstParts[1], secondParts[1], "the key_id stays the same");
    assert.notEqual(firstParts[2], secondParts[2], "the IV differs");
    assert.equal(await crypto.decrypt(second), "sk-byok-test-key");
  });

  test("refuses a tampered ciphertext", async () => {
    const crypto = await byokCrypto(MASTER_KEY);
    assert.ok(crypto);
    const ciphertext = await crypto.encrypt("sk-byok-test-key");
    const parts = ciphertext.split(":");
    // Flip one byte of the ciphertext body: GCM must refuse it.
    const cipherBytes = Buffer.from(parts[3], "base64");
    cipherBytes[cipherBytes.length - 1] ^= 1;
    await assert.rejects(
      crypto.decrypt(`${parts[0]}:${parts[1]}:${parts[2]}:${cipherBytes.toString("base64")}`),
      (error: unknown) => error instanceof ByokDecryptError && error.reason === "bad_key",
    );
    // A tampered IV is refused too.
    const ivBytes = Buffer.from(parts[2], "base64");
    ivBytes[0] ^= 1;
    await assert.rejects(
      crypto.decrypt(`${parts[0]}:${parts[1]}:${ivBytes.toString("base64")}:${parts[3]}`),
      (error: unknown) => error instanceof ByokDecryptError && error.reason === "bad_key",
    );
    // A mangled body is a format/base64 error, not a decrypt attempt.
    await assert.rejects(crypto.decrypt(`${parts[0]}:${parts[1]}:${parts[2]}:!!!`),
      (error: unknown) => error instanceof ByokDecryptError && error.reason === "bad_base64");
    await assert.rejects(crypto.decrypt("v0:" + parts.slice(1).join(":")),
      (error: unknown) => error instanceof ByokDecryptError && error.reason === "bad_format");
    await assert.rejects(crypto.decrypt(parts[0] + ":" + parts.slice(2).join(":")),
      (error: unknown) => error instanceof ByokDecryptError && error.reason === "bad_format");
  });

  test("refuses a ciphertext of a different key_id without decrypting", async () => {
    const crypto = await byokCrypto(MASTER_KEY);
    const other = await byokCrypto(OTHER_MASTER_KEY);
    assert.ok(crypto && other);
    assert.notEqual(crypto.keyId, other.keyId, "different master keys fingerprint differently");
    const foreign = await other.encrypt("sk-byok-other-key");
    await assert.rejects(
      crypto.decrypt(foreign),
      (error: unknown) => error instanceof ByokDecryptError && error.reason === "bad_key_id",
    );
    // And the ciphertext rewritten with this key's id still does not open:
    // the tag was made with the other key.
    const parts = foreign.split(":");
    await assert.rejects(
      crypto.decrypt(`${parts[0]}:${crypto.keyId}:${parts[2]}:${parts[3]}`),
      (error: unknown) => error instanceof ByokDecryptError && error.reason === "bad_key",
    );
  });

  test("the key_id is the first 8 hex of the SHA-256 of the master key", async () => {
    const byok = await byokCrypto(MASTER_KEY);
    assert.ok(byok);
    const digest = await crypto.subtle.digest("SHA-256", Buffer.from(MASTER_KEY, "base64"));
    const expected = Array.from(new Uint8Array(digest).slice(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join("");
    assert.equal(byok.keyId, expected);
  });

  test("absent or invalid master keys leave the BYOK unavailable", async () => {
    assert.equal(await byokCrypto(undefined), null, "absent");
    assert.equal(await byokCrypto(""), null, "empty");
    assert.equal(await byokCrypto("   "), null, "blank");
    assert.equal(await byokCrypto(Buffer.alloc(16, 7).toString("base64")), null, "16 bytes: not 256 bits");
    assert.equal(await byokCrypto(Buffer.alloc(33, 7).toString("base64")), null, "33 bytes");
    assert.equal(await byokCrypto("not-base64!!!"), null, "invalid base64");
    assert.equal(parseByokMasterKey(undefined), null);
  });
});
