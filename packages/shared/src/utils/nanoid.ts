// URL-safe alphabet (0-9, A-Z, _, a-z, -) with exactly 64 characters (indexes 0 to 63)
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-";

export function generateNanoId(size = 12): string {
  const bytes = new Uint8Array(size);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < size; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let id = "";
  for (let i = 0; i < size; i++) {
    id += ALPHABET[bytes[i] & 63];
  }
  return id;
}
