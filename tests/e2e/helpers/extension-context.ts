import { createServer, request as forward, type IncomingHttpHeaders } from "node:http";
import { connect, type AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { chromium, test, type BrowserContext } from "@playwright/test";
import { pinarPorts } from "../../../extension/ports.js";

// In local mode the loaded extension (service worker and its pages) probes
// 127.0.0.1:17373-17382 and talks to the first Pinar that answers: on a
// development machine that is the owner's Pinar.app. Contexts that load the
// extension go through launchExtensionContext, which starts a proxy owned by
// the test and hands it to Chromium at launch (Playwright forces loopback
// through it with <-loopback>). The proxy refuses every Pinar port with a 502
// before a byte leaves the browser, from the service worker's first
// instruction on: context.route only applies once the context exists, after
// the extension's service worker has already started. Every other request is
// forwarded unchanged, and context.route fakes still answer before the proxy.

const PINAR_PORTS = new Set(pinarPorts());

export interface PinarPortRequest {
  method: string;
  path: string;
  port: number;
}

export interface PinarPortObservation extends PinarPortRequest {
  origin: string;
}

export interface PinarPortLog {
  // What the proxy refused (authoritative: these never left the browser).
  refused: PinarPortRequest[];
  // Playwright's view of the same requests, with the service worker or the
  // page that issued them; it starts once the context exists.
  observed: PinarPortObservation[];
}

export interface ExtensionIsolation {
  // Pinar ports the proxy forwards instead of refusing (the guard test's
  // positive control only). Every other Pinar port stays refused.
  allowPinarPorts?: number[];
}

type LaunchOptions = NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;

// Playwright Test fills every context option the caller leaves out with the
// project's device (runBeforeCreateBrowserContext), launchPersistentContext
// included, so the webkit and mobile projects would emulate Safari, an iPhone
// or a Pixel inside the Chromium that loads the extension. MV3 extensions only
// exist in desktop Chromium: these keys keep that device unless a test sets
// them itself (userAgent undefined is Chromium's own).
const DESKTOP_CHROMIUM: LaunchOptions = {
  deviceScaleFactor: 1,
  hasTouch: false,
  isMobile: false,
  userAgent: undefined,
  viewport: { height: 720, width: 1280 },
};

const logs = new WeakMap<BrowserContext, PinarPortLog>();

export function pinarPortLog(context: BrowserContext): PinarPortLog {
  const log = logs.get(context);
  if (!log) throw new Error("context was not launched with launchExtensionContext");
  return log;
}

function pinarPort(hostname: string, port: number, allowed: Set<number>): boolean {
  const loopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
  return loopback && PINAR_PORTS.has(port) && !allowed.has(port);
}

function forwardedHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const { "proxy-connection": _proxyConnection, ...rest } = headers;
  return rest;
}

async function startIsolationProxy(allowed: Set<number>, refused: PinarPortRequest[]) {
  const tunnels = new Set<Duplex>();
  const server = createServer((request, response) => {
    let target: URL;
    try {
      target = new URL(request.url ?? "");
    } catch {
      response.writeHead(400).end();
      return;
    }
    const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
    if (pinarPort(target.hostname, port, allowed)) {
      refused.push({ method: request.method ?? "GET", path: target.pathname, port });
      response.writeHead(502, { "x-pinar-e2e": "refused" }).end();
      return;
    }
    const upstream = forward(target, { headers: forwardedHeaders(request.headers), method: request.method }, (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    });
    upstream.on("error", () => response.destroy());
    request.pipe(upstream);
  });
  server.on("connect", (request, socket, head) => {
    const target = new URL(`http://${request.url ?? ""}`);
    const port = Number(target.port || 443);
    if (pinarPort(target.hostname, port, allowed)) {
      refused.push({ method: "CONNECT", path: "", port });
      socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      return;
    }
    const upstream = connect(port, target.hostname, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    tunnels.add(socket).add(upstream);
    const close = () => { socket.destroy(); upstream.destroy(); tunnels.delete(socket); tunnels.delete(upstream); };
    upstream.on("error", close).on("close", close);
    socket.on("error", close).on("close", close);
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  return {
    port: (server.address() as AddressInfo).port,
    stop: () => new Promise<void>((resolveClose) => {
      for (const socket of tunnels) socket.destroy();
      server.closeAllConnections();
      server.close(() => resolveClose());
    }),
  };
}

export async function launchExtensionContext(
  userDataDir: string,
  options: LaunchOptions,
  isolation: ExtensionIsolation = {},
): Promise<BrowserContext> {
  if (options.proxy) throw new Error("launchExtensionContext owns the proxy option");
  const allowed = new Set(isolation.allowPinarPorts ?? []);
  const log: PinarPortLog = { observed: [], refused: [] };
  const proxy = await startIsolationProxy(allowed, log.refused);
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      ...DESKTOP_CHROMIUM,
      ...options,
      proxy: { server: `http://127.0.0.1:${proxy.port}` },
    });
  } catch (error) {
    await proxy.stop();
    throw error;
  }
  logs.set(context, log);
  context.on("request", (request) => {
    const url = new URL(request.url());
    const port = Number(url.port);
    if (url.hostname !== "127.0.0.1" || !PINAR_PORTS.has(port)) return;
    let origin = "unknown";
    if (request.serviceWorker()) origin = "service-worker";
    else {
      try { origin = `page ${new URL(request.frame().url()).pathname}`; } catch { /* navigation before its frame */ }
    }
    log.observed.push({ method: request.method(), origin, path: url.pathname, port });
  });
  context.once("close", () => {
    void proxy.stop();
    try {
      void test.info().attach("pinar-port-requests", { body: JSON.stringify(log, null, 2), contentType: "application/json" });
    } catch { /* outside a test */ }
  });
  return context;
}
