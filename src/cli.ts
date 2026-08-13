#!/usr/bin/env bun
import { startHttpServer } from "./http";
import { bindSidecarHttp, serveMcpStdio } from "./mcp";
import { defaultRoot, resolvePort } from "./paths";

const command = process.argv[2] ?? "serve";
const root = defaultRoot();
const port = resolvePort();

if (command === "serve") {
  const { server } = startHttpServer({ port, root });
  console.error(`ai-feedback sidecar http://127.0.0.1:${server.port}`);
  console.error(`store ${root}`);
} else if (command === "mcp") {
  const bound = await bindSidecarHttp({ port, root });
  if (bound) {
    console.error(`ai-feedback sidecar http://127.0.0.1:${bound.port}`);
  } else {
    console.error(`ai-feedback sidecar already on :${port}; sharing store ${root}`);
  }
  try {
    await serveMcpStdio(root);
  } finally {
    bound?.stop();
  }
} else {
  console.error("Usage: ai-feedback <serve|mcp>");
  process.exit(1);
}