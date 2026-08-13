import http from "node:http";
import { writeShot } from "./shots.mjs";

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function startShotServer(options) {
  const hostname = options.hostname ?? "127.0.0.1";
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", `http://${hostname}`).pathname;
    try {
      if (req.method === "GET" && path === "/health") {
        sendJson(res, { ok: true });
        return;
      }
      if (req.method === "POST" && path === "/v1/shots") {
        const body = JSON.parse(String(await readBody(req)) || "{}");
        if (!body.id || !body.image) {
          sendJson(res, { error: "id and image required" }, 400);
          return;
        }
        const saved = await writeShot(body.id, body.image, options.root);
        sendJson(res, { ok: true, path: saved }, 201);
        return;
      }
      sendJson(res, { error: "not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, { error: message }, 500);
    }
  });

  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(options.port, hostname, () => {
      server.removeListener("error", onError);
      const address = server.address();
      resolve({ port: typeof address === "object" && address ? address.port : options.port, server });
    });
  });
}
