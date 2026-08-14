// Keep in sync with src/paths.mjs (DEFAULT_PORT / PORT_COUNT).
export const DEFAULT_PORT = 17373;
export const PORT_COUNT = 10;

export function pinarPorts() {
  return Array.from({ length: PORT_COUNT }, (_, i) => DEFAULT_PORT + i);
}
