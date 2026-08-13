import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { makeNewPin, makePage } from "./factory";
import { startHttpServer } from "./http";

const servers: Array<ReturnType<typeof startHttpServer>["server"]> = [];

afterEach(() => {
  for (const server of servers) server.stop(true);
  servers.length = 0;
});

async function start() {
  const root = await mkdtemp(join(tmpdir(), "ai-feedback-http-"));
  const started = startHttpServer({ port: 0, root });
  servers.push(started.server);
  return {
    root,
    url: `http://127.0.0.1:${started.server.port}`,
  };
}

describe("http sidecar", () => {
  test("send then take returns the comment and clears the waiting bundle", async () => {
    // Mutation captured: GET /v1/sent consuming the bundle (take vs peek).
    const { url } = await start();
    const pageRes = await fetch(`${url}/v1/page`, {
      body: JSON.stringify(makePage({ url: "http://localhost:4173/app" })),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    expect(pageRes.status).toBe(200);

    const pinRes = await fetch(`${url}/v1/pins`, {
      body: JSON.stringify(makeNewPin({ comment: "Hero title is too small" })),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(pinRes.status).toBe(201);

    const sendRes = await fetch(`${url}/v1/send`, { method: "POST" });
    expect(sendRes.status).toBe(200);

    const peek = await fetch(`${url}/v1/sent`).then((res) => res.json()) as {
      markdown: string;
      waiting: boolean;
    };
    expect(peek.waiting).toBe(true);
    expect(peek.markdown).toContain("Hero title is too small");

    const taken = await fetch(`${url}/v1/take`, { method: "POST" }).then((res) => res.json()) as {
      markdown: string;
      waiting: boolean;
    };
    expect(taken.waiting).toBe(true);
    expect(taken.markdown).toContain("http://localhost:4173/app");

    const again = await fetch(`${url}/v1/take`, { method: "POST" }).then((res) => res.json()) as {
      waiting: boolean;
    };
    expect(again.waiting).toBe(false);
  });

  test("PUT /v1/draft replaces leftover pins before send", async () => {
    // Mutation captured: Send appending extension pins onto a stale sidecar draft.
    const { url } = await start();
    await fetch(`${url}/v1/pins`, {
      body: JSON.stringify(makeNewPin({ comment: "stale" })),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const replaced = await fetch(`${url}/v1/draft`, {
      body: JSON.stringify({
        page: makePage({ url: "http://localhost:3000/" }),
        pins: [makeNewPin({ comment: "from extension" })],
      }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    expect(replaced.status).toBe(200);
    await fetch(`${url}/v1/send`, { method: "POST" });
    const taken = await fetch(`${url}/v1/take`, { method: "POST" }).then((res) => res.json()) as {
      markdown: string;
    };
    expect(taken.markdown).toContain("from extension");
    expect(taken.markdown).not.toContain("stale");
  });

  test("two sends stay queued and take returns them oldest first", async () => {
    // Mutation captured: POST /v1/send overwriting the previous waiting bundle.
    const { url } = await start();
    await fetch(`${url}/v1/draft`, {
      body: JSON.stringify({
        page: makePage({ url: "http://localhost/a" }),
        pins: [makeNewPin({ comment: "first" })],
      }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    expect((await fetch(`${url}/v1/send`, { method: "POST" })).status).toBe(200);
    await fetch(`${url}/v1/draft`, {
      body: JSON.stringify({
        page: makePage({ url: "http://localhost/b" }),
        pins: [makeNewPin({ comment: "second" })],
      }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    expect((await fetch(`${url}/v1/send`, { method: "POST" })).status).toBe(200);

    const first = await fetch(`${url}/v1/take`, { method: "POST" }).then((res) => res.json()) as {
      markdown: string;
    };
    const second = await fetch(`${url}/v1/take`, { method: "POST" }).then((res) => res.json()) as {
      markdown: string;
    };
    expect(first.markdown).toContain("first");
    expect(first.markdown).toContain("http://localhost/a");
    expect(second.markdown).toContain("second");
    expect(second.markdown).toContain("http://localhost/b");
  });

  test("send without pins is 400", async () => {
    // Mutation captured: treating an empty draft as a successful send.
    const { url } = await start();
    const res = await fetch(`${url}/v1/send`, { method: "POST" });
    expect(res.status).toBe(400);
  });
});