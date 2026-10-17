import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, test } from "node:test";
import { openHistoryDb } from "./history.mjs";

describe("history", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pinar-history-test-"));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { force: true, recursive: true });
  });

  test("saveSession records and retrieves history sessions", () => {
    const db = openHistoryDb(tempDir);
    const session = db.saveSession({
      id: "test-1",
      page: { description: "Home of the example site.", title: "Test Page", url: "https://example.com" },
      pins: [{ comment: "Fix header", kind: "element", selector: "h1" }],
      shotId: "shot-1",
      shotPath: "/tmp/shot-1.png",
    });

    assert.equal(session.id, "test-1");
    assert.equal(session.page.title, "Test Page");
    assert.equal(session.page.description, "Home of the example site.");
    assert.equal(session.pins.length, 1);
    assert.equal(session.pins[0].comment, "Fix header");
    assert.equal(session.schemaVersion, 1);
    assert.equal(session.captureId, "test-1");
    assert.equal(session.pins[0].pinId, "test-1:p1");
    assert.equal(session.includeScreenshot, true);

    const fetched = db.getSession("test-1");
    assert.deepEqual(fetched, session);

    const list = db.listSessions();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "test-1");
    db.close();
  });

  test("saveSession records includeScreenshot for agent markdown", () => {
    const db = openHistoryDb(tempDir);
    const omitted = db.saveSession({
      id: "no-shot",
      includeScreenshot: false,
      page: { title: "Login" },
      pins: [],
      shotPath: "/tmp/login.png",
    });
    assert.equal(omitted.includeScreenshot, false);
    assert.equal(db.getSession("no-shot")?.includeScreenshot, false);
    db.close();
  });

  test("openHistoryDb migrates history created under the old shots root", () => {
    // Mutation captured: fixing shot paths without moving the legacy database makes history appear empty.
    const legacyDb = openHistoryDb(join(tempDir, "shots"));
    legacyDb.saveSession({
      id: "legacy",
      page: { title: "Legacy session" },
      pins: [],
      shotPath: join(tempDir, "shots", "shots", "legacy.png"),
    });
    legacyDb.close();

    const db = openHistoryDb(tempDir);
    assert.equal(db.getSession("legacy")?.page.title, "Legacy session");
    assert.equal(db.getSession("legacy")?.shotPath, join(tempDir, "shots", "legacy.png"));
    db.close();
  });

  test("listSessions filters by search query on title, url, or pin comment", () => {
    const db = openHistoryDb(tempDir);
    db.saveSession({
      id: "s1",
      page: { title: "Billing Settings", url: "https://app.com/billing" },
      pins: [{ comment: "Change card format" }],
    });
    db.saveSession({
      id: "s2",
      page: { title: "User Profile", url: "https://app.com/profile" },
      pins: [{ comment: "Avatar size is wrong" }],
    });

    const billing = db.listSessions({ query: "billing" });
    assert.equal(billing.length, 1);
    assert.equal(billing[0].id, "s1");

    const avatar = db.listSessions({ query: "avatar" });
    assert.equal(avatar.length, 1);
    assert.equal(avatar[0].id, "s2");

    const none = db.listSessions({ query: "nonexistent" });
    assert.equal(none.length, 0);
    db.close();
  });

  test("deleteSession and clearHistory remove entries", () => {
    const db = openHistoryDb(tempDir);
    db.saveSession({ id: "s1", page: { title: "Page 1" }, pins: [] });
    db.saveSession({ id: "s2", page: { title: "Page 2" }, pins: [] });

    assert.equal(db.listSessions().length, 2);

    const deleted = db.deleteSession("s1");
    assert.equal(deleted, true);
    assert.equal(db.listSessions().length, 1);
    assert.equal(db.getSession("s1"), null);

    db.clearHistory();
    assert.equal(db.listSessions().length, 0);
    db.close();
  });

  test("migrates existing sessions into protected Personal and Inbox containers", () => {
    // Mutation captured: removing the backfill leaves legacy sessions without a collection.
    const legacy = new DatabaseSync(join(tempDir, "history.db"));
    legacy.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        url TEXT,
        title TEXT,
        shot_id TEXT,
        shot_path TEXT,
        pin_count INTEGER,
        pins_json TEXT,
        created_at TEXT
      );
      INSERT INTO sessions VALUES (
        'legacy-session', 'https://example.test', 'Legacy', 'legacy-shot', '/tmp/legacy.png', 0, '[]', '2026-01-01T00:00:00.000Z'
      );
    `);
    legacy.close();

    const db = openHistoryDb(tempDir);
    const tree = db.getProjectTree();

    assert.equal(tree.projects.length, 1);
    assert.equal(tree.projects[0].icon, "user-round");
    assert.equal(tree.projects[0].name, "Personal");
    assert.equal(tree.projects[0].isProtected, true);
    assert.equal(tree.projects[0].collections.length, 1);
    assert.equal(tree.projects[0].collections[0].name, "Inbox");
    assert.equal(tree.projects[0].collections[0].isProtected, true);
    assert.equal(tree.projects[0].collections[0].sessions[0].id, "legacy-session");
    assert.equal(db.getSession("legacy-session").shotId, "legacy-shot");
    db.close();
  });

  test("moves and reorders sessions and preserves them when deleting containers", () => {
    // Mutation captured: deleting a project before moving sessions makes its captures disappear from history.
    const db = openHistoryDb(tempDir);
    const personal = db.listProjects()[0];
    const inbox = db.listCollections(personal.id)[0];
    const project = db.createProject("Website", "telescope");
    assert.equal(project.icon, "telescope");
    assert.equal(db.updateProject(project.id, "Website", "audio-waveform").icon, "audio-waveform");
    const review = db.createCollection(project.id, "Review");
    const ready = db.createCollection(project.id, "Ready");
    db.saveSession({ collectionId: review.id, id: "s1", page: { title: "One" } });
    db.saveSession({ collectionId: review.id, id: "s2", page: { title: "Two" } });

    db.reorderSessions(review.id, ["s2", "s1"]);
    assert.deepEqual(db.listSessions({ collectionId: review.id }).map((session) => session.id), ["s2", "s1"]);
    assert.equal(db.moveSession("s1", ready.id).collectionId, ready.id);

    assert.equal(db.deleteProject(project.id), true);
    assert.equal(db.getSession("s1").collectionId, inbox.id);
    assert.equal(db.getSession("s2").collectionId, inbox.id);
    assert.equal(db.listProjects().some((item) => item.id === project.id), false);
    assert.equal(db.deleteProject(personal.id), false);
    assert.equal(db.deleteCollection(inbox.id), false);
    db.close();
  });

  test("nests collections, rejects cycles, and promotes children when a parent is deleted", () => {
    const db = openHistoryDb(tempDir);
    const project = db.createProject("Website");
    const design = db.createCollection(project.id, "Design");
    const review = db.createCollection(project.id, "Review");
    const approved = db.createCollection(project.id, "Approved");

    assert.ok(db.reorderCollections(project.id, [
      { id: design.id, parentId: null },
      { id: review.id, parentId: design.id },
      { id: approved.id, parentId: review.id },
    ]));
    assert.deepEqual(db.listCollections(project.id).map((collection) => ({
      id: collection.id,
      parentId: collection.parentId,
      position: collection.position,
    })), [
      { id: design.id, parentId: null, position: 0 },
      { id: review.id, parentId: design.id, position: 0 },
      { id: approved.id, parentId: review.id, position: 0 },
    ]);
    assert.equal(db.reorderCollections(project.id, [
      { id: design.id, parentId: approved.id },
      { id: review.id, parentId: design.id },
      { id: approved.id, parentId: review.id },
    ]), null);

    assert.equal(db.deleteCollection(review.id), true);
    assert.equal(db.listCollections(project.id).find((item) => item.id === approved.id).parentId, design.id);
    db.close();
  });

  test("records idempotent agent executions per pin and rejects unknown pins", () => {
    const db = openHistoryDb(tempDir);
    db.saveSession({
      id: "capture_agent_01",
      page: { title: "Agent capture", url: "https://example.test/agent" },
      pins: [{ comment: "Fix CTA", pinId: "pin_cta" }],
    });
    const first = db.saveAgentExecution({
      agent: "grok",
      captureId: "capture_agent_01",
      idempotencyKey: "exec_grok_cta_01",
      results: [{
        files: ["apps/web/cta.tsx"],
        pinId: "pin_cta",
        status: "changed",
        summary: "Updated the CTA",
      }],
    });
    assert.equal(first.created, true);
    assert.equal(first.execution.agent, "grok");
    assert.equal(first.execution.results[0].pinId, "pin_cta");
    const replay = db.saveAgentExecution({
      agent: "grok",
      captureId: "capture_agent_01",
      idempotencyKey: "exec_grok_cta_01",
      results: [{
        files: ["apps/web/cta.tsx"],
        pinId: "pin_cta",
        status: "changed",
        summary: "Updated the CTA",
      }],
    });
    assert.equal(replay.created, false);
    assert.equal(replay.execution.id, first.execution.id);
    assert.equal(db.listAgentExecutions("capture_agent_01").length, 1);
    assert.throws(
      () => db.saveAgentExecution({
        agent: "grok",
        captureId: "capture_agent_01",
        idempotencyKey: "exec_grok_missing",
        results: [{ pinId: "pin_missing", status: "changed", summary: "Nope" }],
      }),
      (error) => error?.code === "pin_not_found",
    );
    assert.equal(db.deleteSession("capture_agent_01"), true);
    assert.deepEqual(db.listAgentExecutions("capture_agent_01"), []);
    db.close();
  });

  test("stores opt-in loop metrics without comments, URLs, selectors or screenshots", () => {
    const db = openHistoryDb(tempDir);
    const stored = db.saveLoopMetrics([{
      agent: "claude",
      durationMs: 800,
      event: "handoff",
    }]);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].event, "handoff");
    assert.equal(stored[0].agent, "claude");
    const serialized = JSON.stringify(db.listLoopMetrics());
    assert.equal(serialized.includes("http"), false);
    assert.equal(serialized.includes("comment"), false);
    assert.throws(
      () => db.saveLoopMetrics([{ comment: "secret", event: "handoff", url: "https://example.test" }]),
      (error) => error?.code === "forbidden_fields",
    );
    assert.equal(db.listLoopMetrics().length, 1);
    db.close();
  });

  test("moves pins through open, correction_ready, accepted and reopened with an append-only timeline", () => {
    const db = openHistoryDb(tempDir);
    const session = db.saveSession({
      id: "capture_review_01",
      page: { title: "Review capture", url: "https://example.test/review" },
      pins: [{ comment: "Fix CTA", pinId: "pin_cta" }],
    });
    assert.deepEqual(session.reviewCounts, {
      accepted: 0,
      correction_ready: 0,
      open: 1,
      reopened: 0,
    });
    const opened = db.listPinReviews("capture_review_01");
    assert.equal(opened.length, 1);
    assert.equal(opened[0].pinId, "pin_cta");
    assert.equal(opened[0].status, "open");
    assert.deepEqual(opened[0].actions, ["accept"]);
    assert.deepEqual(opened[0].timeline, []);

    const first = db.saveAgentExecution({
      agent: "cursor",
      captureId: "capture_review_01",
      idempotencyKey: "exec_review_cta_01",
      results: [{ pinId: "pin_cta", status: "changed", summary: "Updated the CTA" }],
    });
    assert.equal(first.created, true);
    const ready = db.listPinReviews("capture_review_01")[0];
    assert.equal(ready.status, "correction_ready");
    assert.deepEqual(ready.actions, ["accept"]);
    assert.equal(ready.timeline.length, 1);
    assert.equal(ready.timeline[0].fromStatus, "open");
    assert.equal(ready.timeline[0].toStatus, "correction_ready");
    assert.equal(ready.timeline[0].origin, "agent_result");

    db.saveAgentExecution({
      agent: "cursor",
      captureId: "capture_review_01",
      idempotencyKey: "exec_review_cta_01",
      results: [{ pinId: "pin_cta", status: "changed", summary: "Updated the CTA" }],
    });
    assert.equal(db.listPinReviews("capture_review_01")[0].timeline.length, 1);

    const accepted = db.applyPinReview("capture_review_01", "pin_cta", "accept", {
      actorId: "local",
      actorType: "human",
      origin: "human",
    });
    assert.equal(accepted.review.status, "accepted");
    assert.equal(accepted.review.timeline.length, 2);
    assert.throws(
      () => db.applyPinReview("capture_review_01", "pin_cta", "accept", {
        actorId: "local",
        actorType: "human",
        origin: "human",
      }),
      (error) => error?.code === "invalid_transition",
    );
    assert.equal(db.listPinReviews("capture_review_01")[0].timeline.length, 2);

    db.saveAgentExecution({
      agent: "cursor",
      captureId: "capture_review_01",
      idempotencyKey: "exec_review_after_accept",
      results: [{ pinId: "pin_cta", status: "changed", summary: "Must not reopen" }],
    });
    assert.equal(db.listPinReviews("capture_review_01")[0].status, "accepted");

    const reopened = db.applyPinReview("capture_review_01", "pin_cta", "reopen", {
      actorId: "local",
      actorType: "human",
      origin: "human",
    });
    assert.equal(reopened.review.status, "reopened");
    assert.equal(db.getSession("capture_review_01").reviewCounts.reopened, 1);

    assert.equal(db.deleteSession("capture_review_01"), true);
    assert.deepEqual(db.listPinReviews("capture_review_01"), []);
    db.close();
  });

  test("falls back to Personal and Inbox when a saved capture destination is invalid", () => {
    // Mutation captured: trusting an unknown collection id creates an orphan session.
    const db = openHistoryDb(tempDir);
    const destination = db.getDefaultDestination();
    const session = db.saveSession({ collectionId: "missing", id: "fallback" });

    assert.equal(session.collectionId, destination.collectionId);
    assert.equal(db.resolveDestination("missing").projectId, destination.projectId);
    db.close();
  });

  test("sqlite pin comments survive a restart and stay inside their capture", () => {
    const db = openHistoryDb(tempDir);
    db.saveSession({
      id: "capture_comment_a",
      page: { title: "A" },
      pins: [
        { comment: "one", kind: "element", pinId: "pin_one" },
        { comment: "two", kind: "element", pinId: "pin_two" },
      ],
    });
    db.saveSession({
      id: "capture_comment_b",
      page: { title: "B" },
      pins: [{ comment: "other", kind: "element", pinId: "pin_one" }],
    });
    const first = db.addPinComment("capture_comment_a", "pin_one", "  hello  ");
    assert.equal(first.body, "hello");
    assert.equal(first.actorId, "local");
    assert.equal(first.actorLabel, "Local");
    assert.equal(first.actorType, "human");
    db.addPinComment("capture_comment_a", "pin_two", "later");
    assert.throws(
      () => db.addPinComment("capture_comment_a", "pin_missing", "nope"),
      (error) => error?.code === "pin_not_found",
    );
    db.close();

    const reopened = openHistoryDb(tempDir);
    assert.deepEqual(reopened.listPinComments("capture_comment_a").map((item) => item.body), ["hello", "later"]);
    assert.deepEqual(reopened.listPinComments("capture_comment_a").map((item) => item.pinId), ["pin_one", "pin_two"]);
    assert.deepEqual(reopened.listPinComments("capture_comment_b"), []);
    assert.equal(reopened.deleteSession("capture_comment_a"), true);
    assert.deepEqual(reopened.listPinComments("capture_comment_a"), []);
    reopened.addPinComment("capture_comment_b", "pin_one", "kept");
    reopened.clearHistory();
    assert.deepEqual(reopened.listPinComments("capture_comment_b"), []);
    reopened.close();
  });

  test("json history fallback keeps pin comments across a restart", () => {
    mkdirSync(join(tempDir, "history.db"));
    const db = openHistoryDb(tempDir);
    db.saveSession({
      id: "json_comment_capture",
      page: { title: "JSON" },
      pins: [{ comment: "pin", kind: "element", pinId: "pin_json" }],
    });
    db.addPinComment("json_comment_capture", "pin_json", "from disk");
    db.close();

    const reopened = openHistoryDb(tempDir);
    const comments = reopened.listPinComments("json_comment_capture");
    assert.equal(comments.length, 1);
    assert.equal(comments[0].body, "from disk");
    assert.equal(comments[0].actorLabel, "Local");
    reopened.deleteSession("json_comment_capture");
    assert.deepEqual(reopened.listPinComments("json_comment_capture"), []);
    reopened.close();
  });

  function assertAssistantHistory(db) {
    const first = db.createAssistantThread({ id: "ath_first", now: "2026-10-01T00:00:00.000Z", title: "First" });
    assert.deepEqual(first, { createdAt: "2026-10-01T00:00:00.000Z", id: "ath_first", title: "First", updatedAt: "2026-10-01T00:00:00.000Z" });
    const second = db.createAssistantThread({ id: "ath_second", now: "2026-10-02T00:00:00.000Z", title: "Second" });
    assert.deepEqual(second, { createdAt: "2026-10-02T00:00:00.000Z", id: "ath_second", title: "Second", updatedAt: "2026-10-02T00:00:00.000Z" });

    // Newest first by updated_at, with limit/offset.
    assert.deepEqual(db.listAssistantThreads().map((item) => item.id), ["ath_second", "ath_first"]);
    assert.deepEqual(db.listAssistantThreads({ limit: 1 }).map((item) => item.id), ["ath_second"]);
    assert.deepEqual(db.listAssistantThreads({ limit: 1, offset: 1 }).map((item) => item.id), ["ath_first"]);
    assert.equal(db.getAssistantThread("ath_never_created"), null);

    // Appending a message stamps the thread's updated_at and reorders the list.
    const messageOne = {
      createdAt: "2026-10-03T00:00:00.000Z",
      errorCode: null,
      id: "amg_one",
      role: "user",
      status: "final",
      text: "One",
      threadId: "ath_first",
    };
    db.appendAssistantMessage(messageOne);
    assert.equal(db.getAssistantThread("ath_first").updatedAt, "2026-10-03T00:00:00.000Z");
    assert.deepEqual(db.listAssistantThreads().map((item) => item.id), ["ath_first", "ath_second"]);

    db.appendAssistantMessage({ ...messageOne, createdAt: "2026-10-03T00:01:00.000Z", id: "amg_two", text: "Two" });
    db.appendAssistantMessage({ ...messageOne, createdAt: "2026-10-03T00:02:00.000Z", id: "amg_three", role: "assistant", text: "Three" });
    const recent = db.listAssistantMessages("ath_first", { limit: 2 });
    assert.deepEqual(recent.map((item) => item.id), ["amg_two", "amg_three"]);
    assert.equal(recent[0].text, "Two");
    assert.equal(recent[1].role, "assistant");
    assert.equal(db.listAssistantMessages("ath_first").length, 3);
    assert.deepEqual(db.listAssistantMessages("ath_second"), []);
    assert.throws(
      () => db.appendAssistantMessage({ ...messageOne, id: "amg_orphan", threadId: "ath_missing" }),
      (error) => error instanceof Error && error.message === "assistant thread not found",
    );
    assert.equal(db.getAssistantThread("ath_missing"), null);

    assert.equal(db.deleteAssistantThread("ath_second"), true);
    assert.equal(db.deleteAssistantThread("ath_second"), false);
    assert.equal(db.getAssistantThread("ath_second"), null);
    assert.deepEqual(db.listAssistantMessages("ath_second"), []);
    assert.equal(db.listAssistantThreads().length, 1);
  }

  test("sqlite assistant threads keep order, limits, deletion, and clearHistory", () => {
    const db = openHistoryDb(tempDir);
    assertAssistantHistory(db);
    db.clearHistory();
    assert.deepEqual(db.listAssistantThreads(), []);
    assert.deepEqual(db.listAssistantMessages("ath_first"), []);
    db.close();
  });

  test("sqlite assistant history survives a restart", () => {
    const db = openHistoryDb(tempDir);
    db.createAssistantThread({ id: "ath_reopen", now: "2026-10-01T00:00:00.000Z", title: "Reopen" });
    db.appendAssistantMessage({
      createdAt: "2026-10-01T00:01:00.000Z",
      errorCode: "ASSISTANT_TURN_TIMEOUT",
      id: "amg_reopen",
      role: "assistant",
      status: "error",
      text: "",
      threadId: "ath_reopen",
    });
    db.close();

    const reopened = openHistoryDb(tempDir);
    const thread = reopened.getAssistantThread("ath_reopen");
    assert.equal(thread.title, "Reopen");
    assert.equal(thread.updatedAt, "2026-10-01T00:01:00.000Z");
    const messages = reopened.listAssistantMessages("ath_reopen");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].errorCode, "ASSISTANT_TURN_TIMEOUT");
    assert.equal(messages[0].status, "error");
    reopened.close();
  });

  function assertTiedTimestamps(db) {
    db.createAssistantThread({ id: "ath_tied", now: "2026-10-01T00:00:00.000Z", title: "Tied" });
    for (const id of ["amg_tied_m1", "amg_tied_m2", "amg_tied_m3"]) {
      db.appendAssistantMessage({
        createdAt: "2026-10-01T00:01:00.000Z",
        errorCode: null,
        id,
        role: "user",
        status: "final",
        text: id,
        threadId: "ath_tied",
      });
    }
    // Same timestamp: the limit cut must keep the last two inserted, and the
    // uncut window must be the chronological m1, m2, m3.
    assert.deepEqual(db.listAssistantMessages("ath_tied", { limit: 2 }).map((item) => item.id), [
      "amg_tied_m2",
      "amg_tied_m3",
    ]);
    assert.deepEqual(db.listAssistantMessages("ath_tied").map((item) => item.id), [
      "amg_tied_m1",
      "amg_tied_m2",
      "amg_tied_m3",
    ]);
  }

  test("sqlite assistant messages keep insertion order for equal timestamps", () => {
    const db = openHistoryDb(tempDir);
    assertTiedTimestamps(db);
    db.close();
  });

  test("json history fallback stores assistant threads and messages", () => {
    mkdirSync(join(tempDir, "history.db"));
    const db = openHistoryDb(tempDir);
    assertAssistantHistory(db);
    db.clearHistory();
    assert.deepEqual(db.listAssistantThreads(), []);
    assert.deepEqual(db.listAssistantMessages("ath_first"), []);
    db.close();
  });

  test("json history fallback keeps assistant history across a restart", () => {
    mkdirSync(join(tempDir, "history.db"));
    const db = openHistoryDb(tempDir);
    db.createAssistantThread({ id: "ath_json_reopen", now: "2026-10-01T00:00:00.000Z", title: "JSON reopen" });
    db.appendAssistantMessage({
      createdAt: "2026-10-01T00:01:00.000Z",
      errorCode: null,
      id: "amg_json_reopen",
      role: "user",
      status: "final",
      text: "Still here",
      threadId: "ath_json_reopen",
    });
    db.close();

    const reopened = openHistoryDb(tempDir);
    assert.equal(reopened.getAssistantThread("ath_json_reopen")?.title, "JSON reopen");
    assert.deepEqual(reopened.listAssistantMessages("ath_json_reopen").map((item) => item.text), ["Still here"]);
    reopened.close();
  });

  test("json assistant messages keep insertion order for equal timestamps", () => {
    mkdirSync(join(tempDir, "history.db"));
    const db = openHistoryDb(tempDir);
    assertTiedTimestamps(db);
    db.close();
  });

  test("json assistant append with a failed write throws and keeps the previous state", () => {
    mkdirSync(join(tempDir, "history.db"));
    const db = openHistoryDb(tempDir);
    db.createAssistantThread({ id: "ath_fault", now: "2026-10-01T00:00:00.000Z", title: "Fault" });
    for (const id of ["amg_fault_m1", "amg_fault_m2", "amg_fault_m3"]) {
      db.appendAssistantMessage({
        createdAt: "2026-10-01T00:01:00.000Z",
        errorCode: null,
        id,
        role: "user",
        status: "final",
        text: id,
        threadId: "ath_fault",
      });
    }
    const historyPath = join(tempDir, "history.json");
    const goodBytes = readFileSync(historyPath, "utf8");

    // Break the only write target the JSON store has: the file path becomes
    // a directory, so the atomic rename fails with EISDIR.
    const backup = join(tempDir, "fault-backup.json");
    renameSync(historyPath, backup);
    mkdirSync(historyPath);
    try {
      assert.throws(
        () =>
          db.appendAssistantMessage({
            createdAt: "2026-10-01T00:02:00.000Z",
            errorCode: null,
            id: "amg_fault_m4",
            role: "user",
            status: "final",
            text: "Must not persist",
            threadId: "ath_fault",
          }),
        (error) => error.code === "EISDIR",
      );

      // Memory and disk stay exactly as they were.
      assert.deepEqual(db.listAssistantMessages("ath_fault").map((item) => item.id), [
        "amg_fault_m1",
        "amg_fault_m2",
        "amg_fault_m3",
      ]);
      assert.equal(db.getAssistantThread("ath_fault").updatedAt, "2026-10-01T00:01:00.000Z");
      assert.equal(readFileSync(backup, "utf8"), goodBytes, "the persisted bytes are untouched by the failed write");
      assert.ok(!existsSync(join(tempDir, "history.json.pin-state")), "no torn temp file may be left behind");
    } finally {
      rmSync(historyPath, { recursive: true });
      renameSync(backup, historyPath);
    }

    // With the fault cleared, the same append succeeds and is durable across a reopen.
    db.appendAssistantMessage({
      createdAt: "2026-10-01T00:02:00.000Z",
      errorCode: null,
      id: "amg_fault_m4",
      role: "user",
      status: "final",
      text: "Must not persist",
      threadId: "ath_fault",
    });
    db.close();
    const reopened = openHistoryDb(tempDir);
    assert.deepEqual(reopened.listAssistantMessages("ath_fault").map((item) => item.id), [
      "amg_fault_m1",
      "amg_fault_m2",
      "amg_fault_m3",
      "amg_fault_m4",
    ]);
    reopened.close();
  });
});
