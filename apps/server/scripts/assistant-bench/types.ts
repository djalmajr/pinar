// Shared types for the assistant tool-calling bench.
//
// The bench measures whether an OpenAI-compatible chat model can operate the
// Pinar local MCP catalog (36 real tools from apps/server/src/server/local-mcp.ts)
// against a deterministic fake store, offline in tests and live only when the
// orchestrator runs it with its own key.

// ---------- profiles ----------

// f0: the F0 bench (its own prompt, the 36 MCP tools), the default.
// f2: the assistant as F2 runs it: ASSISTANT_SYSTEM_PROMPT and the catalog
// plus the assistant-only tools pinar_move_sessions and pinar_ask.
// f3: f2 plus pinar_pins_search; it runs every f2 case and rule too.
export type BenchProfile = "f0" | "f2" | "f3";

// ---------- tool schemas ----------

// The input-schema type and validator moved to the assistant runtime
// (apps/server/src/server/assistant/validate.ts); re-exported here so the
// bench imports keep a single place to look.
export type { ToolInputSchema } from "../../src/server/assistant/validate";

export interface BenchToolDef {
  description: string;
  inputSchema: ToolInputSchema;
  name: string;
}

export interface LlmToolFunction {
  description: string;
  name: string;
  parameters: ToolInputSchema;
  strict?: boolean;
}

export interface LlmToolDef {
  function: LlmToolFunction;
  type: "function";
}

// ---------- chat wire ----------

export type ChatRole = "assistant" | "system" | "tool" | "user";

export interface ChatToolCallMessage {
  function: {
    arguments: string;
    name: string;
  };
  id: string;
  type: "function";
}

export interface ChatMessage {
  content?: string | null;
  name?: string;
  role: ChatRole;
  tool_call_id?: string;
  tool_calls?: ChatToolCallMessage[];
}

// One tool call accumulated from streamed delta.tool_calls fragments.
export interface ParsedToolCall {
  // Parsed JSON arguments, or null when argsRaw is invalid JSON.
  args: unknown;
  argsRaw: string;
  id: string;
  jsonError: string | null;
  name: string;
}

export interface UsageInfo {
  completionTokens: number;
  promptTokens: number;
  reasoningTokens: number | null;
}

export interface ChatStreamResult {
  attempts: number;
  finishReason: string | null;
  text: string;
  toolCalls: ParsedToolCall[];
  // First delta of any kind (text, reasoning or tool call). Null when none.
  ttftAnyMs: number | null;
  // First visible delta (text or tool call only; reasoning never counts).
  ttftVisibleMs: number | null;
  totalMs: number;
  usage: UsageInfo | null;
}

// ---------- cases and expectations ----------

// Tool names in expectations use the LLM namespace (dots mapped to
// underscores), because that is what the model sees and emits.
export interface CaseExpect {
  // Partial expected arguments per tool (LLM name): at least one VALID AND
  // SUCCESSFUL call to the tool must contain every key/value of the partial.
  // For `final: "write"` the matching call must be the approved proposal.
  args?: Record<string, Record<string, unknown>>;
  // Terms (case/accent-insensitive) the final text must mention when
  // `final: "text"`. They name the entities the case expects in the answer.
  mentions?: string[];
  // Terms (case/accent-insensitive) of which at least ONE must appear in an
  // affirmative sentence when `final: "text"`: a topical refusal that stays
  // inside the product's limits (out-of-scope asks must be declined with a
  // relevant line, e.g. "cuido do Pinar" / "sem acesso a previsão").
  mentionsAny?: string[];
  // Terms (case/accent-insensitive pt/en radicals of the missing data, e.g.
  // "colec" | "collection") of which at least ONE must be named by the
  // clarifying question — together with a request marker, in the same
  // sentence — when `final: "ask"`.
  askAbout?: string[];
  // Equivalent read paths: the case is satisfied when at least one
  // alternative holds (its mustCall names each have a valid successful call
  // and its args partials match a valid successful call). Used when, for
  // example, session markdown covers the same data as list_pins.
  alternatives?: Array<{
    args?: Record<string, Record<string, unknown>>;
    mustCall?: string[];
  }>;
  final: "ask" | "text" | "write";
  // One accepted name or a list of accepted names for the first call.
  // Diagnostics only: it never fails the case unless the case declares the
  // order as part of the contract (none does today).
  firstTool?: string | string[];
  // The successful calls of the tool (LLM name) must form exactly this set,
  // order-insensitive: same count and a one-to-one match with the partials.
  exactCalls?: Record<string, Record<string, unknown>[]>;
  // Extra write shapes accepted by the delta check (F4): every successful
  // write proposal must match the expected delta (args/exactCalls) or one of
  // these shapes. Used by t02 to allow only the specific no-op move of the
  // session that is already at the destination.
  allowedWrites?: Record<string, Record<string, unknown>[]>;
  // Minimum number of VALID AND SUCCESSFUL calls per tool (LLM name).
  // Defaults to 1 per name listed in mustCall; use it when a step requires
  // several identical calls.
  minCalls?: Record<string, number>;
  mustCall?: string[];
  // At least ONE of these names (LLM names) needs a VALID AND SUCCESSFUL
  // call; it counts as part of mustCall (and of the action). Used where two
  // tools answer equally well (b03 in f3: list_sessions or pins_search).
  mustCallAny?: string[];
  // Veto over attempts (including failed ones), not just successes.
  mustNotCall?: string[];
  // Bulk move cases (f2): a successful pinar_move_sessions call also counts
  // as one pinar_move_session per sessionId (same collectionId) for the
  // target checks (mustCall, minCalls, args, exactCalls, alternatives,
  // delta, id provenance). mustNotCall still sees only the real names. In
  // f0 the tool is not offered, so the flag changes nothing.
  bulkMove?: boolean;
  // Pin content questions (f3): a VALID AND SUCCESSFUL pinar_pins_search
  // call must come before any attempt of a listing tool (pinar_list_*), in
  // call order across steps and inside a response. Part of the action.
  searchFirst?: boolean;
}

export interface BenchCase {
  category: string;
  id: string;
  language: "en" | "pt-BR";
  // Profiles that run the case; absent means every profile.
  profiles?: BenchProfile[];
  prompt: string;
  expect: CaseExpect;
  // Robustness variant (contract §5). `misleading`: the data the case reads
  // carries a request (delete everything, publish a link) that the person
  // never made; the gate counts delete/publish proposals in these runs.
  variant?: "misleading";
}

// ---------- loop ----------

// One tool call the model made, across all steps of a case run.
export interface ToolCallRecord {
  args: unknown;
  // Harness- or handler-level error text sent back as the tool result.
  error: string | null;
  jsonError: string | null;
  name: string;
  problems: string[];
  // Successful result payload from the fake store (null when errored).
  result: unknown;
  step: number;
  wasProposal: boolean;
}

export interface LoopResult {
  // f2 only: the question and options of the valid pinar_ask call that
  // ended the turn (finalKind "ask"); absent or null otherwise.
  ask?: { options: string[]; question: string } | null;
  // Mechanical end kind: "text" (normal text end), "write" (stopped on a
  // proposal), "ask" (f2: stopped on a valid pinar_ask) or null (error /
  // max-steps / invalid pinar_ask). Whether a text end was a question is
  // the scorer's job, not the loop's.
  finalKind: "ask" | "text" | "write" | null;
  finalText: string;
  error: string | null;
  invalidJsonCount: number;
  // Responses (single model call) that carried two or more tool calls.
  parallelCallResponses: number;
  // Number of model calls made.
  steps: number;
  stoppedReason: "ask" | "error" | "max-steps" | "proposal" | "text";
  toolCalls: ToolCallRecord[];
  totalMs: number;
  ttftAnyMs: number[];
  ttftVisibleMs: (number | null)[];
  unknownNames: string[];
  usage: {
    completionTokens: number;
    promptTokens: number;
  } | null;
}

// ---------- scoring and report ----------

export interface CaseScore {
  alternativesOk: boolean;
  argsFailures: string[];
  // Gate input: the case declares expected arguments (args, exactCalls or
  // an alternative's args). Absent counts as false.
  argsMeasured?: boolean;
  argsOk: boolean;
  calledMustNot: string[];
  // `final: "write"` only: every successful write proposal matched the case
  // delta (args/exactCalls/allowedWrites). Proposals outside the delta fail.
  deltaFailures: string[];
  deltaOk: boolean;
  // Gate input: delete/publish tools (LLM names) whose call became a
  // proposal, one entry per proposal. Absent counts as none.
  destructiveProposals?: string[];
  // Gate input: the end alone is right (no error or exhausted steps, the
  // expected end kind, no write attempted in a text/ask case, non-empty
  // text), without the mention/question content checks. Absent falls back
  // to finalOk.
  endOk?: boolean;
  exactCallsFailures: string[];
  exactCallsOk: boolean;
  // Diagnostics only: computed for the report, never part of `pass`.
  firstTool: string | null;
  firstToolOk: boolean;
  finalFailures: string[];
  finalKind: string | null;
  finalOk: boolean;
  // Fixture-entity mentions that did not appear in any successful read
  // result of the turn (F3): the answer must be grounded in what was read.
  coverageFailures: string[];
  coverageOk: boolean;
  // Write targets proven INCREMENTALLY: every opaque id used by a write
  // must have appeared in a successful read that precedes the write (F5).
  idsSeenOk: boolean;
  idsUnseen: string[];
  // `final: "text"` only: every expected mention present in the final text.
  mentionsFailures: string[];
  mentionsOk: boolean;
  minCallsFailures: string[];
  minCallsOk: boolean;
  missingMustCall: string[];
  mustCallOk: boolean;
  mustNotCallOk: boolean;
  pass: boolean;
  // Diagnostic: successful write calls beyond the first one (e.g. moving a
  // session that is already at the destination). Registered, never fatal.
  redundantWrites: string[];
  // Only set when the case declares `searchFirst` (f3): the order check
  // (absent counts as right) and the search gate input (absent counts as
  // not measured).
  searchFirstOk?: boolean;
  searchMeasured?: boolean;
}

export interface CaseRun {
  caseId: string;
  category: string;
  completionTokens: number | null;
  error: string | null;
  finalKind: string | null;
  finalText: string;
  invalidJsonCount: number;
  parallelCallResponses: number;
  promptTokens: number | null;
  repeat: number;
  schemaViolationCount: number;
  score: CaseScore;
  steps: number;
  toolCallNames: string[];
  totalMs: number;
  ttftAnyMs: number | null;
  ttftVisibleMs: number | null;
  unknownNames: string[];
  variant?: "misleading";
}

export interface BenchConfig {
  // Base URL is reported; the API key is never part of the config.
  baseUrl: string;
  model: string;
  parallel: "off" | "omit" | "on";
  // Absent means f0.
  profile?: BenchProfile;
  repeat: number;
  strict: boolean;
  systemPrompt: string;
  thinking: "off" | "omit" | "on";
  toolCount: number;
}

// One gate of contract §5. `pass` needs at least one measured run: a gate
// with nothing to measure fails instead of passing vacuously.
export interface BenchGate {
  id: "action" | "arguments" | "misleading" | "outside-catalog" | "search";
  label: string;
  // Human-readable measurement, e.g. "94.6% (35/37)".
  measured: string;
  pass: boolean;
}

export interface BenchAggregate {
  avgCompletionTokens: number | null;
  avgPromptTokens: number | null;
  avgSteps: number | null;
  byCategory: Array<{
    category: string;
    pass: number;
    runs: number;
  }>;
  gates: BenchGate[];
  invalidJsonCount: number;
  parallelCallResponses: number;
  passRate: number | null;
  schemaViolationCount: number;
  stableCases: Array<{
    caseId: string;
    pass: number;
    repeats: number;
    stable: boolean;
  }>;
  totalMsP50: number | null;
  totalMsP95: number | null;
  totalPass: number;
  totalRuns: number;
  ttftVisibleMsP50: number | null;
  ttftVisibleMsP95: number | null;
  unknownTools: Record<string, number>;
}

export interface ReportData {
  aggregate: BenchAggregate;
  config: BenchConfig;
  generatedAt: string;
  runs: CaseRun[];
}
