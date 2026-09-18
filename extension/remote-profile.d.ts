interface ExtensionStorageArea {
  get(keys: string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
  remove(keys: string | string[]): Promise<void>;
  set(values: Record<string, unknown>): Promise<void>;
}

export function remoteProfileKey(endpoint: string, key: string): string;
export function remoteProfileStorage(storage: ExtensionStorageArea, endpoint: string): ExtensionStorageArea;
