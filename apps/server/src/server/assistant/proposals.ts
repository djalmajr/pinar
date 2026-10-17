// Write proposals of the assistant.
//
// A write tool call never runs during the turn: it becomes a proposal the
// person confirms. This module prepares a proposal (reads the current state,
// builds the person's text and the undo plan) and runs the confirmation,
// the rejection and the undo over the store, the state reader and the MCP
// tool host:
// - prepare reads through AssistantStateReader; its fingerprint is the
//   sha256 of the canonical JSON of the values it used (display, undo plan
//   and preconditions beyond existence);
// - confirm claims `proposed -> executing` atomically in the store,
//   prepares again (a different fingerprint fails with proposal_stale and
//   the host is never called), executes through the same MCP handler and
//   records the outcome. A crash between executing and recording leaves the
//   proposal `executing`; publicProposal reads it as proposal_unknown_outcome
//   after ASSISTANT_EXECUTING_STALE_MS and nothing re-executes it;
// - undo claims `executed -> undoing` atomically, then compares the current
//   state of every entity the undo calls touch with the postFingerprint
//   recorded right after the execution, and only then calls the host. The
//   comparison and the calls are separate steps: a change that lands between
//   them is not detected.

import { McpToolError } from "../mcp-protocol";
import { MCP_RESOURCE_TYPES } from "../mcp-tools-cloud";
import type { AssistantStateReader } from "./state-reader";
import {
  ASSISTANT_PROPOSAL_ID_PATTERN,
  assistantThreadTitle,
  newAssistantProposalId,
  type AssistantProposalDisplay,
  type AssistantProposalErrorCode,
  type AssistantProposalPatch,
  type AssistantProposalRecord,
  type AssistantProposalRisk,
  type AssistantProposalStatus,
  type AssistantStore,
  type AssistantUndoPlan,
} from "./store";
import { ASSISTANT_TOOL_POLICY } from "./tool-policy";
import type { AssistantToolHost } from "./tools";

export { ASSISTANT_PROPOSAL_ID_PATTERN, newAssistantProposalId };
export type {
  AssistantProposalDisplay,
  AssistantProposalErrorCode,
  AssistantProposalRecord,
  AssistantProposalRisk,
  AssistantProposalStatus,
  AssistantUndoPlan,
};

export const ASSISTANT_PROPOSAL_TTL_MS = 10 * 60_000;
export const ASSISTANT_UNDO_WINDOW_MS = 10 * 60_000;
/** An `executing` proposal older than this reads as failed / proposal_unknown_outcome. */
export const ASSISTANT_EXECUTING_STALE_MS = 2 * 60_000;
export const ASSISTANT_BULK_MAX = 500;
export const ASSISTANT_DISPLAY_TEXT_MAX = 80; // graphemes, the same cut as assistantThreadTitle

/** The tool name without `pinar.`: the 27 MCP writes plus the assistant-only batch move. */
export type AssistantProposalAction =
  | "add_pin_comment"
  | "conclude_pin"
  | "create_batch"
  | "create_collection"
  | "create_pin"
  | "create_project"
  | "create_session"
  | "delete_batch"
  | "delete_collection"
  | "delete_pin"
  | "delete_pin_comment"
  | "delete_project"
  | "delete_session"
  | "edit_pin_comment"
  | "edit_pin_note"
  | "finish_batch"
  | "move_session"
  | "move_sessions"
  | "publish_share"
  | "reopen_pin"
  | "reorder_collections"
  | "reorder_projects"
  | "reorder_sessions"
  | "rename_batch"
  | "rename_collection"
  | "rename_project"
  | "revoke_share"
  | "update_session";

/** What crosses HTTP and the stream: never args, fingerprint, undo or result. */
export interface AssistantPublicProposal {
  createdAt: string;
  display: AssistantProposalDisplay;
  errorCode: AssistantProposalErrorCode | null;
  executedAt: string | null;
  expiresAt: string;
  id: string;
  messageId: string;
  risk: AssistantProposalRisk;
  status: AssistantProposalStatus;
  threadId: string;
  tool: string;
  undoExpiresAt: string | null;
}

export interface PreparedProposal {
  display: { action: AssistantProposalAction; params: Record<string, string | number> };
  fingerprint: string;
  risk: AssistantProposalRisk;
  summary: string;
  /** Builds the undo plan from the execution result (ids created). null for non-reversible tools. */
  undoFrom(result: unknown, reader: AssistantStateReader): Promise<AssistantUndoPlan | null>;
}

type UndoCall = AssistantUndoPlan["calls"][number];

interface ActionDraft {
  params: Record<string, string | number>;
  /** The state values prepare used; their canonical JSON is the fingerprint. */
  reads: unknown;
  /** English plain text, before the <>& escape. */
  summary: string;
  /** Reversible actions only: the undo calls for the execution result, or null. */
  undoCalls?: (result: unknown) => UndoCall[] | null;
}

type ActionPrepare = (args: Record<string, unknown>, reader: AssistantStateReader) => Promise<ActionDraft | string>;

// ---------- small helpers ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function listArg(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function notFound(entity: string): string {
  return `${entity} not found`;
}

// Names, titles and comment excerpts are cut to ASSISTANT_DISPLAY_TEXT_MAX
// graphemes by the same function as the thread title (whitespace runs
// collapse, empty text becomes "…").
function displayText(text: string): string {
  return assistantThreadTitle(text);
}

// The same mapping as the tool data escape: & first, then < and >.
function escapeMarkup(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// JSON with object keys sorted at every level; undefined members are
// dropped as JSON.stringify drops them.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// crypto.subtle runs on the local Bun server, EdgeR and wrangler alike.
async function fingerprintOf(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The id a creation returned, under the key its handler uses
// ({ project: { id } }, { collection: { id } }, ...).
function createdId(result: unknown, key: string): string | null {
  if (!isRecord(result)) return null;
  const entity = result[key];
  return isRecord(entity) && typeof entity.id === "string" && entity.id ? entity.id : null;
}

function deleteCreated(key: string, tool: string, args: (id: string) => Record<string, unknown>) {
  return (result: unknown): UndoCall[] | null => {
    const id = createdId(result, key);
    return id ? [{ args: args(id), tool }] : null;
  };
}

const CREATED_KEYS: Partial<Record<string, string>> = {
  "pinar.add_pin_comment": "comment",
  "pinar.create_batch": "batch",
  "pinar.create_collection": "collection",
  "pinar.create_pin": "pin",
  "pinar.create_project": "project",
  "pinar.create_session": "session",
};

// ---------- shared reads ----------

async function readPinContext(args: Record<string, unknown>, reader: AssistantStateReader) {
  const sessionId = textArg(args, "sessionId");
  const pinId = textArg(args, "pinId");
  const session = await reader.session(sessionId);
  if (!session) return notFound("session");
  const pin = await reader.pin(sessionId, pinId);
  if (!pin) return notFound("pin");
  return { pin, pinId, session, sessionId };
}

interface MovePlan {
  moves: Array<{ sessionId: string; source: string; title: string }>;
  orders: Record<string, string[] | null>;
  target: { name: string };
}

async function readMove(sessionIds: string[], collectionId: string, reader: AssistantStateReader): Promise<MovePlan | string> {
  const sessions = await Promise.all(sessionIds.map((id) => reader.session(id)));
  const moves: MovePlan["moves"] = [];
  for (const [index, session] of sessions.entries()) {
    if (!session) return notFound("session");
    moves.push({ sessionId: sessionIds[index], source: session.collectionId, title: session.title });
  }
  const target = await reader.collection(collectionId);
  if (!target) return notFound("collection");
  const touched = Array.from(new Set([...moves.map((move) => move.source), collectionId]));
  const orders: Record<string, string[] | null> = {};
  const read = await Promise.all(touched.map((id) => reader.sessionOrder(id)));
  touched.forEach((id, index) => {
    orders[id] = read[index];
  });
  return { moves, orders, target: { name: target.name } };
}

// Moves each moved session back to its previous collection, then restores
// the previous order of every collection the moves touched (sources first,
// then the target). An empty previous order has nothing to restore.
function moveUndoCalls(moved: MovePlan["moves"], collectionId: string, orders: MovePlan["orders"]): UndoCall[] | null {
  if (moved.length === 0) return null;
  const calls: UndoCall[] = moved.map((move) => ({
    args: { collectionId: move.source, sessionId: move.sessionId },
    tool: "pinar.move_session",
  }));
  for (const id of new Set([...moved.map((move) => move.source), collectionId])) {
    const order = orders[id];
    if (order && order.length > 0) calls.push({ args: { collectionId: id, ids: order }, tool: "pinar.reorder_sessions" });
  }
  return calls;
}

function quote(text: string): string {
  return `"${text}"`;
}

// ---------- the 28 actions (contract table 1.3) ----------

const ACTIONS: Record<AssistantProposalAction, ActionPrepare> = {
  async add_pin_comment(args, reader) {
    const context = await readPinContext(args, reader);
    if (typeof context === "string") return context;
    const params = { body: displayText(textArg(args, "body")), pin: context.pin.number, session: displayText(context.session.title) };
    return {
      params,
      reads: { pin: { number: context.pin.number }, session: { title: context.session.title } },
      summary: `Comment on pin #${params.pin} in session ${quote(params.session)}: ${quote(params.body)}`,
      undoCalls: deleteCreated("comment", "pinar.delete_pin_comment", (commentId) => ({
        commentId,
        pinId: context.pinId,
        sessionId: context.sessionId,
      })),
    };
  },
  async conclude_pin(args, reader) {
    const context = await readPinContext(args, reader);
    if (typeof context === "string") return context;
    const params = { pin: context.pin.number, session: displayText(context.session.title) };
    return {
      params,
      reads: { pin: { number: context.pin.number }, session: { title: context.session.title } },
      summary: `Conclude pin #${params.pin} in session ${quote(params.session)}`,
    };
  },
  async create_batch(args) {
    const params = { label: displayText(textArg(args, "label")) };
    return {
      params,
      reads: {},
      summary: `Create batch ${quote(params.label)}`,
      undoCalls: deleteCreated("batch", "pinar.delete_batch", (batchId) => ({ batchId })),
    };
  },
  async create_collection(args, reader) {
    const projectId = textArg(args, "projectId");
    const project = await reader.project(projectId);
    if (!project) return notFound("project");
    let parent: { name: string } | null = null;
    if (typeof args.parentId === "string") {
      const found = await reader.collection(args.parentId);
      if (!found || found.projectId !== projectId) return notFound("collection");
      parent = { name: found.name };
    }
    const params = { name: displayText(textArg(args, "name")), project: displayText(project.name) };
    return {
      params,
      reads: { parent, project: { name: project.name } },
      summary: `Create collection ${quote(params.name)} in project ${quote(params.project)}`,
      undoCalls: deleteCreated("collection", "pinar.delete_collection", (collectionId) => ({ collectionId })),
    };
  },
  async create_pin(args, reader) {
    const sessionId = textArg(args, "sessionId");
    const session = await reader.session(sessionId);
    if (!session) return notFound("session");
    const params = { comment: displayText(textArg(args, "comment")), session: displayText(session.title) };
    return {
      params,
      reads: { session: { title: session.title } },
      summary: `Add a pin to session ${quote(params.session)}: ${quote(params.comment)}`,
      undoCalls: deleteCreated("pin", "pinar.delete_pin", (pinId) => ({ pinId, sessionId })),
    };
  },
  async create_project(args) {
    const params = { name: displayText(textArg(args, "name")) };
    return {
      params,
      reads: {},
      summary: `Create project ${quote(params.name)}`,
      undoCalls: deleteCreated("project", "pinar.delete_project", (projectId) => ({ projectId })),
    };
  },
  async create_session(args, reader) {
    if (typeof args.collectionId === "string" && !(await reader.collection(args.collectionId))) return notFound("collection");
    if (typeof args.batchId === "string" && !(await reader.batch(args.batchId))) return notFound("batch");
    const page = isRecord(args.page) ? args.page : {};
    const params = { title: displayText(textArg(page, "title")) };
    return {
      params,
      reads: {},
      summary: `Create session ${quote(params.title)}`,
      undoCalls: deleteCreated("session", "pinar.delete_session", (sessionId) => ({ sessionId })),
    };
  },
  async delete_batch(args, reader) {
    const batch = await reader.batch(textArg(args, "batchId"));
    if (!batch) return notFound("batch");
    const params = { label: displayText(batch.label) };
    return { params, reads: { batch: { label: batch.label } }, summary: `Delete batch ${quote(params.label)}` };
  },
  async delete_collection(args, reader) {
    const collection = await reader.collection(textArg(args, "collectionId"));
    if (!collection) return notFound("collection");
    const params = { name: displayText(collection.name), sessions: collection.sessionCount };
    return {
      params,
      reads: { collection: { name: collection.name, sessionCount: collection.sessionCount } },
      summary: `Delete collection ${quote(params.name)} (${countOf(params.sessions, "session")} move to the Inbox)`,
    };
  },
  async delete_pin(args, reader) {
    const context = await readPinContext(args, reader);
    if (typeof context === "string") return context;
    const params = { pin: context.pin.number, session: displayText(context.session.title) };
    return {
      params,
      reads: { pin: { number: context.pin.number }, session: { title: context.session.title } },
      summary: `Delete pin #${params.pin} in session ${quote(params.session)}`,
    };
  },
  async delete_pin_comment(args, reader) {
    const context = await readPinContext(args, reader);
    if (typeof context === "string") return context;
    const comment = await reader.comment(context.sessionId, context.pinId, textArg(args, "commentId"));
    if (!comment) return notFound("comment");
    const params = { pin: context.pin.number, session: displayText(context.session.title) };
    return {
      params,
      reads: { comment: { body: comment.body }, pin: { number: context.pin.number }, session: { title: context.session.title } },
      summary: `Delete a comment on pin #${params.pin} in session ${quote(params.session)}`,
    };
  },
  async delete_project(args, reader) {
    const project = await reader.project(textArg(args, "projectId"));
    if (!project) return notFound("project");
    const params = { collections: project.collectionCount, name: displayText(project.name) };
    return {
      params,
      reads: { project: { collectionCount: project.collectionCount, name: project.name } },
      summary: `Delete project ${quote(params.name)} and its ${countOf(params.collections, "collection")} (captures move to the Inbox)`,
    };
  },
  async delete_session(args, reader) {
    const session = await reader.session(textArg(args, "sessionId"));
    if (!session) return notFound("session");
    const params = { pins: session.pinCount, session: displayText(session.title) };
    return {
      params,
      reads: { session: { pinCount: session.pinCount, title: session.title } },
      summary: `Delete session ${quote(params.session)} and its ${countOf(params.pins, "pin")}`,
    };
  },
  async edit_pin_comment(args, reader) {
    const context = await readPinContext(args, reader);
    if (typeof context === "string") return context;
    const commentId = textArg(args, "commentId");
    const comment = await reader.comment(context.sessionId, context.pinId, commentId);
    if (!comment) return notFound("comment");
    const params = { body: displayText(textArg(args, "body")), pin: context.pin.number, session: displayText(context.session.title) };
    return {
      params,
      reads: { comment: { body: comment.body }, pin: { number: context.pin.number }, session: { title: context.session.title } },
      summary: `Edit a comment on pin #${params.pin} in session ${quote(params.session)} to ${quote(params.body)}`,
      undoCalls: () => [{
        args: { body: comment.body, commentId, pinId: context.pinId, sessionId: context.sessionId },
        tool: "pinar.edit_pin_comment",
      }],
    };
  },
  async edit_pin_note(args, reader) {
    const context = await readPinContext(args, reader);
    if (typeof context === "string") return context;
    const params = { comment: displayText(textArg(args, "comment")), pin: context.pin.number, session: displayText(context.session.title) };
    return {
      params,
      reads: { pin: { comment: context.pin.comment, number: context.pin.number }, session: { title: context.session.title } },
      summary: `Edit the note of pin #${params.pin} in session ${quote(params.session)} to ${quote(params.comment)}`,
    };
  },
  async finish_batch(args, reader) {
    const batch = await reader.batch(textArg(args, "batchId"));
    if (!batch) return notFound("batch");
    const params = { label: displayText(batch.label) };
    return {
      params,
      reads: { batch: { finishedAt: batch.finishedAt, label: batch.label } },
      summary: `Finish batch ${quote(params.label)}`,
    };
  },
  async move_session(args, reader) {
    const collectionId = textArg(args, "collectionId");
    const plan = await readMove([textArg(args, "sessionId")], collectionId, reader);
    if (typeof plan === "string") return plan;
    const [move] = plan.moves;
    const params = { collection: displayText(plan.target.name), session: displayText(move.title) };
    return {
      params,
      reads: { orders: plan.orders, sessions: [{ collectionId: move.source, title: move.title }], target: plan.target },
      summary: `Move session ${quote(params.session)} to ${quote(params.collection)}`,
      undoCalls: () => moveUndoCalls(plan.moves, collectionId, plan.orders),
    };
  },
  async move_sessions(args, reader) {
    const collectionId = textArg(args, "collectionId");
    const plan = await readMove(listArg(args, "sessionIds"), collectionId, reader);
    if (typeof plan === "string") return plan;
    const params = { collection: displayText(plan.target.name), count: plan.moves.length };
    return {
      params,
      reads: { orders: plan.orders, sessions: plan.moves.map((move) => ({ collectionId: move.source })), target: plan.target },
      summary: `Move ${countOf(params.count, "session")} to ${quote(params.collection)}`,
      // The batch execution result lists the sessions that did move; only
      // those go back.
      undoCalls: (result) => {
        const movedIds = new Set(isRecord(result) ? listArg(result, "movedSessionIds") : []);
        return moveUndoCalls(plan.moves.filter((move) => movedIds.has(move.sessionId)), collectionId, plan.orders);
      },
    };
  },
  async publish_share(args, reader) {
    return shareDraft(args, reader, "Publish a share link for");
  },
  async reopen_pin(args, reader) {
    const context = await readPinContext(args, reader);
    if (typeof context === "string") return context;
    const params = { pin: context.pin.number, session: displayText(context.session.title) };
    return {
      params,
      reads: { pin: { number: context.pin.number }, session: { title: context.session.title } },
      summary: `Reopen pin #${params.pin} in session ${quote(params.session)}`,
    };
  },
  async reorder_collections(args, reader) {
    const projectId = textArg(args, "projectId");
    const project = await reader.project(projectId);
    if (!project) return notFound("project");
    const placements = await reader.collectionPlacements(projectId);
    if (!placements) return notFound("project");
    const known = new Set(placements.flatMap((placement) => (isRecord(placement) && typeof placement.id === "string" ? [placement.id] : [])));
    const items = Array.isArray(args.items) ? args.items : [];
    if (items.some((item) => !isRecord(item) || typeof item.id !== "string" || !known.has(item.id))) return notFound("collection");
    const params = { count: items.length, project: displayText(project.name) };
    return {
      params,
      reads: { placements, project: { name: project.name } },
      summary: `Reorder ${countOf(params.count, "collection")} in project ${quote(params.project)}`,
      undoCalls: () => (placements.length > 0 ? [{ args: { items: placements, projectId }, tool: "pinar.reorder_collections" }] : null),
    };
  },
  async reorder_projects(args, reader) {
    const order = await reader.projectOrder();
    const known = new Set(order);
    const ids = listArg(args, "ids");
    if (ids.some((id) => !known.has(id))) return notFound("project");
    const params = { count: ids.length };
    return {
      params,
      reads: { order },
      summary: `Reorder ${countOf(params.count, "project")}`,
      undoCalls: () => (order.length > 0 ? [{ args: { ids: order }, tool: "pinar.reorder_projects" }] : null),
    };
  },
  async reorder_sessions(args, reader) {
    const collectionId = textArg(args, "collectionId");
    const collection = await reader.collection(collectionId);
    if (!collection) return notFound("collection");
    const order = await reader.sessionOrder(collectionId);
    if (!order) return notFound("collection");
    const known = new Set(order);
    const ids = listArg(args, "ids");
    if (ids.some((id) => !known.has(id))) return notFound("session");
    const params = { collection: displayText(collection.name), count: ids.length };
    return {
      params,
      reads: { collection: { name: collection.name }, order },
      summary: `Reorder ${countOf(params.count, "session")} in ${quote(params.collection)}`,
      undoCalls: () => (order.length > 0 ? [{ args: { collectionId, ids: order }, tool: "pinar.reorder_sessions" }] : null),
    };
  },
  async rename_batch(args, reader) {
    const batchId = textArg(args, "batchId");
    const batch = await reader.batch(batchId);
    if (!batch) return notFound("batch");
    const params = { from: displayText(batch.label), to: displayText(textArg(args, "label")) };
    return {
      params,
      reads: { batch: { label: batch.label } },
      summary: `Rename batch ${quote(params.from)} to ${quote(params.to)}`,
      undoCalls: () => [{ args: { batchId, label: batch.label }, tool: "pinar.rename_batch" }],
    };
  },
  async rename_collection(args, reader) {
    const collectionId = textArg(args, "collectionId");
    const collection = await reader.collection(collectionId);
    if (!collection) return notFound("collection");
    const params = { from: displayText(collection.name), to: displayText(textArg(args, "name")) };
    return {
      params,
      reads: { collection: { name: collection.name } },
      summary: `Rename collection ${quote(params.from)} to ${quote(params.to)}`,
      undoCalls: () => [{ args: { collectionId, name: collection.name }, tool: "pinar.rename_collection" }],
    };
  },
  async rename_project(args, reader) {
    const projectId = textArg(args, "projectId");
    const project = await reader.project(projectId);
    if (!project) return notFound("project");
    const params = { from: displayText(project.name), to: displayText(textArg(args, "name")) };
    return {
      params,
      reads: { project: { name: project.name } },
      summary: `Rename project ${quote(params.from)} to ${quote(params.to)}`,
      undoCalls: () => [{ args: { name: project.name, projectId }, tool: "pinar.rename_project" }],
    };
  },
  async revoke_share(args, reader) {
    return shareDraft(args, reader, "Revoke the share link for");
  },
  async update_session(args, reader) {
    const session = await reader.session(textArg(args, "sessionId"));
    if (!session) return notFound("session");
    const params = { session: displayText(session.title) };
    return { params, reads: { session: { title: session.title } }, summary: `Update session ${quote(params.session)}` };
  },
};

async function shareDraft(args: Record<string, unknown>, reader: AssistantStateReader, verb: string): Promise<ActionDraft | string> {
  const resourceType = textArg(args, "resourceType");
  // The schema's enum is not enforced by validateArgs; an unknown type is
  // named generically so model text never shapes the entity name.
  const entity = (MCP_RESOURCE_TYPES as string[]).includes(resourceType) ? resourceType : "resource";
  const share = await reader.share(resourceType, textArg(args, "resourceId"));
  if (!share) return notFound(entity);
  const params = { kind: resourceType, resource: displayText(share.name) };
  return {
    params,
    reads: { share: { active: share.active, name: share.name } },
    summary: `${verb} ${entity} ${quote(params.resource)}`,
  };
}

// The action and risk of a proposal tool, or null for anything else: the
// MCP writes the policy includes, plus pinar.move_sessions.
function proposalTool(tool: string): { action: AssistantProposalAction; risk: AssistantProposalRisk } | null {
  if (tool === "pinar.move_sessions") return { action: "move_sessions", risk: "reversible" };
  const policy = Object.hasOwn(ASSISTANT_TOOL_POLICY, tool) ? ASSISTANT_TOOL_POLICY[tool] : undefined;
  if (!policy || policy.kind !== "write" || policy.assistant !== "include" || policy.risk === "none") return null;
  const action = tool.slice("pinar.".length);
  if (!tool.startsWith("pinar.") || !Object.hasOwn(ACTIONS, action)) return null;
  return { action: action as AssistantProposalAction, risk: policy.risk };
}

// ---------- undo state ----------

// The state each undo call would change, read now. Its fingerprint right
// after the execution is the plan's postFingerprint; undo refuses when the
// current one differs. Deletions of created entities read the whole entity,
// so its content counts (collectionCount, sessionCount, pinCount) are part
// of it.
async function undoCallState(call: UndoCall, reader: AssistantStateReader): Promise<unknown> {
  const args = call.args;
  switch (call.tool) {
    case "pinar.delete_batch":
      return reader.batch(textArg(args, "batchId"));
    case "pinar.delete_collection":
      return reader.collection(textArg(args, "collectionId"));
    case "pinar.delete_pin":
      return reader.pin(textArg(args, "sessionId"), textArg(args, "pinId"));
    case "pinar.delete_pin_comment":
      return reader.comment(textArg(args, "sessionId"), textArg(args, "pinId"), textArg(args, "commentId"));
    case "pinar.delete_project":
      return reader.project(textArg(args, "projectId"));
    case "pinar.delete_session":
      return reader.session(textArg(args, "sessionId"));
    case "pinar.edit_pin_comment": {
      const comment = await reader.comment(textArg(args, "sessionId"), textArg(args, "pinId"), textArg(args, "commentId"));
      return comment ? { body: comment.body } : null;
    }
    case "pinar.move_session": {
      const session = await reader.session(textArg(args, "sessionId"));
      return session ? { collectionId: session.collectionId } : null;
    }
    case "pinar.rename_batch": {
      const batch = await reader.batch(textArg(args, "batchId"));
      return batch ? { label: batch.label } : null;
    }
    case "pinar.rename_collection": {
      const collection = await reader.collection(textArg(args, "collectionId"));
      return collection ? { name: collection.name } : null;
    }
    case "pinar.rename_project": {
      const project = await reader.project(textArg(args, "projectId"));
      return project ? { name: project.name } : null;
    }
    case "pinar.reorder_collections":
      return reader.collectionPlacements(textArg(args, "projectId"));
    case "pinar.reorder_projects":
      return reader.projectOrder();
    case "pinar.reorder_sessions":
      return reader.sessionOrder(textArg(args, "collectionId"));
    default:
      throw new Error(`no undo state for ${call.tool}`);
  }
}

async function undoStateFingerprint(calls: UndoCall[], reader: AssistantStateReader): Promise<string> {
  const states = [];
  for (const call of calls) states.push({ state: await undoCallState(call, reader), tool: call.tool });
  return fingerprintOf(states);
}

// ---------- prepare ----------

export async function prepareProposal(input: {
  args: Record<string, unknown>;
  reader: AssistantStateReader;
  tool: string;
}): Promise<{ ok: true; prepared: PreparedProposal } | { ok: false; problems: string[] }> {
  const known = proposalTool(input.tool);
  if (!known) return { ok: false, problems: [`${input.tool} is not a proposal tool`] };
  const draft = await ACTIONS[known.action](input.args, input.reader);
  if (typeof draft === "string") return { ok: false, problems: [draft] };
  const undoCalls = known.risk === "reversible" ? draft.undoCalls : undefined;
  return {
    ok: true,
    prepared: {
      display: { action: known.action, params: draft.params },
      fingerprint: await fingerprintOf(draft.reads),
      risk: known.risk,
      summary: escapeMarkup(draft.summary),
      async undoFrom(result, reader) {
        const calls = undoCalls?.(result) ?? null;
        if (!calls || calls.length === 0) return null;
        return { calls, postFingerprint: await undoStateFingerprint(calls, reader) };
      },
    },
  };
}

// ---------- lazy statuses ----------

function isExecutingStale(record: AssistantProposalRecord, now: Date): boolean {
  return record.status === "executing" && now.getTime() - Date.parse(record.updatedAt) > ASSISTANT_EXECUTING_STALE_MS;
}

function lazyStatus(record: AssistantProposalRecord, now: Date): { errorCode: AssistantProposalErrorCode | null; status: AssistantProposalStatus } {
  if (record.status === "proposed" && Date.parse(record.expiresAt) <= now.getTime()) {
    return { errorCode: record.errorCode, status: "expired" };
  }
  if (isExecutingStale(record, now)) return { errorCode: "proposal_unknown_outcome", status: "failed" };
  return { errorCode: record.errorCode, status: record.status };
}

export function publicProposal(record: AssistantProposalRecord, now: Date): AssistantPublicProposal {
  const { errorCode, status } = lazyStatus(record, now);
  return {
    createdAt: record.createdAt,
    display: { action: record.display.action, params: { ...record.display.params } },
    errorCode,
    executedAt: record.executedAt,
    expiresAt: record.expiresAt,
    id: record.id,
    messageId: record.messageId,
    risk: record.risk,
    status,
    threadId: record.threadId,
    tool: record.tool,
    undoExpiresAt: record.undoExpiresAt,
  };
}

/** One line the model sees after the assistant message, e.g. `[proposal executed: Move session "A" to "B"]`. */
export function proposalHistoryNote(record: AssistantProposalRecord, now: Date): string {
  const { errorCode, status } = lazyStatus(record, now);
  return `[proposal ${status}${errorCode ? ` (${errorCode})` : ""}: ${record.summary}]`;
}

// ---------- confirm / reject / undo ----------

type PendingResult =
  | { kind: "ok"; proposal: AssistantProposalRecord }
  | { kind: "not_found" }
  | { code: "proposal_expired" | "proposal_not_pending" | "proposal_in_progress"; kind: "conflict" };

type UndoResult =
  | { kind: "ok"; proposal: AssistantProposalRecord }
  | { kind: "not_found" }
  | { code: "undo_unavailable" | "undo_stale" | "proposal_in_progress"; kind: "conflict" };

// Moves a claimed proposal on; when the transition does not apply (the
// record changed under the claim), the stored record is the answer.
async function settle(
  store: AssistantStore,
  input: { from: AssistantProposalStatus; id: string; now: Date; patch?: AssistantProposalPatch; to: AssistantProposalStatus },
): Promise<{ kind: "ok"; proposal: AssistantProposalRecord } | { kind: "not_found" }> {
  const proposal = (await store.transitionProposal({
    from: [input.from],
    id: input.id,
    now: input.now.toISOString(),
    patch: input.patch,
    to: input.to,
  })) ?? (await store.getProposal(input.id));
  return proposal ? { kind: "ok", proposal } : { kind: "not_found" };
}

// The batch runs pinar.move_session item by item, in order, and keeps going
// after a failure. Nothing moved is a failure of the whole proposal.
async function executeProposal(record: AssistantProposalRecord, host: AssistantToolHost): Promise<{ raw: unknown; result: unknown }> {
  if (record.tool === "pinar.move_sessions") {
    const collectionId = textArg(record.args, "collectionId");
    const movedSessionIds: string[] = [];
    let failed = 0;
    for (const sessionId of listArg(record.args, "sessionIds")) {
      try {
        await host.callTool("pinar.move_session", { collectionId, sessionId });
        movedSessionIds.push(sessionId);
      } catch {
        failed += 1;
      }
    }
    if (movedSessionIds.length === 0) throw new McpToolError("No session was moved");
    return { raw: { failed, moved: movedSessionIds.length, movedSessionIds }, result: { failed, moved: movedSessionIds.length } };
  }
  const raw = await host.callTool(record.tool, record.args);
  const key = CREATED_KEYS[record.tool];
  // Only ids and counts are kept, never the handler's text.
  return { raw, result: key ? { id: createdId(raw, key) } : { ok: true } };
}

export async function confirmProposal(input: {
  host: AssistantToolHost;
  id: string;
  now: () => Date;
  reader: AssistantStateReader;
  store: AssistantStore;
}): Promise<PendingResult> {
  const { host, id, now, reader, store } = input;
  const claimedAt = now();
  const claimed = await store.transitionProposal({
    from: ["proposed"],
    id,
    now: claimedAt.toISOString(),
    requireBefore: "expiresAt",
    to: "executing",
  });
  if (!claimed) {
    const current = await store.getProposal(id);
    if (!current) return { kind: "not_found" };
    if (current.status === "executed") return { kind: "ok", proposal: current };
    if (current.status === "proposed" || current.status === "expired") {
      // The claim only fails on a `proposed` record through the expiry
      // guard: the lazy status is recorded.
      if (current.status === "proposed") {
        await store.transitionProposal({ from: ["proposed"], id, now: claimedAt.toISOString(), to: "expired" });
      }
      return { code: "proposal_expired", kind: "conflict" };
    }
    if (current.status === "executing" && !isExecutingStale(current, claimedAt)) {
      return { code: "proposal_in_progress", kind: "conflict" };
    }
    return { code: "proposal_not_pending", kind: "conflict" };
  }

  let prepared: Awaited<ReturnType<typeof prepareProposal>>;
  try {
    prepared = await prepareProposal({ args: claimed.args, reader, tool: claimed.tool });
  } catch {
    // Nothing ran: a failed read is a failed proposal.
    return settle(store, { from: "executing", id, now: now(), patch: { errorCode: "proposal_failed" }, to: "failed" });
  }
  if (!prepared.ok || prepared.prepared.fingerprint !== claimed.fingerprint) {
    return settle(store, { from: "executing", id, now: now(), patch: { errorCode: "proposal_stale" }, to: "failed" });
  }

  let execution: { raw: unknown; result: unknown };
  try {
    execution = await executeProposal(claimed, host);
  } catch (error) {
    // A McpToolError is the handler refusing the call; any other error
    // leaves the outcome unknown. No message is kept either way.
    const errorCode: AssistantProposalErrorCode = error instanceof McpToolError ? "proposal_failed" : "proposal_unknown_outcome";
    return settle(store, { from: "executing", id, now: now(), patch: { errorCode }, to: "failed" });
  }

  let undo: AssistantUndoPlan | null = null;
  if (prepared.prepared.risk === "reversible") {
    try {
      undo = await prepared.prepared.undoFrom(execution.raw, reader);
    } catch {
      undo = null;
    }
  }
  const executedAt = now();
  return settle(store, {
    from: "executing",
    id,
    now: executedAt,
    patch: {
      errorCode: null,
      executedAt: executedAt.toISOString(),
      result: execution.result,
      undo,
      undoExpiresAt: undo ? new Date(executedAt.getTime() + ASSISTANT_UNDO_WINDOW_MS).toISOString() : null,
    },
    to: "executed",
  });
}

export async function rejectProposal(input: { id: string; now: () => Date; store: AssistantStore }): Promise<PendingResult> {
  const { id, store } = input;
  const at = input.now().toISOString();
  const rejected = await store.transitionProposal({ from: ["proposed"], id, now: at, requireBefore: "expiresAt", to: "rejected" });
  if (rejected) return { kind: "ok", proposal: rejected };
  const current = await store.getProposal(id);
  if (!current) return { kind: "not_found" };
  if (current.status === "proposed") {
    await store.transitionProposal({ from: ["proposed"], id, now: at, to: "expired" });
  }
  return { code: "proposal_not_pending", kind: "conflict" };
}

function undoAvailable(record: AssistantProposalRecord, now: Date): boolean {
  return (
    record.status === "executed"
    && record.risk === "reversible"
    && record.undo !== null
    && record.undoExpiresAt !== null
    && now.getTime() < Date.parse(record.undoExpiresAt)
  );
}

export async function undoProposal(input: {
  host: AssistantToolHost;
  id: string;
  now: () => Date;
  reader: AssistantStateReader;
  store: AssistantStore;
}): Promise<UndoResult> {
  const { host, id, now, reader, store } = input;
  const at = now();
  const record = await store.getProposal(id);
  if (!record) return { kind: "not_found" };
  if (record.status === "undoing" || (record.status === "executing" && !isExecutingStale(record, at))) {
    return { code: "proposal_in_progress", kind: "conflict" };
  }
  if (!undoAvailable(record, at)) return { code: "undo_unavailable", kind: "conflict" };
  const claimed = await store.transitionProposal({
    from: ["executed"],
    id,
    now: at.toISOString(),
    requireBefore: "undoExpiresAt",
    to: "undoing",
  });
  if (!claimed) {
    const current = await store.getProposal(id);
    if (!current) return { kind: "not_found" };
    return current.status === "undoing" ? { code: "proposal_in_progress", kind: "conflict" } : { code: "undo_unavailable", kind: "conflict" };
  }
  // The plan cannot change while the proposal is `executed`; the claimed
  // record carries the same plan undoAvailable checked.
  const plan = claimed.undo as AssistantUndoPlan;

  let current: string;
  try {
    current = await undoStateFingerprint(plan.calls, reader);
  } catch {
    return settle(store, { from: "undoing", id, now: now(), patch: { errorCode: "undo_failed", undoExpiresAt: null }, to: "executed" });
  }
  if (current !== plan.postFingerprint) {
    const settled = await settle(store, {
      from: "undoing",
      id,
      now: now(),
      patch: { errorCode: "undo_stale", undoExpiresAt: null },
      to: "executed",
    });
    return settled.kind === "ok" ? { code: "undo_stale", kind: "conflict" } : settled;
  }

  try {
    for (const call of plan.calls) await host.callTool(call.tool, call.args);
  } catch {
    return settle(store, { from: "undoing", id, now: now(), patch: { errorCode: "undo_failed", undoExpiresAt: null }, to: "executed" });
  }
  return settle(store, { from: "undoing", id, now: now(), to: "undone" });
}
