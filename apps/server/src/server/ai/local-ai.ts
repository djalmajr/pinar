import {
  applySessionPatch,
  type Session,
} from "@pinar/shared";
import {
  createAiCredentialVault,
  readAiSettings,
  writeAiSettings,
} from "@pinar/cli/ai-settings";
import {
  AiInferenceError,
  openAiCompatibleProvider,
  type AiInferenceProvider,
  type AiProviderConfig,
  type AiProviderKind,
  type AiPrompt,
} from "./inference";
import {
  REPRODUCTION_INSTRUCTIONS,
  parseGenerated,
  reproductionPromptInput,
} from "./reproduction";

interface LocalSession extends Session {
  shotPath?: string | null;
}

export interface LocalAiDatabase {
  getSession(id: string): LocalSession | null;
  saveSession(input: Record<string, unknown>): LocalSession;
}

interface CredentialVault {
  clear(): Promise<void>;
  get(): Promise<string | null>;
  set(secret: string): Promise<void>;
}

const LIMITS = {
  reproduction: { maxTokens: 2_048, timeoutMs: 60_000 },
} as const;

const OUTPUT_LANGUAGES = new Set(["de", "en", "es", "fr", "ja", "pt", "zh"]);

let fetchOverride: typeof fetch | undefined;
let vaultOverride: CredentialVault | undefined;

export function setLocalAiDependenciesForTests(value: { fetch?: typeof fetch; vault?: CredentialVault }) {
  fetchOverride = value.fetch;
  vaultOverride = value.vault;
}

export function resetLocalAiForTests() {
  fetchOverride = undefined;
  vaultOverride = undefined;
}

function vault() {
  return vaultOverride ?? createAiCredentialVault();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function body(request: Request) {
  try {
    const value: unknown = await request.json();
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function stringValue(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" ? value[key] as string : "";
}

function language(value: string) {
  return OUTPUT_LANGUAGES.has(value) ? value : "en";
}

function json(value: unknown, status = 200) {
  return Response.json(value, { headers: { "Cache-Control": "no-store" }, status });
}

function apiKeyPreview(apiKey?: string) {
  if (!apiKey) return "";
  if (apiKey.length < 9) return "••••";
  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
}

function publicSettings(settings: Awaited<ReturnType<typeof readAiSettings>>) {
  return {
    apiKeyPreview: apiKeyPreview(settings.apiKey),
    endpoint: settings.endpoint,
    hasApiKey: settings.hasApiKey,
    mode: settings.mode,
    model: settings.model,
  };
}

async function configuredProvider(root: string, candidate?: Record<string, unknown>): Promise<AiInferenceProvider> {
  const stored = await readAiSettings(root, vault());
  const mode = candidate?.mode === "local" || candidate?.mode === "byok" ? candidate.mode : stored.mode;
  if (mode !== "local" && mode !== "byok") {
    throw new AiInferenceError("ai_endpoint_unavailable", "Configure Local AI or BYOK in Settings before using AI");
  }
  const apiKey = typeof candidate?.apiKey === "string" && candidate.apiKey
    ? candidate.apiKey
    : stored.apiKey;
  if (mode === "byok" && !apiKey) {
    throw new AiInferenceError("ai_auth_failed", "An API key is required for BYOK");
  }
  const config: AiProviderConfig = {
    ...(apiKey ? { apiKey } : {}),
    endpoint: typeof candidate?.endpoint === "string" ? candidate.endpoint : stored.endpoint,
    mode,
    model: typeof candidate?.model === "string" ? candidate.model : stored.model,
  };
  return openAiCompatibleProvider(config, { fetch: fetchOverride });
}

function inferenceError(error: unknown) {
  if (!(error instanceof AiInferenceError)) {
    return json({ code: "ai_inference_failed", error: "AI inference failed" }, 503);
  }
  const status = error.code === "ai_auth_failed" ? 401
    : error.code === "ai_model_unavailable" ? 422
      : error.code === "invalid_ai_response" ? 502
        : error.code === "ai_timeout" ? 504
          : 503;
  return json({ code: error.code, error: error.message }, status);
}

type InferenceOutcome<T> =
  | { ok: true; parsed: T; result: Awaited<ReturnType<AiInferenceProvider["run"]>> }
  | { ok: false; response: Response };

async function infer<T>(root: string, feature: keyof typeof LIMITS, prompt: AiPrompt, parse: (text: string, model: string, provider: AiProviderKind) => T | null): Promise<InferenceOutcome<T>> {
  try {
    const provider = await configuredProvider(root);
    const result = await provider.run(prompt, LIMITS[feature]);
    const parsed = parse(result.text, result.model, result.provider);
    if (!parsed) throw new AiInferenceError("invalid_ai_response", "The model returned a response that Pinar could not understand");
    return { ok: true, parsed, result };
  } catch (error) {
    return { ok: false, response: inferenceError(error) };
  }
}

function persistSession(database: LocalAiDatabase, existing: LocalSession, patched: Session) {
  return database.saveSession({
    batchId: existing.batchId ?? null,
    collectionId: existing.collectionId,
    createdAt: existing.createdAt,
    id: existing.id,
    includeScreenshot: existing.includeScreenshot,
    page: existing.page,
    pins: patched.pins,
    privacy: existing.privacy,
    reproduction: patched.reproduction,
    shotId: existing.shotId ?? null,
    shotPath: existing.shotPath ?? null,
  });
}

function success(parsed: unknown, result: Awaited<ReturnType<AiInferenceProvider["run"]>>) {
  return json({
    creditsCharged: 0,
    ok: true,
    result: parsed,
    usage: {
      inputTokens: result.usage.inputTokens,
      model: result.model,
      outputTokens: result.usage.outputTokens,
      provider: result.provider,
    },
  });
}

async function reproduction(request: Request, root: string, database: LocalAiDatabase) {
  const input = await body(request);
  const session = database.getSession(stringValue(input, "sessionId"));
  if (!session) return json({ error: "Session not found" }, 404);
  const prompt = reproductionPromptInput(session);
  if (!prompt) return json({ code: "reproduction_required", error: "This capture has no recorded steps" }, 422);
  const generated = await infer(root, "reproduction", {
    jsonObject: true,
    messages: [
      { role: "system", content: REPRODUCTION_INSTRUCTIONS },
      { role: "user", content: JSON.stringify({ language: language(stringValue(input, "language")), ...prompt }) },
    ],
    temperature: 0.1,
  }, (text, model, provider) => parseGenerated(model, provider)(text));
  if (!generated.ok) return generated.response;
  if (!session.reproduction) return json({ code: "reproduction_required", error: "This capture has no recorded steps" }, 422);
  const patched = applySessionPatch(session, { reproduction: { ...session.reproduction, generated: generated.parsed } });
  if (!patched) return json({ code: "reproduction_patch_failed", error: "Reproduction could not be saved" }, 500);
  persistSession(database, session, patched);
  return success(generated.parsed, generated.result);
}

export async function handleLocalAiRequest(
  request: Request,
  root: string,
  database: LocalAiDatabase,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/api/ai/settings") {
    return json({ ok: true, ...publicSettings(await readAiSettings(root, vault())) });
  }
  if (request.method === "DELETE" && path === "/api/ai/settings/key") {
    const credentialVault = vault();
    await credentialVault.clear();
    return json({ ok: true, ...publicSettings(await readAiSettings(root, credentialVault)) });
  }
  if (request.method === "PATCH" && path === "/api/ai/settings") {
    const input = await body(request);
    try {
      if (input.mode === "disabled") {
        const saved = await writeAiSettings({ mode: "disabled" }, root, vault());
        return json({ ok: true, ...publicSettings(saved) });
      }
      const provider = await configuredProvider(root, input);
      const tested = await provider.testConnection();
      const saved = await writeAiSettings({
        apiKey: typeof input.apiKey === "string" ? input.apiKey : undefined,
        endpoint: stringValue(input, "endpoint"),
        mode: input.mode,
        model: provider.model,
      }, root, vault());
      const stored = saved.mode === "byok" ? await readAiSettings(root, vault()) : saved;
      return json({ ok: true, tested, ...publicSettings(stored) });
    } catch (error) {
      return inferenceError(error);
    }
  }
  if (request.method === "POST" && path === "/api/ai/settings/test") {
    try {
      const tested = await (await configuredProvider(root, await body(request))).testConnection();
      return json(tested);
    } catch (error) {
      return inferenceError(error);
    }
  }
  if (request.method === "POST" && path === "/api/ai/reproduction") return reproduction(request, root, database);
  return null;
}
