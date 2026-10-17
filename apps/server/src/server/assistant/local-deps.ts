// Local-app dependencies for handleAssistantRequest (contract sections 2
// and 5). The local app is a single-person app: there is no rate limit and
// no plan gate; availability is the ai.json configuration, read with the
// same functions the rest of the local AI surface uses (readAiSettings and
// localAiVault).

import { readAiSettings } from "@pinar/cli/ai-settings";
import { pinarHome } from "@pinar/cli/paths";
import { localAiVault } from "../ai/local-ai";
import { historyDatabase } from "../api.local";
import { localMcpHandlers } from "../local-mcp";
import type { AssistantEndpoint } from "./models";
import { detectThinkingControl } from "./models";
import type { AssistantRequestDeps } from "./http";
import { localAssistantStore } from "./store-local";

type LocalAiSettings = Awaited<ReturnType<typeof readAiSettings>>;

// The configured endpoint of the local app, or null when the AI is not
// configured (mode disabled, or endpoint/model missing). The key only
// exists in byok mode: readAiSettings fills it from the vault only then.
async function localAiSettings(): Promise<{ apiKey?: string; baseUrl: string; model: string } | null> {
  const settings: LocalAiSettings = await readAiSettings(pinarHome(), localAiVault());
  if (settings.mode === "disabled" || !settings.endpoint || !settings.model) return null;
  return settings.apiKey
    ? { apiKey: settings.apiKey, baseUrl: settings.endpoint, model: settings.model }
    : { baseUrl: settings.endpoint, model: settings.model };
}

export function localAssistantDeps(request: Request): AssistantRequestDeps {
  // The same origin /api/mcp uses for tool results and links.
  const origin = new URL(request.url).origin;
  const database = historyDatabase();
  return {
    async endpoint() {
      const settings = await localAiSettings();
      if (!settings) return null;
      const endpoint: AssistantEndpoint = {
        baseUrl: settings.baseUrl,
        kind: "openai-compatible",
        model: settings.model,
        thinkingControl: await detectThinkingControl({
          baseUrl: settings.baseUrl,
          model: settings.model,
          ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
        }),
      };
      if (settings.apiKey) endpoint.apiKey = settings.apiKey;
      return endpoint;
    },
    async status() {
      const settings = await localAiSettings();
      return settings ? { available: true, reason: null } : { available: false, reason: "not_configured" };
    },
    store: localAssistantStore(database),
    surface: "local",
    toolHost: {
      callTool: (name, args) => localMcpHandlers(database, origin).callTool(name, args),
    },
  };
}
