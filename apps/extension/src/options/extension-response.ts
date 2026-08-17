export interface ExtensionResponseBase {
  error?: string;
  ok?: boolean;
}

export function withExtensionResponseFallback(
  response: ExtensionResponseBase | null | undefined,
  error: string,
): ExtensionResponseBase {
  return response ?? { error, ok: false };
}
