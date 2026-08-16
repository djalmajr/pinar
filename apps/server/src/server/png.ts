const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function matches(bytes: Uint8Array, offset: number, expected: readonly number[]) {
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

export function decodePngDataUrl(dataUrl: string) {
  const base64 = dataUrl.startsWith("data:")
    ? dataUrl.slice(dataUrl.indexOf(",") + 1)
    : dataUrl;
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  const hasSignature = matches(bytes, 0, PNG_SIGNATURE);
  const hasHeader = matches(bytes, 12, [73, 72, 68, 82]);
  const hasEnd = matches(bytes, bytes.length - 8, [73, 69, 78, 68]);
  if (bytes.length < 45 || !hasSignature || !hasHeader || !hasEnd) {
    throw new TypeError("Image must be a valid PNG");
  }

  return bytes;
}
