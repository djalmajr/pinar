export interface AiPromptMessage {
  content: string;
  role: "system" | "user";
}

export interface AiPrompt {
  jsonObject?: boolean;
  messages: AiPromptMessage[];
  temperature?: number;
}

export type AiProviderKind = "byok" | "local" | "pinar_cloud";

export interface AiProviderConfig {
  apiKey?: string;
  endpoint: string;
  mode: Exclude<AiProviderKind, "pinar_cloud">;
  model: string;
}

export interface AiInferenceLimits {
  maxTokens: number;
  timeoutMs: number;
}

export interface AiInferenceResult {
  model: string;
  provider: AiProviderKind;
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AiInferenceProvider {
  readonly model: string;
  readonly provider: AiProviderKind;
  run(prompt: AiPrompt, limits: AiInferenceLimits): Promise<AiInferenceResult>;
  testConnection(): Promise<{ model: string; ok: true; provider: AiProviderKind }>;
}

function cloudflareResponseText(output: unknown) {
  if (typeof output === "string") return output;
  if (!record(output)) return "";
  if (typeof output.response === "string") return output.response;
  if (Array.isArray(output.choices) && record(output.choices[0])) {
    const message = output.choices[0].message;
    return record(message) && typeof message.content === "string" ? message.content : "";
  }
  if (typeof output.output_text === "string") return output.output_text;
  if (Array.isArray(output.output)) {
    const texts: string[] = [];
    for (const item of output.output) {
      if (!record(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (record(part) && part.type === "output_text" && typeof part.text === "string") texts.push(part.text);
      }
    }
    return texts.join("\n");
  }
  return "";
}

export function cloudflareAiProvider(ai: Ai, model: string): AiInferenceProvider {
  return {
    model,
    provider: "pinar_cloud",
    async run(prompt, limits) {
      const responsesApi = model.startsWith("@cf/openai/gpt-oss");
      const input = responsesApi
        ? {
            input: prompt.messages.filter((message) => message.role === "user").map((message) => message.content).join("\n\n"),
            instructions: prompt.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n"),
            max_output_tokens: limits.maxTokens,
            reasoning: { effort: "low" },
          }
        : {
            max_tokens: limits.maxTokens,
            messages: prompt.messages,
            ...(prompt.jsonObject ? { response_format: { type: "json_object" } } : {}),
            temperature: prompt.temperature ?? 0.1,
          };
      let output: unknown;
      try {
        output = await ai.run(
          model as Parameters<Ai["run"]>[0],
          input as Parameters<Ai["run"]>[1],
          { signal: AbortSignal.timeout(limits.timeoutMs) },
        );
      } catch (error) {
        if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
          throw new AiInferenceError("ai_timeout", "Pinar Cloud AI timed out");
        }
        throw new AiInferenceError("ai_endpoint_unavailable", "Pinar Cloud AI is unavailable");
      }
      const text = cloudflareResponseText(output);
      if (!text) throw new AiInferenceError("invalid_ai_response", "Pinar Cloud AI returned an empty completion");
      const usage = record(output) && record(output.usage) ? output.usage : {};
      const content = prompt.messages.map((message) => message.content).join("\n");
      return {
        model,
        provider: "pinar_cloud",
        text,
        usage: {
          inputTokens: positiveNumber(usage.prompt_tokens) || positiveNumber(usage.input_tokens) || Math.ceil(content.length / 4),
          outputTokens: positiveNumber(usage.completion_tokens) || positiveNumber(usage.output_tokens) || Math.ceil(text.length / 4),
        },
      };
    },
    async testConnection() {
      return { model, ok: true, provider: "pinar_cloud" };
    },
  };
}

export type AiInferenceErrorCode =
  | "ai_auth_failed"
  | "ai_endpoint_unavailable"
  | "ai_model_unavailable"
  | "ai_timeout"
  | "invalid_ai_response";

export class AiInferenceError extends Error {
  constructor(readonly code: AiInferenceErrorCode, message: string) {
    super(message);
    this.name = "AiInferenceError";
  }
}

interface OpenAiCompatibleDependencies {
  fetch?: typeof fetch;
}

function endpointUrl(endpoint: string, suffix: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AiInferenceError("ai_endpoint_unavailable", "The AI endpoint is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AiInferenceError("ai_endpoint_unavailable", "The AI endpoint must use HTTP or HTTPS");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${suffix}`.replace(/\/+/g, "/");
  url.search = "";
  url.hash = "";
  return url.toString();
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

async function responseBody(response: Response) {
  try {
    return await response.json() as unknown;
  } catch {
    throw new AiInferenceError("invalid_ai_response", "The AI endpoint returned an invalid JSON response");
  }
}

function classifyHttpError(response: Response): AiInferenceError {
  if (response.status === 401 || response.status === 403) {
    return new AiInferenceError("ai_auth_failed", "The AI endpoint rejected the configured API key");
  }
  if (response.status === 404) {
    return new AiInferenceError("ai_model_unavailable", "The configured model or OpenAI-compatible route was not found");
  }
  return new AiInferenceError("ai_endpoint_unavailable", `The AI endpoint returned HTTP ${response.status}`);
}

async function request(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number) {
  try {
    return await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new AiInferenceError("ai_timeout", "The AI endpoint timed out");
    }
    throw new AiInferenceError("ai_endpoint_unavailable", "The AI endpoint could not be reached");
  }
}

export function openAiCompatibleProvider(
  config: AiProviderConfig,
  dependencies: OpenAiCompatibleDependencies = {},
): AiInferenceProvider {
  const fetcher = dependencies.fetch ?? fetch;
  const headers = () => {
    const value = new Headers({ "Content-Type": "application/json" });
    if (config.apiKey) value.set("Authorization", `Bearer ${config.apiKey}`);
    return value;
  };
  return {
    model: config.model,
    provider: config.mode,
    async run(prompt, limits) {
      const response = await request(fetcher, endpointUrl(config.endpoint, "chat/completions"), {
        body: JSON.stringify({
          max_tokens: limits.maxTokens,
          messages: prompt.messages,
          model: config.model,
          ...(prompt.jsonObject ? { response_format: { type: "json_object" } } : {}),
          temperature: prompt.temperature ?? 0.1,
        }),
        headers: headers(),
        method: "POST",
      }, limits.timeoutMs);
      if (!response.ok) throw classifyHttpError(response);
      const body = await responseBody(response);
      if (!record(body) || !Array.isArray(body.choices) || !record(body.choices[0])) {
        throw new AiInferenceError("invalid_ai_response", "The AI endpoint returned no completion");
      }
      const message = body.choices[0].message;
      const text = record(message) && typeof message.content === "string" ? message.content : "";
      if (!text) throw new AiInferenceError("invalid_ai_response", "The AI endpoint returned an empty completion");
      const usage = record(body.usage) ? body.usage : {};
      return {
        model: typeof body.model === "string" && body.model ? body.model : config.model,
        provider: config.mode,
        text,
        usage: {
          inputTokens: positiveNumber(usage.prompt_tokens),
          outputTokens: positiveNumber(usage.completion_tokens),
        },
      };
    },
    async testConnection() {
      const response = await request(fetcher, endpointUrl(config.endpoint, "models"), {
        headers: headers(),
        method: "GET",
      }, 10_000);
      if (!response.ok) throw classifyHttpError(response);
      const body = await responseBody(response);
      const models = record(body) && Array.isArray(body.data)
        ? body.data.flatMap((item) => record(item) && typeof item.id === "string" ? [item.id] : [])
        : [];
      if (!models.includes(config.model)) {
        throw new AiInferenceError("ai_model_unavailable", "The configured model is not available at this endpoint");
      }
      return { model: config.model, ok: true, provider: config.mode };
    },
  };
}
