import { createHandlers } from "./handlers";
import { createStore } from "./store";
import type { NewPin, PageContext } from "./types";

interface ServeOptions {
  hostname?: string;
  port: number;
  root: string;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function notFound(): Response {
  return json({ error: "not found" }, 404);
}

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  return JSON.parse(text);
}

export function startHttpServer(options: ServeOptions) {
  const store = createStore(options.root);
  const handlers = createHandlers(store);

  const server = Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port,
    async fetch(req) {
      const url = new URL(req.url);
      const { method } = req;
      const path = url.pathname;

      try {
        if (method === "GET" && path === "/health") {
          return json({ ok: true });
        }
        if (method === "GET" && path === "/v1/status") {
          return json(await handlers.status());
        }
        if (method === "GET" && path === "/v1/draft") {
          return json(await handlers.draft());
        }
        if (method === "PUT" && path === "/v1/page") {
          return json(await handlers.setPage((await readJson(req)) as PageContext));
        }
        if (method === "PUT" && path === "/v1/draft") {
          const body = (await readJson(req)) as { page?: PageContext; pins?: NewPin[] };
          return json(await handlers.replaceDraft(body.page as PageContext, body.pins ?? []));
        }
        if (method === "POST" && path === "/v1/pins") {
          return json(await handlers.addPin((await readJson(req)) as NewPin), 201);
        }
        if (method === "DELETE" && path.startsWith("/v1/pins/")) {
          const id = decodeURIComponent(path.slice("/v1/pins/".length));
          const removed = await handlers.removePin(id);
          return removed ? json({ ok: true }) : json({ error: "pin not found" }, 404);
        }
        if (method === "DELETE" && path === "/v1/draft") {
          await handlers.clearDraft();
          return json({ ok: true });
        }
        if (method === "POST" && path === "/v1/send") {
          return json(await handlers.send((await readJson(req)) as {
            pinCrops?: Record<string, string>;
            viewportPng?: string;
          }));
        }
        if (method === "GET" && path === "/v1/sent") {
          return json(await handlers.peek());
        }
        if (method === "POST" && path === "/v1/take") {
          return json(await handlers.take());
        }
        return notFound();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = /no pins/i.test(message) ? 400 : 500;
        return json({ error: message }, status);
      }
    },
  });

  return { handlers, server, store };
}