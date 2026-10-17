import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { McpToolError } from "../mcp-protocol";
import {
  ASSISTANT_DISPLAY_TEXT_MAX,
  ASSISTANT_EXECUTING_STALE_MS,
  ASSISTANT_PROPOSAL_TTL_MS,
  ASSISTANT_UNDO_WINDOW_MS,
  confirmProposal,
  newAssistantProposalId,
  prepareProposal,
  proposalHistoryNote,
  publicProposal,
  rejectProposal,
  undoProposal,
  type AssistantProposalRecord,
} from "./proposals";
import {
  FIXTURE_ID_PREFIX,
  INBOX_ID,
  fixtureHost,
  fixtureReader,
  fixtureWorld,
  worldView,
  type FixtureHost,
  type FixtureWorld,
} from "./proposals.test-helpers";
import type { AssistantStateReader } from "./state-reader";
import { ASSISTANT_TITLE_MAX, newAssistantMessageId, newAssistantThreadId, type AssistantStore } from "./store";
import { cloudAssistantStore, resetCloudAssistantMemoryForTests } from "./store-cloud";
import { ASSISTANT_TOOL_POLICY } from "./tool-policy";

const T0 = new Date("2026-10-17T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;
const fx = (suffix: string) => `${FIXTURE_ID_PREFIX}${suffix}`;

interface Context {
  host: FixtureHost;
  reader: AssistantStateReader;
  store: AssistantStore;
  threadId: string;
  world: FixtureWorld;
}

async function setup(): Promise<Context> {
  resetCloudAssistantMemoryForTests();
  const world = fixtureWorld();
  const store = cloudAssistantStore({}, "u1");
  const threadId = newAssistantThreadId();
  await store.createThread({ id: threadId, now: T0.toISOString(), title: "t" });
  return { host: fixtureHost(world), reader: fixtureReader(world), store, threadId, world };
}

// Prepares and stores a `proposed` record the way the turn's sink does.
async function propose(ctx: Context, tool: string, args: Record<string, unknown>, createdAt = T0): Promise<AssistantProposalRecord> {
  const prepared = await prepareProposal({ args, reader: ctx.reader, tool });
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const record: AssistantProposalRecord = {
    args,
    createdAt: createdAt.toISOString(),
    display: prepared.prepared.display,
    errorCode: null,
    executedAt: null,
    expiresAt: new Date(createdAt.getTime() + ASSISTANT_PROPOSAL_TTL_MS).toISOString(),
    fingerprint: prepared.prepared.fingerprint,
    id: newAssistantProposalId(),
    messageId: newAssistantMessageId(),
    result: null,
    risk: prepared.prepared.risk,
    status: "proposed",
    summary: prepared.prepared.summary,
    threadId: ctx.threadId,
    tool,
    undo: null,
    undoExpiresAt: null,
    updatedAt: createdAt.toISOString(),
  };
  await ctx.store.createProposal(record);
  return record;
}

const confirm = (ctx: Context, id: string, when: Date) =>
  confirmProposal({ host: ctx.host, id, now: () => when, reader: ctx.reader, store: ctx.store });
const undo = (ctx: Context, id: string, when: Date) =>
  undoProposal({ host: ctx.host, id, now: () => when, reader: ctx.reader, store: ctx.store });

async function executed(ctx: Context, tool: string, args: Record<string, unknown>): Promise<AssistantProposalRecord> {
  const record = await propose(ctx, tool, args);
  const result = await confirm(ctx, record.id, at(MINUTE));
  assert.equal(result.kind, "ok", JSON.stringify(result));
  assert.ok(result.kind === "ok");
  assert.equal(result.proposal.status, "executed", JSON.stringify(result.proposal));
  return result.proposal;
}

function createdIdOf(record: AssistantProposalRecord): string {
  const id = (record.result as { id?: unknown } | null)?.id;
  assert.equal(typeof id, "string", `the creation must record its id: ${JSON.stringify(record.result)}`);
  return id as string;
}

// ---------- preparation of the 28 actions ----------

interface PrepCase {
  args: Record<string, unknown>;
  params: Record<string, string | number>;
  risk: "reversible" | "irreversible" | "external";
  summary: string;
  tool: string;
}

const PREP_CASES: PrepCase[] = [
  { args: { body: "Please recheck", pinId: fx("pin-1"), sessionId: fx("session-1") }, params: { body: "Please recheck", pin: 1, session: "Cart page" }, risk: "reversible", summary: 'Comment on pin #1 in session "Cart page": "Please recheck"', tool: "pinar.add_pin_comment" },
  { args: { pinId: fx("pin-2"), sessionId: fx("session-1") }, params: { pin: 3, session: "Cart page" }, risk: "irreversible", summary: 'Conclude pin #3 in session "Cart page"', tool: "pinar.conclude_pin" },
  { args: { label: "Release 3" }, params: { label: "Release 3" }, risk: "reversible", summary: 'Create batch "Release 3"', tool: "pinar.create_batch" },
  { args: { name: "Billing", projectId: fx("project-1") }, params: { name: "Billing", project: "Personal" }, risk: "reversible", summary: 'Create collection "Billing" in project "Personal"', tool: "pinar.create_collection" },
  { args: { comment: "Wrong total", sessionId: fx("session-2") }, params: { comment: "Wrong total", session: "Payment form" }, risk: "reversible", summary: 'Add a pin to session "Payment form": "Wrong total"', tool: "pinar.create_pin" },
  { args: { name: "Mobile app" }, params: { name: "Mobile app" }, risk: "reversible", summary: 'Create project "Mobile app"', tool: "pinar.create_project" },
  { args: { collectionId: fx("col-b"), page: { title: "Pricing", url: "https://example.com/pricing" } }, params: { title: "Pricing" }, risk: "reversible", summary: 'Create session "Pricing"', tool: "pinar.create_session" },
  { args: { batchId: fx("batch-2") }, params: { label: "QA pass" }, risk: "irreversible", summary: 'Delete batch "QA pass"', tool: "pinar.delete_batch" },
  { args: { collectionId: fx("col-a") }, params: { name: "Checkout", sessions: 3 }, risk: "irreversible", summary: 'Delete collection "Checkout" (3 sessions move to the Inbox)', tool: "pinar.delete_collection" },
  { args: { pinId: fx("pin-2"), sessionId: fx("session-1") }, params: { pin: 3, session: "Cart page" }, risk: "irreversible", summary: 'Delete pin #3 in session "Cart page"', tool: "pinar.delete_pin" },
  { args: { commentId: fx("comment-2"), pinId: fx("pin-1"), sessionId: fx("session-1") }, params: { pin: 1, session: "Cart page" }, risk: "irreversible", summary: 'Delete a comment on pin #1 in session "Cart page"', tool: "pinar.delete_pin_comment" },
  { args: { projectId: fx("project-2") }, params: { collections: 1, name: "Marketing site" }, risk: "irreversible", summary: 'Delete project "Marketing site" and its 1 collection (captures move to the Inbox)', tool: "pinar.delete_project" },
  { args: { sessionId: fx("session-1") }, params: { pins: 2, session: "Cart page" }, risk: "irreversible", summary: 'Delete session "Cart page" and its 2 pins', tool: "pinar.delete_session" },
  { args: { body: "Looks fine now", commentId: fx("comment-1"), pinId: fx("pin-1"), sessionId: fx("session-1") }, params: { body: "Looks fine now", pin: 1, session: "Cart page" }, risk: "reversible", summary: 'Edit a comment on pin #1 in session "Cart page" to "Looks fine now"', tool: "pinar.edit_pin_comment" },
  { args: { comment: "Button fixed", pinId: fx("pin-1"), sessionId: fx("session-1") }, params: { comment: "Button fixed", pin: 1, session: "Cart page" }, risk: "irreversible", summary: 'Edit the note of pin #1 in session "Cart page" to "Button fixed"', tool: "pinar.edit_pin_note" },
  { args: { batchId: fx("batch-1") }, params: { label: "Sprint 12" }, risk: "irreversible", summary: 'Finish batch "Sprint 12"', tool: "pinar.finish_batch" },
  { args: { collectionId: fx("col-b"), sessionId: fx("session-2") }, params: { collection: "Onboarding", session: "Payment form" }, risk: "reversible", summary: 'Move session "Payment form" to "Onboarding"', tool: "pinar.move_session" },
  { args: { collectionId: fx("col-b"), sessionIds: [fx("session-1"), fx("session-3")] }, params: { collection: "Onboarding", count: 2 }, risk: "reversible", summary: 'Move 2 sessions to "Onboarding"', tool: "pinar.move_sessions" },
  { args: { resourceId: fx("col-a"), resourceType: "collection" }, params: { kind: "collection", resource: "Checkout" }, risk: "external", summary: 'Publish a share link for collection "Checkout"', tool: "pinar.publish_share" },
  { args: { pinId: fx("pin-1"), sessionId: fx("session-1") }, params: { pin: 1, session: "Cart page" }, risk: "irreversible", summary: 'Reopen pin #1 in session "Cart page"', tool: "pinar.reopen_pin" },
  { args: { items: [{ id: fx("col-b"), parentId: null }, { id: fx("col-a"), parentId: null }, { id: INBOX_ID, parentId: null }], projectId: fx("project-1") }, params: { count: 3, project: "Personal" }, risk: "reversible", summary: 'Reorder 3 collections in project "Personal"', tool: "pinar.reorder_collections" },
  { args: { ids: [fx("project-2"), fx("project-1")] }, params: { count: 2 }, risk: "reversible", summary: "Reorder 2 projects", tool: "pinar.reorder_projects" },
  { args: { collectionId: fx("col-a"), ids: [fx("session-3"), fx("session-1"), fx("session-2")] }, params: { collection: "Checkout", count: 3 }, risk: "reversible", summary: 'Reorder 3 sessions in "Checkout"', tool: "pinar.reorder_sessions" },
  { args: { batchId: fx("batch-1"), label: "Sprint 13" }, params: { from: "Sprint 12", to: "Sprint 13" }, risk: "reversible", summary: 'Rename batch "Sprint 12" to "Sprint 13"', tool: "pinar.rename_batch" },
  { args: { collectionId: fx("col-b"), name: "First run" }, params: { from: "Onboarding", to: "First run" }, risk: "reversible", summary: 'Rename collection "Onboarding" to "First run"', tool: "pinar.rename_collection" },
  { args: { name: "Website", projectId: fx("project-2") }, params: { from: "Marketing site", to: "Website" }, risk: "reversible", summary: 'Rename project "Marketing site" to "Website"', tool: "pinar.rename_project" },
  { args: { resourceId: fx("session-1"), resourceType: "session" }, params: { kind: "session", resource: "Cart page" }, risk: "external", summary: 'Revoke the share link for session "Cart page"', tool: "pinar.revoke_share" },
  { args: { page: { title: "Welcome v2" }, sessionId: fx("session-4") }, params: { session: "Welcome" }, risk: "irreversible", summary: 'Update session "Welcome"', tool: "pinar.update_session" },
];

describe("prepareProposal", () => {
  test("the cases cover the 27 included MCP writes plus pinar.move_sessions, once each", () => {
    const writes = Object.entries(ASSISTANT_TOOL_POLICY)
      .filter(([, policy]) => policy.kind === "write" && policy.assistant === "include")
      .map(([name]) => name);
    assert.equal(writes.length, 27);
    assert.deepEqual(PREP_CASES.map((item) => item.tool).sort(), [...writes, "pinar.move_sessions"].sort());
  });

  for (const item of PREP_CASES) {
    test(`${item.tool}: action, params, risk and summary; no id anywhere`, async () => {
      const ctx = await setup();
      const prepared = await prepareProposal({ args: item.args, reader: ctx.reader, tool: item.tool });
      assert.ok(prepared.ok, JSON.stringify(prepared));
      const { display, fingerprint, risk, summary } = prepared.prepared;
      assert.equal(display.action, item.tool.slice("pinar.".length));
      assert.deepEqual(display.params, item.params);
      assert.equal(risk, item.risk);
      assert.equal(summary, item.summary);
      assert.match(fingerprint, /^[0-9a-f]{64}$/);
      assert.ok(!summary.includes(FIXTURE_ID_PREFIX), `summary leaks an id: ${summary}`);
      assert.ok(!JSON.stringify(display).includes(FIXTURE_ID_PREFIX), `params leak an id: ${JSON.stringify(display)}`);
      if (item.risk === "reversible") return;
      assert.equal(await prepared.prepared.undoFrom({ ok: true }, ctx.reader), null, "a non-reversible action has no undo plan");
    });
  }

  test("a <script> name is escaped in the summary and kept raw in the params", async () => {
    const ctx = await setup();
    const raw = '<script>alert("x")</script> & co';
    const prepared = await prepareProposal({ args: { collectionId: fx("col-b"), name: raw }, reader: ctx.reader, tool: "pinar.rename_collection" });
    assert.ok(prepared.ok);
    assert.equal(prepared.prepared.summary, 'Rename collection "Onboarding" to "&lt;script&gt;alert("x")&lt;/script&gt; &amp; co"');
    assert.ok(!prepared.prepared.summary.includes("<"));
    assert.equal(prepared.prepared.display.params.to, raw);
  });

  test("names are cut to 80 graphemes, never inside a grapheme", async () => {
    assert.equal(ASSISTANT_DISPLAY_TEXT_MAX, ASSISTANT_TITLE_MAX);
    const ctx = await setup();
    const long = await prepareProposal({ args: { name: "a".repeat(100) }, reader: ctx.reader, tool: "pinar.create_project" });
    assert.ok(long.ok);
    assert.equal(long.prepared.display.params.name, `${"a".repeat(79)}…`);
    assert.equal(long.prepared.summary, `Create project "${"a".repeat(79)}…"`);
    const family = "👩‍👩‍👧";
    const emoji = await prepareProposal({ args: { name: family.repeat(90) }, reader: ctx.reader, tool: "pinar.create_project" });
    assert.ok(emoji.ok);
    assert.equal(emoji.prepared.display.params.name, `${family.repeat(79)}…`);
    const exact = await prepareProposal({ args: { name: "b".repeat(80) }, reader: ctx.reader, tool: "pinar.create_project" });
    assert.ok(exact.ok);
    assert.equal(exact.prepared.display.params.name, "b".repeat(80), "80 graphemes are kept whole");
  });

  test("the fingerprint is the sha256 hex of the canonical JSON of the reads", async () => {
    const ctx = await setup();
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    const create = await prepareProposal({ args: { name: "X" }, reader: ctx.reader, tool: "pinar.create_project" });
    assert.ok(create.ok);
    assert.equal(create.prepared.fingerprint, sha("{}"));
    const rename = await prepareProposal({ args: { name: "Website", projectId: fx("project-2") }, reader: ctx.reader, tool: "pinar.rename_project" });
    assert.ok(rename.ok);
    assert.equal(rename.prepared.fingerprint, sha('{"project":{"name":"Marketing site"}}'));
    const pin = await prepareProposal({ args: { pinId: fx("pin-2"), sessionId: fx("session-1") }, reader: ctx.reader, tool: "pinar.delete_pin" });
    assert.ok(pin.ok);
    // Keys sorted at every level: pin before session, whatever the order the code builds them in.
    assert.equal(pin.prepared.fingerprint, sha('{"pin":{"number":3},"session":{"title":"Cart page"}}'));
  });

  test("the fingerprint is stable across prepares and changes with the state it read", async () => {
    const ctx = await setup();
    const args = { collectionId: fx("col-b"), sessionId: fx("session-2") };
    const first = await prepareProposal({ args, reader: ctx.reader, tool: "pinar.move_session" });
    const second = await prepareProposal({ args, reader: ctx.reader, tool: "pinar.move_session" });
    assert.ok(first.ok && second.ok);
    assert.equal(first.prepared.fingerprint, second.prepared.fingerprint);
    ctx.world.sessions.push({ batchId: null, collectionId: fx("col-b"), id: fx("session-9"), title: "Late arrival" });
    const third = await prepareProposal({ args, reader: ctx.reader, tool: "pinar.move_session" });
    assert.ok(third.ok);
    assert.notEqual(third.prepared.fingerprint, first.prepared.fingerprint);
  });

  const missing: Array<{ args: Record<string, unknown>; problem: string; tool: string }> = [
    { args: { collectionId: fx("col-b"), sessionId: fx("missing") }, problem: "session not found", tool: "pinar.move_session" },
    { args: { collectionId: fx("missing"), sessionId: fx("session-2") }, problem: "collection not found", tool: "pinar.move_session" },
    { args: { collectionId: fx("col-b"), sessionIds: [fx("session-1"), fx("missing")] }, problem: "session not found", tool: "pinar.move_sessions" },
    { args: { body: "x", pinId: fx("missing"), sessionId: fx("session-1") }, problem: "pin not found", tool: "pinar.add_pin_comment" },
    { args: { body: "x", commentId: fx("missing"), pinId: fx("pin-1"), sessionId: fx("session-1") }, problem: "comment not found", tool: "pinar.edit_pin_comment" },
    { args: { name: "x", projectId: fx("missing") }, problem: "project not found", tool: "pinar.rename_project" },
    { args: { batchId: fx("missing"), label: "x" }, problem: "batch not found", tool: "pinar.rename_batch" },
    { args: { resourceId: fx("missing"), resourceType: "collection" }, problem: "collection not found", tool: "pinar.publish_share" },
    { args: { ids: [fx("project-1"), fx("missing")] }, problem: "project not found", tool: "pinar.reorder_projects" },
    { args: { collectionId: fx("col-a"), ids: [fx("session-1"), fx("missing")] }, problem: "session not found", tool: "pinar.reorder_sessions" },
    { args: { name: "x", parentId: fx("col-c"), projectId: fx("project-1") }, problem: "collection not found", tool: "pinar.create_collection" },
    { args: { collectionId: fx("missing"), page: { title: "x", url: "https://x" } }, problem: "collection not found", tool: "pinar.create_session" },
  ];
  for (const item of missing) {
    test(`${item.tool} with a missing entity: ok false with "${item.problem}"`, async () => {
      const ctx = await setup();
      assert.deepEqual(await prepareProposal({ args: item.args, reader: ctx.reader, tool: item.tool }), { ok: false, problems: [item.problem] });
    });
  }

  test("a read or unknown tool is not a proposal tool", async () => {
    const ctx = await setup();
    for (const tool of ["pinar.list_sessions", "pinar.key_scope", "pinar.ask", "pinar.nope", "constructor"]) {
      const prepared = await prepareProposal({ args: {}, reader: ctx.reader, tool });
      assert.equal(prepared.ok, false, tool);
    }
  });
});

// ---------- confirm ----------

describe("confirmProposal", () => {
  test("a valid proposal executes once with result and undo filled", async () => {
    const ctx = await setup();
    const record = await propose(ctx, "pinar.move_session", { collectionId: fx("col-b"), sessionId: fx("session-2") });
    const result = await confirm(ctx, record.id, at(MINUTE));
    assert.ok(result.kind === "ok");
    const proposal = result.proposal;
    assert.equal(proposal.status, "executed");
    assert.equal(proposal.errorCode, null);
    assert.equal(proposal.executedAt, at(MINUTE).toISOString());
    assert.deepEqual(proposal.result, { ok: true });
    assert.ok(proposal.undo && proposal.undo.calls.length > 0);
    assert.match(proposal.undo.postFingerprint, /^[0-9a-f]{64}$/);
    assert.equal(proposal.undoExpiresAt, at(MINUTE + ASSISTANT_UNDO_WINDOW_MS).toISOString());
    assert.deepEqual(ctx.host.calls, [{ args: { collectionId: fx("col-b"), sessionId: fx("session-2") }, name: "pinar.move_session" }]);
    assert.deepEqual(await ctx.store.getProposal(record.id), proposal, "the stored record is the returned one");
  });

  test("a creation keeps only the created id as its result", async () => {
    const ctx = await setup();
    const proposal = await executed(ctx, "pinar.create_project", { name: "Mobile app" });
    assert.deepEqual(proposal.result, { id: createdIdOf(proposal) });
    assert.deepEqual(proposal.undo?.calls, [{ args: { projectId: createdIdOf(proposal) }, tool: "pinar.delete_project" }]);
  });

  test("confirming again returns the stored record and never calls the host again", async () => {
    const ctx = await setup();
    const record = await propose(ctx, "pinar.rename_batch", { batchId: fx("batch-1"), label: "Sprint 13" });
    const first = await confirm(ctx, record.id, at(MINUTE));
    assert.ok(first.kind === "ok");
    assert.equal(ctx.host.calls.length, 1);
    const again = await confirm(ctx, record.id, at(2 * MINUTE));
    assert.deepEqual(again, first);
    assert.equal(ctx.host.calls.length, 1, "re-confirming must not re-execute");
  });

  test("an expired proposal is proposal_expired, recorded as expired, and never executes", async () => {
    const ctx = await setup();
    const record = await propose(ctx, "pinar.rename_batch", { batchId: fx("batch-1"), label: "Sprint 13" });
    assert.deepEqual(await confirm(ctx, record.id, at(ASSISTANT_PROPOSAL_TTL_MS)), { code: "proposal_expired", kind: "conflict" });
    assert.equal((await ctx.store.getProposal(record.id))?.status, "expired");
    assert.deepEqual(await confirm(ctx, record.id, at(ASSISTANT_PROPOSAL_TTL_MS + 1)), { code: "proposal_expired", kind: "conflict" });
    assert.equal(ctx.host.calls.length, 0);
    // Control: one millisecond before the expiry it executes.
    const fresh = await propose(ctx, "pinar.rename_batch", { batchId: fx("batch-1"), label: "Sprint 14" });
    const ok = await confirm(ctx, fresh.id, at(ASSISTANT_PROPOSAL_TTL_MS - 1));
    assert.ok(ok.kind === "ok" && ok.proposal.status === "executed");
  });

  test("state changed between propose and confirm: failed with proposal_stale, host never called", async () => {
    const ctx = await setup();
    const record = await propose(ctx, "pinar.move_session", { collectionId: fx("col-b"), sessionId: fx("session-2") });
    ctx.world.collections.find((item) => item.id === fx("col-b"))!.name = "Renamed meanwhile";
    const result = await confirm(ctx, record.id, at(MINUTE));
    assert.ok(result.kind === "ok");
    assert.equal(result.proposal.status, "failed");
    assert.equal(result.proposal.errorCode, "proposal_stale");
    assert.equal(result.proposal.undo, null);
    assert.equal(ctx.host.calls.length, 0, "a stale proposal must never reach the host");
  });

  test("an entity gone between propose and confirm is proposal_stale too", async () => {
    const ctx = await setup();
    const record = await propose(ctx, "pinar.delete_session", { sessionId: fx("session-4") });
    ctx.world.sessions = ctx.world.sessions.filter((item) => item.id !== fx("session-4"));
    const result = await confirm(ctx, record.id, at(MINUTE));
    assert.ok(result.kind === "ok");
    assert.equal(result.proposal.errorCode, "proposal_stale");
    assert.equal(ctx.host.calls.length, 0);
  });

  test("a McpToolError fails with proposal_failed and keeps no message", async () => {
    const ctx = await setup();
    ctx.host.failOn = () => new McpToolError("Collection not found: internal detail");
    const record = await propose(ctx, "pinar.move_session", { collectionId: fx("col-b"), sessionId: fx("session-2") });
    const result = await confirm(ctx, record.id, at(MINUTE));
    assert.ok(result.kind === "ok");
    assert.equal(result.proposal.status, "failed");
    assert.equal(result.proposal.errorCode, "proposal_failed");
    assert.equal(result.proposal.result, null);
    assert.ok(!JSON.stringify(result.proposal).includes("internal detail"));
  });

  test("any other host error fails with proposal_unknown_outcome", async () => {
    const ctx = await setup();
    ctx.host.failOn = () => new Error("D1 dropped the connection");
    const record = await propose(ctx, "pinar.rename_batch", { batchId: fx("batch-1"), label: "Sprint 13" });
    const result = await confirm(ctx, record.id, at(MINUTE));
    assert.ok(result.kind === "ok");
    assert.equal(result.proposal.status, "failed");
    assert.equal(result.proposal.errorCode, "proposal_unknown_outcome");
    assert.ok(!JSON.stringify(result.proposal).includes("D1"));
  });

  test("a second confirm inside the execution window is proposal_in_progress; the host runs once", async () => {
    const ctx = await setup();
    const record = await propose(ctx, "pinar.rename_batch", { batchId: fx("batch-1"), label: "Sprint 13" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const callTool = ctx.host.callTool;
    ctx.host.callTool = async (name, args) => {
      entered();
      await gate;
      return callTool(name, args);
    };
    const first = confirm(ctx, record.id, at(MINUTE));
    await inside; // the first confirm holds the claim and is inside the host call
    assert.deepEqual(await confirm(ctx, record.id, at(MINUTE)), { code: "proposal_in_progress", kind: "conflict" });
    release();
    const done = await first;
    assert.ok(done.kind === "ok" && done.proposal.status === "executed");
    assert.equal(ctx.host.calls.length, 1);
  });

  test("two confirms started together call the host once", async () => {
    const ctx = await setup();
    const record = await propose(ctx, "pinar.rename_batch", { batchId: fx("batch-1"), label: "Sprint 13" });
    const results = await Promise.all([confirm(ctx, record.id, at(MINUTE)), confirm(ctx, record.id, at(MINUTE))]);
    assert.equal(ctx.host.calls.length, 1);
    const kinds = results.map((item) => (item.kind === "conflict" ? item.code : item.proposal.status)).sort();
    assert.ok(
      JSON.stringify(kinds) === JSON.stringify(["executed", "proposal_in_progress"]) || JSON.stringify(kinds) === JSON.stringify(["executed", "executed"]),
      JSON.stringify(kinds),
    );
  });

  test("an old executing proposal reads as failed / proposal_unknown_outcome and never re-executes", async () => {
    const ctx = await setup();
    const record = await propose(ctx, "pinar.rename_batch", { batchId: fx("batch-1"), label: "Sprint 13" });
    // A crash right after the claim: the record stays `executing`.
    const claimed = await ctx.store.transitionProposal({ from: ["proposed"], id: record.id, now: at(MINUTE).toISOString(), requireBefore: "expiresAt", to: "executing" });
    assert.ok(claimed);
    const fresh = publicProposal(claimed, at(MINUTE + ASSISTANT_EXECUTING_STALE_MS));
    assert.equal(fresh.status, "executing");
    assert.equal(fresh.errorCode, null);
    const stale = publicProposal(claimed, at(MINUTE + ASSISTANT_EXECUTING_STALE_MS + 1));
    assert.equal(stale.status, "failed");
    assert.equal(stale.errorCode, "proposal_unknown_outcome");
    assert.equal(proposalHistoryNote(claimed, at(MINUTE + ASSISTANT_EXECUTING_STALE_MS + 1)), '[proposal failed (proposal_unknown_outcome): Rename batch "Sprint 12" to "Sprint 13"]');
    assert.deepEqual(await confirm(ctx, record.id, at(5 * MINUTE)), { code: "proposal_not_pending", kind: "conflict" });
    assert.deepEqual(await confirm(ctx, record.id, at(MINUTE + 1)), { code: "proposal_in_progress", kind: "conflict" });
    assert.equal(ctx.host.calls.length, 0);
  });

  test("an unknown id is not_found", async () => {
    const ctx = await setup();
    assert.deepEqual(await confirm(ctx, newAssistantProposalId(), at(MINUTE)), { kind: "not_found" });
  });

  test("a rejected proposal is proposal_not_pending", async () => {
    const ctx = await setup();
    const record = await propose(ctx, "pinar.rename_batch", { batchId: fx("batch-1"), label: "Sprint 13" });
    await rejectProposal({ id: record.id, now: () => at(MINUTE), store: ctx.store });
    assert.deepEqual(await confirm(ctx, record.id, at(MINUTE)), { code: "proposal_not_pending", kind: "conflict" });
    assert.equal(ctx.host.calls.length, 0);
  });
});

// ---------- reject, public view and history note ----------

describe("rejectProposal, publicProposal and proposalHistoryNote", () => {
  test("reject moves proposed to rejected once; an expired one is not pending", async () => {
    const ctx = await setup();
    const record = await propose(ctx, "pinar.create_batch", { label: "Release 3" });
    const rejected = await rejectProposal({ id: record.id, now: () => at(MINUTE), store: ctx.store });
    assert.ok(rejected.kind === "ok");
    assert.equal(rejected.proposal.status, "rejected");
    assert.deepEqual(await rejectProposal({ id: record.id, now: () => at(MINUTE), store: ctx.store }), { code: "proposal_not_pending", kind: "conflict" });
    const late = await propose(ctx, "pinar.create_batch", { label: "Release 4" });
    assert.deepEqual(await rejectProposal({ id: late.id, now: () => at(ASSISTANT_PROPOSAL_TTL_MS), store: ctx.store }), { code: "proposal_not_pending", kind: "conflict" });
    assert.equal((await ctx.store.getProposal(late.id))?.status, "expired");
    assert.deepEqual(await rejectProposal({ id: newAssistantProposalId(), now: () => at(MINUTE), store: ctx.store }), { kind: "not_found" });
    assert.equal(ctx.host.calls.length, 0);
  });

  test("publicProposal never carries args, fingerprint, undo or result, and reads a past-due proposal as expired", async () => {
    const ctx = await setup();
    const proposal = await executed(ctx, "pinar.create_project", { name: "Mobile app" });
    const view = publicProposal(proposal, at(2 * MINUTE));
    assert.deepEqual(Object.keys(view).sort(), [
      "createdAt", "display", "errorCode", "executedAt", "expiresAt", "id", "messageId", "risk", "status", "threadId", "tool", "undoExpiresAt",
    ]);
    assert.ok(!JSON.stringify(view).includes(createdIdOf(proposal)), "the created id stays server-side");
    const pending = await propose(ctx, "pinar.create_batch", { label: "Release 3" });
    assert.equal(publicProposal(pending, at(ASSISTANT_PROPOSAL_TTL_MS - 1)).status, "proposed");
    assert.equal(publicProposal(pending, at(ASSISTANT_PROPOSAL_TTL_MS)).status, "expired");
  });

  test("proposalHistoryNote is one line with the status and the summary", async () => {
    const ctx = await setup();
    const proposal = await executed(ctx, "pinar.move_session", { collectionId: fx("col-b"), sessionId: fx("session-2") });
    assert.equal(proposalHistoryNote(proposal, at(2 * MINUTE)), '[proposal executed: Move session "Payment form" to "Onboarding"]');
    const pending = await propose(ctx, "pinar.create_batch", { label: "<b>" });
    assert.equal(proposalHistoryNote(pending, at(MINUTE)), '[proposal proposed: Create batch "&lt;b&gt;"]');
    assert.equal(proposalHistoryNote(pending, at(ASSISTANT_PROPOSAL_TTL_MS)), '[proposal expired: Create batch "&lt;b&gt;"]');
  });
});

// ---------- undo ----------

interface UndoCase {
  args: Record<string, unknown>;
  /** A change after the execution that the undo must detect. */
  disturb: (world: FixtureWorld, proposal: AssistantProposalRecord) => void;
  tool: string;
}

const rename = <T extends { id: string }>(list: T[], id: string, apply: (item: T) => void) => apply(list.find((item) => item.id === id)!);

const UNDO_CASES: UndoCase[] = [
  { args: { body: "Please recheck", pinId: fx("pin-1"), sessionId: fx("session-1") }, disturb: (world, p) => rename(world.comments, createdIdOf(p), (item) => (item.body = "edited")), tool: "pinar.add_pin_comment" },
  { args: { label: "Release 3" }, disturb: (world, p) => rename(world.batches, createdIdOf(p), (item) => (item.label = "edited")), tool: "pinar.create_batch" },
  { args: { name: "Billing", projectId: fx("project-1") }, disturb: (world, p) => rename(world.collections, createdIdOf(p), (item) => (item.name = "edited")), tool: "pinar.create_collection" },
  { args: { comment: "Wrong total", sessionId: fx("session-2") }, disturb: (world, p) => rename(world.pins, createdIdOf(p), (item) => (item.comment = "edited")), tool: "pinar.create_pin" },
  { args: { name: "Mobile app" }, disturb: (world, p) => rename(world.projects, createdIdOf(p), (item) => (item.name = "edited")), tool: "pinar.create_project" },
  { args: { collectionId: fx("col-b"), page: { title: "Pricing", url: "https://example.com/pricing" } }, disturb: (world, p) => rename(world.sessions, createdIdOf(p), (item) => (item.title = "edited")), tool: "pinar.create_session" },
  { args: { body: "Looks fine now", commentId: fx("comment-1"), pinId: fx("pin-1"), sessionId: fx("session-1") }, disturb: (world) => rename(world.comments, fx("comment-1"), (item) => (item.body = "edited")), tool: "pinar.edit_pin_comment" },
  { args: { collectionId: fx("col-b"), sessionId: fx("session-2") }, disturb: (world) => world.sessions.push({ batchId: null, collectionId: fx("col-b"), id: fx("session-9"), title: "Late" }), tool: "pinar.move_session" },
  { args: { collectionId: fx("col-b"), sessionIds: [fx("session-1"), fx("session-3")] }, disturb: (world) => world.sessions.push({ batchId: null, collectionId: fx("col-a"), id: fx("session-9"), title: "Late" }), tool: "pinar.move_sessions" },
  { args: { items: [{ id: fx("col-b"), parentId: null }, { id: fx("col-a"), parentId: null }, { id: INBOX_ID, parentId: null }], projectId: fx("project-1") }, disturb: (world) => world.collections.push({ id: fx("col-9"), name: "Late", parentId: null, projectId: fx("project-1") }), tool: "pinar.reorder_collections" },
  { args: { ids: [fx("project-2"), fx("project-1")] }, disturb: (world) => world.projects.push({ id: fx("project-9"), name: "Late" }), tool: "pinar.reorder_projects" },
  { args: { collectionId: fx("col-a"), ids: [fx("session-3"), fx("session-1"), fx("session-2")] }, disturb: (world) => world.sessions.push({ batchId: null, collectionId: fx("col-a"), id: fx("session-9"), title: "Late" }), tool: "pinar.reorder_sessions" },
  { args: { batchId: fx("batch-1"), label: "Sprint 13" }, disturb: (world) => rename(world.batches, fx("batch-1"), (item) => (item.label = "edited")), tool: "pinar.rename_batch" },
  { args: { collectionId: fx("col-b"), name: "First run" }, disturb: (world) => rename(world.collections, fx("col-b"), (item) => (item.name = "edited")), tool: "pinar.rename_collection" },
  { args: { name: "Website", projectId: fx("project-2") }, disturb: (world) => rename(world.projects, fx("project-2"), (item) => (item.name = "edited")), tool: "pinar.rename_project" },
];

describe("undoProposal", () => {
  test("the undo cases cover every reversible action", () => {
    const reversible = PREP_CASES.filter((item) => item.risk === "reversible").map((item) => item.tool).sort();
    assert.equal(reversible.length, 15);
    assert.deepEqual(UNDO_CASES.map((item) => item.tool).sort(), reversible);
  });

  for (const item of UNDO_CASES) {
    test(`${item.tool}: execute then undo restores the previous state`, async () => {
      const ctx = await setup();
      const before = worldView(ctx.world);
      const proposal = await executed(ctx, item.tool, item.args);
      assert.notDeepEqual(worldView(ctx.world), before, "the execution must change the world");
      const result = await undo(ctx, proposal.id, at(2 * MINUTE));
      assert.ok(result.kind === "ok", JSON.stringify(result));
      assert.equal(result.proposal.status, "undone");
      assert.deepEqual(worldView(ctx.world), before);
    });

    test(`${item.tool}: a change after the execution is undo_stale and the host is not called`, async () => {
      const ctx = await setup();
      const proposal = await executed(ctx, item.tool, item.args);
      item.disturb(ctx.world, proposal);
      const calls = ctx.host.calls.length;
      assert.deepEqual(await undo(ctx, proposal.id, at(2 * MINUTE)), { code: "undo_stale", kind: "conflict" });
      assert.equal(ctx.host.calls.length, calls, "a stale undo must never reach the host");
      const stored = await ctx.store.getProposal(proposal.id);
      assert.equal(stored?.status, "executed");
      assert.equal(stored?.errorCode, "undo_stale");
      assert.equal(stored?.undoExpiresAt, null);
      assert.deepEqual(await undo(ctx, proposal.id, at(2 * MINUTE)), { code: "undo_unavailable", kind: "conflict" });
    });
  }

  const contentCases: Array<{ add: (world: FixtureWorld, id: string) => void; args: Record<string, unknown>; tool: string }> = [
    { add: (world, id) => world.collections.push({ id: fx("col-9"), name: "Inside", parentId: null, projectId: id }), args: { name: "Mobile app" }, tool: "pinar.create_project" },
    { add: (world, id) => world.sessions.push({ batchId: null, collectionId: id, id: fx("session-9"), title: "Inside" }), args: { name: "Billing", projectId: fx("project-1") }, tool: "pinar.create_collection" },
    { add: (world, id) => world.pins.push({ comment: "Inside", id: fx("pin-9"), number: 1, sessionId: id }), args: { page: { title: "Pricing", url: "https://x" } }, tool: "pinar.create_session" },
    // Review P1: deleting the created pin would delete this conversation comment.
    { add: (world, id) => world.comments.push({ body: "Someone else's reply", id: fx("comment-9"), pinId: id, sessionId: fx("session-2") }), args: { comment: "Wrong total", sessionId: fx("session-2") }, tool: "pinar.create_pin" },
    // Review P2: deleting the created batch would unlink this session.
    { add: (world, id) => (world.sessions.find((item) => item.id === fx("session-4"))!.batchId = id), args: { label: "Release 3" }, tool: "pinar.create_batch" },
  ];
  for (const item of contentCases) {
    test(`${item.tool}: a creation that gained content is undo_stale and is not deleted`, async () => {
      const ctx = await setup();
      const proposal = await executed(ctx, item.tool, item.args);
      const id = createdIdOf(proposal);
      item.add(ctx.world, id);
      const calls = ctx.host.calls.length;
      assert.deepEqual(await undo(ctx, proposal.id, at(2 * MINUTE)), { code: "undo_stale", kind: "conflict" });
      assert.equal(ctx.host.calls.length, calls);
      assert.ok(JSON.stringify(worldView(ctx.world)).includes(id), "the created entity must survive");
      const content = JSON.stringify(worldView(ctx.world));
      if (item.tool === "pinar.create_pin") assert.ok(content.includes("Someone else's reply"), "the comment must survive");
      if (item.tool === "pinar.create_batch") assert.equal(ctx.world.sessions.find((session) => session.id === fx("session-4"))?.batchId, id, "the session stays linked");
    });
  }

  test("an orphaned undoing (older than the stale limit) reads as executed / undo_failed with no undo offered", async () => {
    const ctx = await setup();
    const proposal = await executed(ctx, "pinar.rename_batch", { batchId: fx("batch-1"), label: "Sprint 13" });
    // A crash right after claiming the undo: the record stays `undoing`.
    const claimedAt = at(2 * MINUTE);
    const undoing = await ctx.store.transitionProposal({ from: ["executed"], id: proposal.id, now: claimedAt.toISOString(), requireBefore: "undoExpiresAt", to: "undoing" });
    assert.ok(undoing && undoing.undoExpiresAt !== null);
    const fresh = publicProposal(undoing, new Date(claimedAt.getTime() + ASSISTANT_EXECUTING_STALE_MS));
    assert.equal(fresh.status, "undoing");
    assert.equal(fresh.undoExpiresAt, undoing.undoExpiresAt);
    const staleAt = new Date(claimedAt.getTime() + ASSISTANT_EXECUTING_STALE_MS + 1);
    const stale = publicProposal(undoing, staleAt);
    assert.equal(stale.status, "executed");
    assert.equal(stale.errorCode, "undo_failed");
    assert.equal(stale.undoExpiresAt, null, "no undo is offered again");
    assert.equal(proposalHistoryNote(undoing, staleAt), '[proposal executed (undo_failed): Rename batch "Sprint 12" to "Sprint 13"]');
    const calls = ctx.host.calls.length;
    assert.deepEqual(await undo(ctx, proposal.id, new Date(claimedAt.getTime() + MINUTE)), { code: "proposal_in_progress", kind: "conflict" });
    assert.deepEqual(await undo(ctx, proposal.id, staleAt), { code: "undo_unavailable", kind: "conflict" });
    assert.equal(ctx.host.calls.length, calls, "an orphaned undo never runs again");
  });

  for (const item of PREP_CASES.filter((entry) => entry.risk !== "reversible")) {
    test(`${item.tool} (${item.risk}): executed without an undo plan, undo is undo_unavailable`, async () => {
      const ctx = await setup();
      const proposal = await executed(ctx, item.tool, item.args);
      assert.equal(proposal.undo, null);
      assert.equal(proposal.undoExpiresAt, null);
      const calls = ctx.host.calls.length;
      assert.deepEqual(await undo(ctx, proposal.id, at(2 * MINUTE)), { code: "undo_unavailable", kind: "conflict" });
      assert.equal(ctx.host.calls.length, calls);
    });
  }

  test("outside the window the undo is undo_unavailable; just inside it runs", async () => {
    const ctx = await setup();
    const proposal = await executed(ctx, "pinar.rename_batch", { batchId: fx("batch-1"), label: "Sprint 13" });
    const calls = ctx.host.calls.length;
    assert.deepEqual(await undo(ctx, proposal.id, at(MINUTE + ASSISTANT_UNDO_WINDOW_MS)), { code: "undo_unavailable", kind: "conflict" });
    assert.equal(ctx.host.calls.length, calls);
    const inside = await undo(ctx, proposal.id, at(MINUTE + ASSISTANT_UNDO_WINDOW_MS - 1));
    assert.ok(inside.kind === "ok" && inside.proposal.status === "undone");
  });

  test("a failing undo call leaves executed with undo_failed", async () => {
    const ctx = await setup();
    const proposal = await executed(ctx, "pinar.rename_batch", { batchId: fx("batch-1"), label: "Sprint 13" });
    ctx.host.failOn = () => new McpToolError("Batch not found");
    const result = await undo(ctx, proposal.id, at(2 * MINUTE));
    assert.ok(result.kind === "ok");
    assert.equal(result.proposal.status, "executed");
    assert.equal(result.proposal.errorCode, "undo_failed");
    assert.equal(result.proposal.undoExpiresAt, null);
  });

  test("undo of a proposal still pending, in progress, undone or missing", async () => {
    const ctx = await setup();
    const pending = await propose(ctx, "pinar.rename_batch", { batchId: fx("batch-1"), label: "Sprint 13" });
    assert.deepEqual(await undo(ctx, pending.id, at(MINUTE)), { code: "undo_unavailable", kind: "conflict" });
    await ctx.store.transitionProposal({ from: ["proposed"], id: pending.id, now: at(MINUTE).toISOString(), to: "executing" });
    assert.deepEqual(await undo(ctx, pending.id, at(MINUTE)), { code: "proposal_in_progress", kind: "conflict" });
    const done = await executed(ctx, "pinar.rename_project", { name: "Website", projectId: fx("project-2") });
    assert.ok((await undo(ctx, done.id, at(2 * MINUTE))).kind === "ok");
    assert.deepEqual(await undo(ctx, done.id, at(2 * MINUTE)), { code: "undo_unavailable", kind: "conflict" });
    assert.deepEqual(await undo(ctx, newAssistantProposalId(), at(MINUTE)), { kind: "not_found" });
  });
});

// ---------- the batch ----------

describe("pinar.move_sessions", () => {
  test("3 sessions with 1 failure: executed with { failed: 1, moved: 2 }; undo returns only the 2", async () => {
    const ctx = await setup();
    const before = worldView(ctx.world);
    ctx.host.failOn = (name, args) => (name === "pinar.move_session" && args.sessionId === fx("session-2") ? new McpToolError("Session locked") : null);
    const sessionIds = [fx("session-1"), fx("session-2"), fx("session-3")];
    const record = await propose(ctx, "pinar.move_sessions", { collectionId: fx("col-b"), sessionIds });
    const result = await confirm(ctx, record.id, at(MINUTE));
    assert.ok(result.kind === "ok");
    assert.equal(result.proposal.status, "executed");
    assert.deepEqual(result.proposal.result, { failed: 1, moved: 2 });
    assert.deepEqual(
      ctx.host.calls.map((call) => [call.name, call.args.sessionId]),
      sessionIds.map((id) => ["pinar.move_session", id]),
      "item by item, in order, continuing after the failure",
    );
    const movedBack = result.proposal.undo?.calls.filter((call) => call.tool === "pinar.move_session").map((call) => call.args.sessionId);
    assert.deepEqual(movedBack, [fx("session-1"), fx("session-3")]);
    assert.equal(ctx.world.sessions.find((item) => item.id === fx("session-2"))?.collectionId, fx("col-a"), "the failed session never moved");

    ctx.host.failOn = undefined;
    const calls = ctx.host.calls.length;
    const undone = await undo(ctx, record.id, at(2 * MINUTE));
    assert.ok(undone.kind === "ok" && undone.proposal.status === "undone");
    assert.ok(!ctx.host.calls.slice(calls).some((call) => call.name === "pinar.move_session" && call.args.sessionId === fx("session-2")));
    assert.deepEqual(worldView(ctx.world), before);
  });

  test("nothing moved is a failed proposal with proposal_failed", async () => {
    const ctx = await setup();
    ctx.host.failOn = () => new McpToolError("Session locked");
    const record = await propose(ctx, "pinar.move_sessions", { collectionId: fx("col-b"), sessionIds: [fx("session-1"), fx("session-3")] });
    const result = await confirm(ctx, record.id, at(MINUTE));
    assert.ok(result.kind === "ok");
    assert.equal(result.proposal.status, "failed");
    assert.equal(result.proposal.errorCode, "proposal_failed");
    assert.equal(ctx.host.calls.length, 2);
  });
});
