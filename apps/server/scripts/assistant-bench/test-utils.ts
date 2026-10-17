// Offline test support: a scripted fake fetch that emits SSE chunks and
// records every request. No network access in tests.

export interface ScriptedResponse {
  // SSE events as values; each entry is enqueued as one chunk:
  // `data: JSON.stringify(entry)\n\n`. The stream ends with `data: [DONE]`
  // unless `done: false` (truncated-stream tests).
  chunks?: unknown[];
  done?: boolean;
  retryAfter?: string;
  // Stream 2xx responses with an error after the chunks.
  streamError?: boolean;
  status?: number;
}

export interface RecordedRequest {
  body: string;
  headers: Record<string, string>;
  method: string;
  redirect: string | undefined;
  url: string;
}

export interface FakeFetch {
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  requests: RecordedRequest[];
}

export function sseJson(value: unknown): string {
  return JSON.stringify(value);
}

// One SSE chunk in wire form (used when a test needs the raw line).
export function sseLine(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

export function makeFakeFetch(script: ScriptedResponse[]): FakeFetch {
  const requests: RecordedRequest[] = [];
  let call = 0;
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (init?.headers && typeof init.headers === "object" && !Array.isArray(init.headers)) {
      for (const [key, value] of Object.entries(init.headers as Record<string, unknown>)) {
        if (typeof value === "string") headers[key] = value;
      }
    }
    const body = typeof init?.body === "string" ? init.body : "";
    requests.push({
      body,
      headers,
      method: init?.method ?? "GET",
      redirect: init?.redirect,
      url,
    });
    const response = script[call];
    call += 1;
    if (!response) throw new Error(`fakeFetch: ${call}ª requisição, script tem ${script.length}`);
    const status = response.status ?? 200;
    const responseHeaders: Record<string, string> = {};
    if (response.retryAfter !== undefined) responseHeaders["Retry-After"] = response.retryAfter;
    if (status < 200 || status >= 300) {
      return new Response(
        JSON.stringify({ error: { code: "appliance_error", message: "synthetic error body with sk-test-NAO-VAZAR inside" } }),
        { headers: responseHeaders, status },
      );
    }
    const chunks = response.chunks ?? [];
    const done = response.done !== false;
    let emitted = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted < chunks.length) {
          controller.enqueue(new TextEncoder().encode(sseLine(chunks[emitted])));
          emitted += 1;
          return;
        }
        if (response.streamError) {
          controller.error(new Error("scripted stream failure"));
          return;
        }
        // The appliance ends the stream with the [DONE] marker.
        if (done) {
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        }
        controller.close();
      },
    });
    return new Response(stream, { headers: responseHeaders, status });
  };
  return { fetchImpl, requests };
}
