// F5/S1: the BYOK key encryption (F5 contract §1).
//
// AES-GCM 256 through crypto.subtle (it runs on the local Bun server, EdgeR
// and wrangler alike), with a fresh random 12-byte IV per write. The
// ciphertext is `v1:<key_id>:<iv b64>:<ct b64>`; the key_id is the first 8
// hex chars of SHA-256 of the master key, so a rotated key can be told from
// the old one without decrypting. The master key comes from BYOK_MASTER_KEY
// (32 bytes, base64); absent or invalid, byokCrypto returns null and the
// BYOK answers 503 byok_unavailable while the rest of the Cloud goes on.
// The plaintext key is never logged or echoed: the UI sees at most the last
// four characters, which the API stores separately and never here.

const VERSION = "v1";
const MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;

/** The ciphertext does not decrypt with this master key (tampered, or of a rotated key). */
export class ByokDecryptError extends Error {
  constructor(readonly reason: "bad_format" | "bad_key_id" | "bad_base64" | "bad_key") {
    super(`byok decrypt failed: ${reason}`);
    this.name = "ByokDecryptError";
  }
}

export interface ByokCrypto {
  /** The 8-hex master-key fingerprint inside every ciphertext. */
  readonly keyId: string;
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  let binary: string;
  try {
    binary = atob(value.trim());
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The master key as 32 raw bytes, or null when absent or not valid base64 of exactly 32 bytes. */
export function parseByokMasterKey(masterKey: string | undefined): Uint8Array<ArrayBuffer> | null {
  if (typeof masterKey !== "string") return null;
  const bytes = base64ToBytes(masterKey);
  return bytes !== null && bytes.length === MASTER_KEY_BYTES ? bytes : null;
}

/** The crypto of the deployment, or null when the master key is absent or invalid. */
export async function byokCrypto(masterKey: string | undefined): Promise<ByokCrypto | null> {
  const keyBytes = parseByokMasterKey(masterKey);
  if (keyBytes === null) return null;
  const digest = await crypto.subtle.digest("SHA-256", keyBytes);
  const keyId = Array.from(new Uint8Array(digest).slice(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  return {
    keyId,
    async encrypt(plaintext: string): Promise<string> {
      // A new random IV per write: the same key encrypted twice never
      // produces the same ciphertext, and the IV travels with it.
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const cipher = new Uint8Array(await crypto.subtle.encrypt(
        { iv, name: "AES-GCM" },
        key,
        new TextEncoder().encode(plaintext),
      ));
      return `${VERSION}:${keyId}:${bytesToBase64(iv)}:${bytesToBase64(cipher)}`;
    },
    async decrypt(ciphertext: string): Promise<string> {
      const parts = ciphertext.split(":");
      if (parts.length !== 4 || parts[0] !== VERSION) throw new ByokDecryptError("bad_format");
      // A key_id that is not this master key's: a rotated or a foreign
      // ciphertext. Refuse without trying the key.
      if (parts[1] !== keyId) throw new ByokDecryptError("bad_key_id");
      const iv = base64ToBytes(parts[2]);
      const cipher = base64ToBytes(parts[3]);
      if (iv === null || cipher === null || iv.length !== IV_BYTES) throw new ByokDecryptError("bad_base64");
      try {
        const plain = await crypto.subtle.decrypt({ iv, name: "AES-GCM" }, key, cipher);
        return new TextDecoder().decode(plain);
      } catch {
        // GCM authenticated the tag: any tampered iv/ciphertext lands here.
        throw new ByokDecryptError("bad_key");
      }
    },
  };
}
