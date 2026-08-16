type TanstackServerModule = typeof import("@tanstack/react-start/server");
type TanstackFetch = ReturnType<TanstackServerModule["createStartHandler"]>;

let cachedFetch: TanstackFetch | null = null;

async function getTanstackFetch(): Promise<TanstackFetch> {
  if (cachedFetch) return cachedFetch;
  const module = await import("@tanstack/react-start/server");
  cachedFetch = module.createStartHandler(module.defaultStreamHandler);
  return cachedFetch;
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    cachedFetch = null;
  });
}

const fetch = async (...args: Parameters<TanstackFetch>) => {
  const handler = await getTanstackFetch();
  return handler(...args);
};

export default { fetch };
