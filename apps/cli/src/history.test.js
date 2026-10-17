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

  function assertAssistantProposals(db) {
    db.createAssistantThread({ id: "ath_prop", now: "2026-10-04T00:00:00.000Z", title: "Proposals" });
    db.appendAssistantMessage({
      ask: null,
      createdAt: "2026-10-04T00:01:00.000Z",
      errorCode: null,
      id: "amg_prop",
      role: "assistant",
      status: "final",
      text: "I can move those sessions for you.",
      threadId: "ath_prop",
    });
    db.appendAssistantMessage({
      ask: { options: ["Confirm", "Reject"], question: "Move them?" },
      createdAt: "2026-10-04T00:02:00.000Z",
      errorCode: null,
      id: "amg_ask",
      role: "assistant",
      status: "final",
      text: "",
      threadId: "ath_prop",
    });
    assert.deepEqual(db.listAssistantMessages("ath_prop").map((item) => item.ask), [
      null,
      { options: ["Confirm", "Reject"], question: "Move them?" },
    ]);

    const first = {
      args: { collectionId: "col_target", sessionIds: ["s1", "s2"] },
      createdAt: "2026-10-04T00:03:00.000Z",
      display: { action: "move_sessions", params: { collection: "Target", count: 2 } },
      errorCode: null,
      executedAt: null,
      expiresAt: "2026-10-04T00:13:00.000Z",
      fingerprint: "a1",
      id: "apr_first_local_000000000000",
      messageId: "amg_ask",
      result: null,
      risk: "reversible",
      status: "proposed",
      summary: 'Move 2 sessions to "Target"',
      threadId: "ath_prop",
      tool: "pinar.move_sessions",
      undo: null,
      undoExpiresAt: null,
      updatedAt: "2026-10-04T00:03:00.000Z",
    };
    const tied = { ...first, id: "apr_tied_local_0000000000000" }; // same createdAt as first
    const executed = {
      ...first,
      args: { collectionId: "col_target" },
      createdAt: "2026-10-04T00:04:00.000Z",
      executedAt: "2026-10-04T00:05:00.000Z",
      id: "apr_executed_local_000000000",
      result: { failed: 0, moved: 2 },
      status: "executed",
      undo: { calls: [{ args: { collectionId: "col_origin", sessionId: "s1" }, tool: "pinar.move_session" }], postFingerprint: "b2" },
      undoExpiresAt: "2026-10-04T00:15:00.000Z",
      updatedAt: "2026-10-04T00:05:00.000Z",
    };

    // A proposal for a missing thread is rejected.
    assert.throws(
      () => db.createAssistantProposal({ ...first, threadId: "ath_missing" }),
      (error) => error instanceof Error && error.message === "assistant thread not found",
    );
    db.createAssistantProposal(first);
    db.createAssistantProposal(tied);
    db.createAssistantProposal(executed);

    // Create, read, and list in order (createdAt asc, then id asc on the tie).
    assert.equal(db.getAssistantProposal("apr_missing_local_0000000000"), null);
    assert.deepEqual(db.getAssistantProposal(executed.id), executed);
    assert.deepEqual(db.listAssistantProposals("ath_prop").map((item) => item.id), [
      first.id,
      tied.id,
      executed.id,
    ]);
    assert.deepEqual(db.listAssistantProposals("ath_missing"), []);

    // Transition from the right from.
    const executing = db.transitionAssistantProposal({ from: ["proposed"], id: first.id, now: "2026-10-04T00:06:00.000Z", to: "executing" });
    assert.equal(executing.status, "executing");
    assert.equal(executing.updatedAt, "2026-10-04T00:06:00.000Z");

    // Transition from the wrong from → null.
    assert.equal(
      db.transitionAssistantProposal({ from: ["proposed"], id: first.id, now: "2026-10-04T00:07:00.000Z", to: "executing" }),
      null,
    );

    // requireBefore expired → null, and the record is untouched.
    assert.equal(
      db.transitionAssistantProposal({
        from: ["executing"],
        id: first.id,
        now: "2026-10-04T00:14:00.000Z",
        patch: { executedAt: "2026-10-04T00:14:00.000Z" },
        requireBefore: "expiresAt",
        to: "executed",
      }),
      null,
    );
    assert.equal(db.getAssistantProposal(first.id).status, "executing");

    // requireBefore inside the window → the patch and the status land together.
    const done = db.transitionAssistantProposal({
      from: ["executing"],
      id: first.id,
      now: "2026-10-04T00:08:00.000Z",
      patch: {
        errorCode: null,
        executedAt: "2026-10-04T00:08:00.000Z",
        result: { moved: 2 },
        undo: { calls: [], postFingerprint: "c3" },
        undoExpiresAt: "2026-10-04T00:18:00.000Z",
      },
      requireBefore: "expiresAt",
      to: "executed",
    });
    assert.equal(done.status, "executed");
    assert.deepEqual(done.result, { moved: 2 });
    assert.deepEqual(done.undo, { calls: [], postFingerprint: "c3" });

    // requireBefore on the undo window, expired → null, the record stays executed.
    assert.equal(
      db.transitionAssistantProposal({ from: ["executed"], id: first.id, now: "2026-10-04T00:19:00.000Z", requireBefore: "undoExpiresAt", to: "undoing" }),
      null,
    );
    assert.equal(db.getAssistantProposal(first.id).status, "executed");

    // Two back-to-back transitions from "proposed": only the first wins.
    const firstClaim = db.transitionAssistantProposal({ from: ["proposed"], id: tied.id, now: "2026-10-04T00:09:00.000Z", to: "executing" });
    const secondClaim = db.transitionAssistantProposal({ from: ["proposed"], id: tied.id, now: "2026-10-04T00:09:01.000Z", to: "rejected" });
    assert.equal(firstClaim.status, "executing");
    assert.equal(secondClaim, null);
    assert.equal(db.getAssistantProposal(tied.id).status, "executing");

    // Deleting a thread deletes its proposals.
    db.createAssistantThread({ id: "ath_prop_del", now: "2026-10-04T00:10:00.000Z", title: "Delete" });
    db.createAssistantProposal({ ...first, id: "apr_deleted_local_0000000000", threadId: "ath_prop_del" });
    assert.equal(db.deleteAssistantThread("ath_prop_del"), true);
    assert.equal(db.getAssistantProposal("apr_deleted_local_0000000000"), null);
    assert.equal(db.deleteAssistantThread("ath_prop"), true);
    assert.equal(db.getAssistantProposal(first.id), null);

    db.clearHistory();
    assert.deepEqual(db.listAssistantProposals("ath_prop"), []);
    assert.equal(db.getAssistantThread("ath_prop"), null);
  }

  test("sqlite assistant proposals keep order, JSON payloads, and atomic transitions", () => {
    const db = openHistoryDb(tempDir);
    assertAssistantProposals(db);
    db.close();
  });

  test("json history fallback stores assistant proposals and transitions", () => {
    mkdirSync(join(tempDir, "history.db"));
    const db = openHistoryDb(tempDir);
    assertAssistantProposals(db);
    db.close();
  });

  test("json assistant transition with a failed write throws and keeps the previous state", () => {
    mkdirSync(join(tempDir, "history.db"));
    const db = openHistoryDb(tempDir);
    db.createAssistantThread({ id: "ath_fault_prop", now: "2026-10-04T00:00:00.000Z", title: "Fault" });
    db.createAssistantProposal({
      args: { collectionId: "col_target" },
      createdAt: "2026-10-04T00:01:00.000Z",
      display: { action: "move_session", params: { session: "S", collection: "Target" } },
      errorCode: null,
      executedAt: null,
      expiresAt: "2026-10-04T00:11:00.000Z",
      fingerprint: "a1",
      id: "apr_fault_proposal_000000000",
      messageId: "amg_prop",
      result: null,
      risk: "reversible",
      status: "proposed",
      summary: 'Move a session to "Target"',
      threadId: "ath_fault_prop",
      tool: "pinar.move_session",
      undo: null,
      undoExpiresAt: null,
      updatedAt: "2026-10-04T00:01:00.000Z",
    });
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
          db.transitionAssistantProposal({
            from: ["proposed"],
            id: "apr_fault_proposal_000000000",
            now: "2026-10-04T00:02:00.000Z",
            to: "executing",
          }),
        (error) => error.code === "EISDIR",
      );

      // Memory and disk stay exactly as they were.
      assert.equal(db.getAssistantProposal("apr_fault_proposal_000000000").status, "proposed");
      assert.equal(readFileSync(backup, "utf8"), goodBytes, "the persisted bytes are untouched by the failed write");
      assert.ok(!existsSync(join(tempDir, "history.json.pin-state")), "no torn temp file may be left behind");
    } finally {
      rmSync(historyPath, { recursive: true });
      renameSync(backup, historyPath);
    }

    // With the fault cleared, the same transition succeeds and is durable across a reopen.
    const done = db.transitionAssistantProposal({
      from: ["proposed"],
      id: "apr_fault_proposal_000000000",
      now: "2026-10-04T00:02:00.000Z",
      to: "executing",
    });
    assert.equal(done.status, "executing");
    db.close();
    const reopened = openHistoryDb(tempDir);
    assert.equal(reopened.getAssistantProposal("apr_fault_proposal_000000000").status, "executing");
    reopened.close();
  });

  test("sqlite assistant database from before ask_json opens and gains the column", () => {
    const dbFile = join(tempDir, "history.db");
    const legacy = new DatabaseSync(dbFile);
    try {
      legacy.exec(`
        CREATE TABLE assistant_threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_assistant_threads_updated ON assistant_threads(updated_at DESC);
        CREATE TABLE assistant_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('user','assistant')), text TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('final','error')), error_code TEXT, created_at TEXT NOT NULL);
        CREATE INDEX idx_assistant_messages_thread ON assistant_messages(thread_id, created_at);
      `);
      legacy.exec(
        "INSERT INTO assistant_threads (id, title, created_at, updated_at) VALUES ('ath_legacy', 'Legacy', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')",
      );
      legacy.exec(
        "INSERT INTO assistant_messages (id, thread_id, role, text, status, error_code, created_at) VALUES ('amg_legacy', 'ath_legacy', 'user', 'Old question', 'final', NULL, '2026-10-01T00:00:00.000Z')",
      );
    } finally {
      legacy.close();
    }

    const db = openHistoryDb(tempDir);
    const columns = db.db.prepare("PRAGMA table_info(assistant_messages)").all().map((row) => row.name);
    assert.ok(columns.includes("ask_json"), "the legacy database gains the ask_json column");
    // The legacy row reads back with ask: null.
    const legacyMessages = db.listAssistantMessages("ath_legacy");
    assert.equal(legacyMessages.length, 1);
    assert.equal(legacyMessages[0].ask, null);
    db.appendAssistantMessage({
      ask: { options: ["A", "B"], question: "Which one?" },
      createdAt: "2026-10-01T00:01:00.000Z",
      errorCode: null,
      id: "amg_new",
      role: "assistant",
      status: "final",
      text: "",
      threadId: "ath_legacy",
    });
    assert.deepEqual(db.listAssistantMessages("ath_legacy").map((item) => item.ask), [
      null,
      { options: ["A", "B"], question: "Which one?" },
    ]);
    // Proposals work on the freshly created table as well.
    db.createAssistantProposal({
      args: { collectionId: "col_target" },
      createdAt: "2026-10-01T00:02:00.000Z",
      display: { action: "move_session", params: { session: "S", collection: "Target" } },
      errorCode: null,
      executedAt: null,
      expiresAt: "2026-10-01T00:12:00.000Z",
      fingerprint: "a1",
      id: "apr_legacy_db_proposal_00000",
      messageId: "amg_new",
      result: null,
      risk: "reversible",
      status: "proposed",
      summary: 'Move a session to "Target"',
      threadId: "ath_legacy",
      tool: "pinar.move_session",
      undo: null,
      undoExpiresAt: null,
      updatedAt: "2026-10-01T00:02:00.000Z",
    });
    assert.equal(db.getAssistantProposal("apr_legacy_db_proposal_00000").status, "proposed");
    db.close();
  });

  // ---------- pin index (F3/S2) ----------

  const INDEXED_AT = "2026-10-01T00:00:00.000Z";

  /** A Float32 LE vector of 256 dimensions: 1024 bytes. */
  function pinIndexVector(seed) {
    return new Uint8Array(new Float32Array(256).map((_, index) => Math.sin(index + seed) * 1000).buffer);
  }

  function pinIndexEntry(sessionId, pinId, overrides = {}) {
    return {
      caption: null,
      docHash: `hash-${pinId}`,
      docText: `Page: ${sessionId}\nPin #1: ${pinId}`,
      model: "",
      number: 1,
      ocr: null,
      pinId,
      sessionId,
      truncated: false,
      updatedAt: INDEXED_AT,
      vector: null,
      ...overrides,
    };
  }

  function assertPinIndexHistory(db) {
    assert.deepEqual(db.listPinIndexEntries("idx_missing"), []);

    // A full entry and a text-only one round-trip every field, ordered by pin number.
    const embedded = pinIndexEntry("idx_s1", "idx_p2", {
      caption: "A red button",
      model: "embeddinggemma-300m",
      number: 2,
      ocr: "Buy now",
      truncated: true,
      vector: pinIndexVector(1),
    });
    const textOnly = pinIndexEntry("idx_s1", "idx_p1");
    db.replacePinIndexSession("idx_s1", [embedded, textOnly]);
    const stored = db.listPinIndexEntries("idx_s1");
    assert.deepEqual(stored, [textOnly, embedded]);
    assert.ok(stored[1].vector instanceof Uint8Array);
    assert.equal(stored[1].vector.byteLength, 1024);
    assert.deepEqual(stored[1].vector, pinIndexVector(1));
    assert.deepEqual(new Float32Array(stored[1].vector.buffer, stored[1].vector.byteOffset, 256), new Float32Array(pinIndexVector(1).buffer));
    assert.equal(stored[0].vector, null);

    db.replacePinIndexSession("idx_s2", [pinIndexEntry("idx_s2", "idx_q1", { updatedAt: "2026-10-02T00:00:00.000Z" })]);

    // Replacing drops the pins that left the session and leaves the other sessions alone.
    const replacement = pinIndexEntry("idx_s1", "idx_p3", { number: 3, vector: pinIndexVector(3) });
    db.replacePinIndexSession("idx_s1", [replacement]);
    assert.deepEqual(db.listPinIndexEntries("idx_s1"), [replacement]);
    assert.deepEqual(db.listPinIndexEntries("idx_s2").map((entry) => entry.pinId), ["idx_q1"]);

    // entriesFor: the requested sessions only, each once, in the requested order.
    assert.deepEqual(
      db.listPinIndexEntriesFor(["idx_s2", "idx_s1", "idx_s2", "idx_missing"]).map((entry) => entry.pinId),
      ["idx_q1", "idx_p3"],
    );
    assert.deepEqual(db.listPinIndexEntriesFor(["idx_s1"]).map((entry) => entry.pinId), ["idx_p3"]);
    assert.deepEqual(db.listPinIndexEntriesFor([]), []);

    // staleSessions: no entry yet, or updatedAt newer than the oldest entry.
    db.replacePinIndexSession("idx_s4", [
      pinIndexEntry("idx_s4", "idx_r1", { updatedAt: "2026-10-01T00:00:00.000Z" }),
      pinIndexEntry("idx_s4", "idx_r2", { number: 2, updatedAt: "2026-10-03T00:00:00.000Z" }),
    ]);
    const sessions = [
      { id: "idx_s1", updatedAt: INDEXED_AT }, // same instant: fresh
      { id: "idx_s2", updatedAt: "2026-10-01T12:00:00.000Z" }, // older than its entries: fresh
      { id: "idx_s3", updatedAt: INDEXED_AT }, // no entry: stale
      { id: "idx_s1", updatedAt: "2026-10-05T00:00:00.000Z" }, // repeated id: counted once
      { id: "idx_s4", updatedAt: "2026-10-02T00:00:00.000Z" }, // newer than its oldest entry: stale
      { id: "idx_s5", updatedAt: INDEXED_AT }, // no entry: stale
    ];
    assert.deepEqual(db.stalePinIndexSessions({ limit: 10, sessions }), ["idx_s3", "idx_s4", "idx_s5"]);
    assert.deepEqual(db.stalePinIndexSessions({ limit: 2, sessions }), ["idx_s3", "idx_s4"]);
    assert.deepEqual(db.stalePinIndexSessions({ limit: 0, sessions }), []);
    assert.deepEqual(db.stalePinIndexSessions({ limit: 10, sessions: [] }), []);
    assert.deepEqual(
      db.stalePinIndexSessions({ limit: 10, sessions: [{ id: "idx_s2", updatedAt: "2026-10-02T00:00:00.001Z" }] }),
      ["idx_s2"],
    );

    // A replacement with an entry of another session, or a vector that is not bytes, writes nothing.
    assert.throws(
      () => db.replacePinIndexSession("idx_s1", [pinIndexEntry("idx_s1", "idx_ok"), pinIndexEntry("idx_s2", "idx_wrong")]),
      (error) => error instanceof Error && error.message === "pin index entry belongs to another session",
    );
    assert.throws(
      () => db.replacePinIndexSession("idx_s1", [pinIndexEntry("idx_s1", "idx_float", { vector: new Float32Array(256) })]),
      (error) => error instanceof Error && error.message === "pin index vector must be a Uint8Array or null",
    );
    assert.deepEqual(db.listPinIndexEntries("idx_s1"), [replacement]);

    db.deletePinIndexSession("idx_s2");
    assert.deepEqual(db.listPinIndexEntries("idx_s2"), []);
    db.replacePinIndexSession("idx_s1", []);
    assert.deepEqual(db.listPinIndexEntries("idx_s1"), []);
    assert.deepEqual(db.listPinIndexEntries("idx_s4").map((entry) => entry.pinId), ["idx_r1", "idx_r2"]);
  }

  /** A failure in the middle of a replacement (the second INSERT repeats a pin id) leaves the previous entries. */
  function assertPinIndexReplaceAtomic(db) {
    const previous = [
      pinIndexEntry("idx_atomic", "idx_a", { vector: pinIndexVector(5) }),
      pinIndexEntry("idx_atomic", "idx_b", { number: 2 }),
    ];
    db.replacePinIndexSession("idx_atomic", previous);
    assert.throws(() =>
      db.replacePinIndexSession("idx_atomic", [
        pinIndexEntry("idx_atomic", "idx_c", { number: 1 }),
        pinIndexEntry("idx_atomic", "idx_c", { number: 2 }),
      ])
    );
    assert.deepEqual(db.listPinIndexEntries("idx_atomic"), previous);
  }

  /** Deleting the session deletes its entries; clearHistory deletes all of them. */
  function assertPinIndexLifecycle(db) {
    db.saveSession({ id: "idx_life", page: { title: "Indexed" }, pins: [{ comment: "Fix", kind: "element", pinId: "idx_life_p1" }] });
    db.saveSession({ id: "idx_keep", page: { title: "Kept" }, pins: [{ comment: "Keep", kind: "element", pinId: "idx_keep_p1" }] });
    db.replacePinIndexSession("idx_life", [pinIndexEntry("idx_life", "idx_life_p1", { vector: pinIndexVector(7) })]);
    db.replacePinIndexSession("idx_keep", [pinIndexEntry("idx_keep", "idx_keep_p1")]);

    assert.equal(db.deleteSession("idx_life"), true);
    assert.deepEqual(db.listPinIndexEntries("idx_life"), []);
    assert.deepEqual(db.listPinIndexEntries("idx_keep").map((entry) => entry.pinId), ["idx_keep_p1"]);

    db.replacePinIndexSession("idx_orphan", [pinIndexEntry("idx_orphan", "idx_orphan_p1")]);
    db.clearHistory();
    assert.deepEqual(db.listPinIndexEntriesFor(["idx_keep", "idx_orphan"]), []);
  }

  test("sqlite pin index keeps entries, entriesFor, staleSessions, and the vector bytes", () => {
    const db = openHistoryDb(tempDir);
    try {
      assertPinIndexHistory(db);
    } finally {
      db.close();
    }
  });

  test("sqlite pin index replacement rolls back a failure in the middle", () => {
    const db = openHistoryDb(tempDir);
    try {
      assertPinIndexReplaceAtomic(db);
    } finally {
      db.close();
    }
  });

  test("sqlite pin index entries go with the session and with clearHistory", () => {
    const db = openHistoryDb(tempDir);
    try {
      assertPinIndexLifecycle(db);
    } finally {
      db.close();
    }
  });

  test("sqlite pin index survives a restart and reaches an older database", () => {
    const db = openHistoryDb(tempDir);
    const entry = pinIndexEntry("idx_reopen", "idx_reopen_p1", { model: "embeddinggemma-300m", vector: pinIndexVector(9) });
    db.replacePinIndexSession("idx_reopen", [entry]);
    db.close();

    const reopened = openHistoryDb(tempDir);
    assert.deepEqual(reopened.listPinIndexEntries("idx_reopen"), [entry]);
    reopened.close();

    // A database from before F3 has no pin_index table; opening it creates one.
    const legacy = new DatabaseSync(join(tempDir, "history.db"));
    legacy.exec("DROP INDEX idx_pin_index_owner; DROP TABLE pin_index;");
    legacy.close();
    const upgraded = openHistoryDb(tempDir);
    try {
      assert.deepEqual(upgraded.listPinIndexEntries("idx_reopen"), []);
      upgraded.replacePinIndexSession("idx_reopen", [entry]);
      assert.deepEqual(upgraded.listPinIndexEntries("idx_reopen"), [entry]);
      const owner = upgraded.db.prepare("SELECT owner_id FROM pin_index WHERE session_id = ?").get("idx_reopen");
      assert.equal(owner.owner_id, "local");
    } finally {
      upgraded.close();
    }
  });

  test("json history fallback keeps the pin index cases", () => {
    mkdirSync(join(tempDir, "history.db"));
    const db = openHistoryDb(tempDir);
    try {
      assertPinIndexHistory(db);
      assertPinIndexReplaceAtomic(db);
      assertPinIndexLifecycle(db);
    } finally {
      db.close();
    }
  });

  test("json pin index survives a restart with the vector as base64", () => {
    mkdirSync(join(tempDir, "history.db"));
    const db = openHistoryDb(tempDir);
    const entry = pinIndexEntry("idx_json", "idx_json_p1", { truncated: true, vector: pinIndexVector(11) });
    db.replacePinIndexSession("idx_json", [entry]);
    db.close();

    const stored = JSON.parse(readFileSync(join(tempDir, "history.json"), "utf8")).pin_index;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].owner_id, "local");
    assert.equal(stored[0].vector, Buffer.from(pinIndexVector(11)).toString("base64"));

    const reopened = openHistoryDb(tempDir);
    try {
      assert.deepEqual(reopened.listPinIndexEntries("idx_json"), [entry]);
    } finally {
      reopened.close();
    }
  });

  test("json pin index replacement with a failed write throws and keeps the previous state", () => {
    mkdirSync(join(tempDir, "history.db"));
    const db = openHistoryDb(tempDir);
    const previous = [pinIndexEntry("idx_fault", "idx_fault_p1", { vector: pinIndexVector(13) })];
    db.replacePinIndexSession("idx_fault", previous);
    const historyPath = join(tempDir, "history.json");
    const goodBytes = readFileSync(historyPath, "utf8");

    // The file path becomes a directory, so the atomic rename fails with EISDIR.
    const backup = join(tempDir, "pin-index-fault-backup.json");
    renameSync(historyPath, backup);
    mkdirSync(historyPath);
    try {
      assert.throws(
        () => db.replacePinIndexSession("idx_fault", [pinIndexEntry("idx_fault", "idx_fault_p2")]),
        (error) => error.code === "EISDIR",
      );
      assert.throws(() => db.deletePinIndexSession("idx_fault"), (error) => error.code === "EISDIR");
      assert.deepEqual(db.listPinIndexEntries("idx_fault"), previous);
      assert.equal(readFileSync(backup, "utf8"), goodBytes, "the persisted bytes are untouched by the failed write");
      assert.ok(!existsSync(join(tempDir, "history.json.pin-state")), "no torn temp file may be left behind");
    } finally {
      rmSync(historyPath, { recursive: true });
      renameSync(backup, historyPath);
      db.close();
    }
  });
});
