export const AGENT_NAMES = ["claude", "codex", "cursor", "grok"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const AGENT_RESULT_STATUSES = [
  "blocked",
  "changed",
  "not_applicable",
  "not_located",
] as const;

export type AgentResultStatus = (typeof AGENT_RESULT_STATUSES)[number];

export const AGENT_RESULT_ERROR_CODES = [
  "capture_not_found",
  "idempotency_conflict",
  "invalid_payload",
  "pin_not_found",
] as const;

export type AgentResultErrorCode = (typeof AGENT_RESULT_ERROR_CODES)[number];

export const AGENT_RESULTS_JSON_FENCE = "pinar-agent-results";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const CAPTURE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const PIN_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const HTTP_URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const MAX_SUMMARY = 2000;
const MAX_FILES = 50;
const MAX_FILE_LENGTH = 500;
const MAX_COMMIT = 200;
const MAX_PULL_REQUEST = 500;

export class AgentResultError extends Error {
  readonly code: AgentResultErrorCode;

  constructor(code: AgentResultErrorCode) {
    super("invalid agent result");
    this.name = "AgentResultError";
    this.code = code;
  }
}

export interface AgentPinResult {
  commit?: string;
  createdAt: string;
  files: string[];
  pinId: string;
  pullRequest?: string;
  reason?: string;
  status: AgentResultStatus;
  summary: string;
}

export interface AgentExecution {
  agent: AgentName;
  captureId: string;
  createdAt: string;
  id: string;
  idempotencyKey: string;
  results: AgentPinResult[];
}

export interface AgentExecutionDraft {
  agent: AgentName;
  captureId: string;
  fingerprint: string;
  idempotencyKey: string;
  results: Array<Omit<AgentPinResult, "createdAt">>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function isAgentName(value: unknown): value is AgentName {
  return typeof value === "string" && (AGENT_NAMES as readonly string[]).includes(value);
}

export function isAgentResultStatus(value: unknown): value is AgentResultStatus {
  return typeof value === "string" && (AGENT_RESULT_STATUSES as readonly string[]).includes(value);
}

export function pinIdsFromPins(pins: Array<{ id?: string; pinId?: string }> | undefined | null) {
  return new Set(
    (pins || []).flatMap((pin) => {
      const pinId = pin.pinId || pin.id;
      return pinId ? [pinId] : [];
    }),
  );
}

function parseFiles(value: unknown) {
  if (value == null) return [] as string[];
  if (!Array.isArray(value) || value.length > MAX_FILES) throw new AgentResultError("invalid_payload");
  const files = value.map((item) => {
    const path = asString(item);
    if (!path || path.length > MAX_FILE_LENGTH || path.includes("\0") || path.includes("\n")) {
      throw new AgentResultError("invalid_payload");
    }
    return path;
  });
  return files;
}

function parseOptionalUrl(value: unknown) {
  const text = asString(value);
  if (!text) return undefined;
  if (text.length > MAX_PULL_REQUEST || !HTTP_URL_PATTERN.test(text)) {
    throw new AgentResultError("invalid_payload");
  }
  return text;
}

function parsePinResult(value: unknown, knownPinIds: Set<string>, seen: Set<string>) {
  if (!isRecord(value)) throw new AgentResultError("invalid_payload");
  const pinId = asString(value.pinId);
  if (!PIN_ID_PATTERN.test(pinId)) throw new AgentResultError("invalid_payload");
  if (!knownPinIds.has(pinId)) throw new AgentResultError("pin_not_found");
  if (seen.has(pinId)) throw new AgentResultError("invalid_payload");
  seen.add(pinId);
  const status = value.status;
  if (!isAgentResultStatus(status)) throw new AgentResultError("invalid_payload");
  const summary = asString(value.summary);
  if (!summary || summary.length > MAX_SUMMARY) throw new AgentResultError("invalid_payload");
  const reason = asString(value.reason);
  if (reason.length > MAX_SUMMARY) throw new AgentResultError("invalid_payload");
  const commit = asString(value.commit);
  if (commit.length > MAX_COMMIT) throw new AgentResultError("invalid_payload");
  return {
    commit: commit || undefined,
    files: parseFiles(value.files),
    pinId,
    pullRequest: parseOptionalUrl(value.pullRequest),
    reason: reason || undefined,
    status,
    summary,
  };
}

export function agentExecutionFingerprint(input: {
  agent: AgentName;
  captureId: string;
  results: Array<Omit<AgentPinResult, "createdAt">>;
}) {
  const results = [...input.results]
    .sort((left, right) => left.pinId.localeCompare(right.pinId))
    .map((result) => ({
      commit: result.commit || "",
      files: [...result.files],
      pinId: result.pinId,
      pullRequest: result.pullRequest || "",
      reason: result.reason || "",
      status: result.status,
      summary: result.summary,
    }));
  return JSON.stringify({
    agent: input.agent,
    captureId: input.captureId,
    results,
  });
}

export function parseAgentExecutionInput(input: unknown, knownPinIds: Iterable<string>): AgentExecutionDraft {
  if (!isRecord(input)) throw new AgentResultError("invalid_payload");
  const idempotencyKey = asString(input.idempotencyKey);
  const captureId = asString(input.captureId);
  const agent = input.agent;
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) throw new AgentResultError("invalid_payload");
  if (!CAPTURE_ID_PATTERN.test(captureId)) throw new AgentResultError("invalid_payload");
  if (!isAgentName(agent)) throw new AgentResultError("invalid_payload");
  if (!Array.isArray(input.results) || input.results.length === 0) {
    throw new AgentResultError("invalid_payload");
  }
  const pins = knownPinIds instanceof Set ? knownPinIds : new Set(knownPinIds);
  const seen = new Set<string>();
  const results = input.results.map((result) => parsePinResult(result, pins, seen));
  return {
    agent,
    captureId,
    fingerprint: agentExecutionFingerprint({ agent, captureId, results }),
    idempotencyKey,
    results,
  };
}

export function presentAgentExecution(execution: AgentExecution): AgentExecution {
  return {
    agent: execution.agent,
    captureId: execution.captureId,
    createdAt: execution.createdAt,
    id: execution.id,
    idempotencyKey: execution.idempotencyKey,
    results: execution.results.map((result) => ({
      commit: result.commit,
      createdAt: result.createdAt,
      files: [...result.files],
      pinId: result.pinId,
      pullRequest: result.pullRequest,
      reason: result.reason,
      status: result.status,
      summary: result.summary,
    })),
  };
}

export function encodeAgentExecutionsJson(executions: AgentExecution[]) {
  return JSON.stringify(executions.map(presentAgentExecution));
}

export function formatAgentResultsMarkdown(executions: AgentExecution[]) {
  if (!executions.length) return "";
  const lines = ["## Agent results", ""];
  for (const execution of executions) {
    lines.push(`### ${execution.agent} · ${execution.createdAt}`);
    lines.push(`idempotencyKey: ${execution.idempotencyKey}`);
    lines.push("");
    for (const result of execution.results) {
      lines.push(`- ${result.pinId}: ${result.status} — ${result.summary}`);
      if (result.reason) lines.push(`  - reason: ${result.reason}`);
      if (result.files.length) lines.push(`  - files: ${result.files.join(", ")}`);
      if (result.commit) lines.push(`  - commit: ${result.commit}`);
      if (result.pullRequest) lines.push(`  - pullRequest: ${result.pullRequest}`);
    }
    lines.push("");
  }
  lines.push(`\`\`\`${AGENT_RESULTS_JSON_FENCE}`);
  lines.push(encodeAgentExecutionsJson(executions));
  lines.push("```");
  return lines.join("\n").trim();
}

export function agentResultErrorBody(error: unknown) {
  const code = error instanceof AgentResultError ? error.code : "invalid_payload";
  return { code, error: "invalid agent result" };
}

export function agentResultHttpStatus(error: unknown) {
  if (!(error instanceof AgentResultError)) return 400;
  if (error.code === "capture_not_found") return 404;
  if (error.code === "idempotency_conflict") return 409;
  return 400;
}
