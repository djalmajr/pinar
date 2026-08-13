export function shotsUrl(port) {
  return `http://127.0.0.1:${port}`;
}

export async function isHealthy(port) {
  try {
    const response = await fetch(`${shotsUrl(port)}/health`);
    const body = await response.json();
    return response.ok && body.ok === true;
  } catch {
    return false;
  }
}

export function isAddrInUse(error) {
  if (error && error.code === "EADDRINUSE") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /in use|EADDRINUSE|Failed to start server/i.test(message);
}

export async function waitHealthy(port, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isHealthy(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return isHealthy(port);
}
