import { writeSync } from "node:fs";

export interface JsonRpc {
  error?: { code: number; message: string };
  id?: number | string | null;
  jsonrpc: "2.0";
  method?: string;
  params?: unknown;
  result?: unknown;
}

export type Framing = "lsp" | "ndjson";

export function encodeMessage(message: JsonRpc, framing: Framing = "lsp"): string {
  const body = JSON.stringify(message);
  if (framing === "ndjson") return `${body}\n`;
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

export function writeStdio(message: JsonRpc, framing: Framing = "lsp"): void {
  writeSync(1, encodeMessage(message, framing));
}

export function pullMessages(buffer: Buffer): { framing?: Framing; messages: JsonRpc[]; rest: Buffer } {
  const messages: JsonRpc[] = [];
  let rest = buffer;
  let framing: Framing | undefined;

  while (rest.length > 0) {
    while (rest.length > 0 && (rest[0] === 0x20 || rest[0] === 0x0a || rest[0] === 0x0d || rest[0] === 0x09)) {
      rest = rest.subarray(1);
    }
    if (rest.length === 0) break;

    const head = rest.subarray(0, Math.min(rest.length, 64)).toString("utf8");
    if (/^content-length:/i.test(head)) {
      const crlf = rest.indexOf("\r\n\r\n");
      const lf = rest.indexOf("\n\n");
      const useCrlf = crlf >= 0 && (lf < 0 || crlf <= lf);
      const headerEnd = useCrlf ? crlf : lf;
      const sep = useCrlf ? 4 : 2;
      if (headerEnd < 0) break;
      const header = rest.subarray(0, headerEnd).toString("utf8");
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        rest = rest.subarray(headerEnd + sep);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + sep;
      if (rest.length < start + length) break;
      messages.push(JSON.parse(rest.subarray(start, start + length).toString("utf8")) as JsonRpc);
      rest = rest.subarray(start + length);
      framing = "lsp";
      continue;
    }

    if (rest[0] === 0x7b) {
      const newline = rest.indexOf(0x0a);
      if (newline < 0) break;
      const line = rest.subarray(0, newline).toString("utf8").trim();
      rest = rest.subarray(newline + 1);
      if (line) {
        messages.push(JSON.parse(line) as JsonRpc);
        framing = "ndjson";
      }
      continue;
    }

    rest = rest.subarray(1);
  }

  return { framing, messages, rest };
}