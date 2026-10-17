// Local-app dependencies for handleAssistantRequest (contract sections 2
// and 5). The local app is a single-person app: there is no rate limit and
// no plan gate; availability is the ai.json configuration, read with the
// same functions the rest of the local AI surface uses (readAiSettings and
// localAiVault).
//
// Proposals (F2 contract section 3): the state reader reads the same
// history database, and confirm/undo run through the same local MCP
// handlers as the turn's reads, because the local app already writes.
//
// Pin search (F3 contract §3.2): the runtime attached to the history
// database (retrieval/runtime-local.ts), only while the AI is configured.

import { historyDatabase } from "../api.local";
import { localMcpHandlers } from "../local-mcp";
import type { AssistantRequestDeps } from "./http";
import { localAiConfigured, localAiSettings, localAssistantEndpoint, localPinSearch } from "./retrieval/runtime-local";
import { localAssistantStateReader } from "./state-reader-local";
import { localAssistantStore } from "./store-local";
import type { AssistantToolHost } from "./tools";

export function localAssistantDeps(request: Request): AssistantRequestDeps {
  // The same origin /api/mcp uses for tool results and links.
  const origin = new URL(request.url).origin;
  const database = historyDatabase();
  const mcpHost: AssistantToolHost = {
    callTool: (name, args) => localMcpHandlers(database, origin).callTool(name, args),
  };
  const pinSearch = localAiConfigured() ? localPinSearch(database) : undefined;
  return {
    endpoint: () => localAssistantEndpoint(),
    ...(pinSearch ? { pinSearch } : {}),
    async status() {
      const settings = await localAiSettings();
      return settings ? { available: true, reason: null } : { available: false, reason: "not_configured" };
    },
    reader: localAssistantStateReader(database),
    store: localAssistantStore(database),
    surface: "local",
    toolHost: mcpHost,
    writeHost: mcpHost,
  };
}
