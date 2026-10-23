import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { historyDatabase, resetLocalApiForTests } from "../api.local";
import { localMcpHandlers } from "../local-mcp";
import { localAssistantStateReader } from "./state-reader-local";
import { releaseClosedDatabases } from "../../../tests/helpers/native-handles";

const ORIGIN = "http://127.0.0.1:17373";

let root = "";
let previousHome: string | undefined;

type Json = Record<string, any>;

// The real local MCP handlers over the real history database of a
// temporary PINAR_HOME.
function localMcp() {
  const database = historyDatabase();
  const handlers = localMcpHandlers(database, ORIGIN);
  return {
    call: async (name: string, args: Record<string, unknown>) => (await handlers.callTool(name, args)) as Json,
    reader: localAssistantStateReader(database),
  };
}

describe("localAssistantStateReader", () => {
  beforeEach(async () => {
    previousHome = process.env.PINAR_HOME;
    root = await mkdtemp(join(tmpdir(), "pinar-state-reader-"));
    process.env.PINAR_HOME = root;
    resetLocalApiForTests();
  });

  afterEach(async () => {
    resetLocalApiForTests();
    if (previousHome === undefined) delete process.env.PINAR_HOME;
    else process.env.PINAR_HOME = previousHome;
    await releaseClosedDatabases();
    await rm(root, { force: true, recursive: true });
  });

  test("matches what the local MCP shows after real writes", async () => {
    const { call, reader } = localMcp();
    const project = (await call("pinar.create_project", { name: "Site" })).project;
    const checkout = (await call("pinar.create_collection", { name: "Checkout", projectId: project.id })).collection;
    const onboarding = (await call("pinar.create_collection", { name: "Onboarding", projectId: project.id })).collection;
    await call("pinar.create_collection", { name: "Nested", parentId: checkout.id, projectId: project.id });
    const batch = (await call("pinar.create_batch", { label: "Sprint 12" })).batch;
    const cart = (await call("pinar.create_session", { batchId: batch.id, collectionId: checkout.id, page: { title: "Cart page", url: "https://example.test/cart" } })).session;
    const pay = (await call("pinar.create_session", { collectionId: checkout.id, page: { title: "Payment form", url: "https://example.test/pay" } })).session;
    await call("pinar.create_session", { collectionId: checkout.id, page: { title: "Receipt", url: "https://example.test/receipt" } });
    const pin = (await call("pinar.create_pin", { comment: "Button misaligned", sessionId: cart.id })).pin;
    await call("pinar.add_pin_comment", { body: "Looks off on mobile", pinId: pin.id, sessionId: cart.id });
    await call("pinar.add_pin_comment", { body: "Fixed in staging", pinId: pin.id, sessionId: cart.id });
    await call("pinar.move_session", { collectionId: onboarding.id, sessionId: pay.id });
    await call("pinar.reorder_projects", { ids: [project.id, ...(await call("pinar.list_projects", { limit: 50 })).projects.map((item: Json) => item.id).filter((id: string) => id !== project.id)] });

    // Projects: order and collection counts.
    const projects = (await call("pinar.list_projects", { limit: 50 })).projects as Json[];
    assert.deepEqual(await reader.projectOrder(), projects.map((item) => item.id));
    for (const item of projects) {
      const collections = (await call("pinar.list_collections", { limit: 50, projectId: item.id })).collections as Json[];
      assert.deepEqual(await reader.project(item.id), { collectionCount: collections.length, id: item.id, name: item.name });
      assert.deepEqual(await reader.collectionPlacements(item.id), collections.map((collection) => ({ id: collection.id, parentId: collection.parentId ?? null })));
      // Collections: identity, parent, session count and order.
      for (const collection of collections) {
        const sessions = (await call("pinar.list_sessions", { collectionId: collection.id, limit: 50 })).sessions as Json[];
        assert.deepEqual(await reader.collection(collection.id), {
          id: collection.id,
          name: collection.name,
          parentId: collection.parentId ?? null,
          projectId: item.id,
          sessionCount: sessions.length,
        });
        assert.deepEqual(await reader.sessionOrder(collection.id), sessions.map((session) => session.id));
        // Sessions: collection, batch, pin count and title.
        for (const session of sessions) {
          assert.deepEqual(await reader.session(session.id), {
            batchId: session.batchId,
            collectionId: session.collectionId,
            id: session.id,
            pinCount: session.pinCount,
            title: session.title,
          });
        }
      }
    }
    assert.equal((await reader.session(pay.id))?.collectionId, onboarding.id, "the move is visible");
    assert.equal((await reader.collection(checkout.id))?.sessionCount, 2);

    // Pins and their conversation comments.
    const shownPin = (await call("pinar.get_pin", { pinId: pin.id, sessionId: cart.id })).pin;
    const comments = (await call("pinar.list_pin_comments", { pinId: pin.id, sessionId: cart.id })).comments as Json[];
    assert.deepEqual(await reader.pin(cart.id, pin.id), { comment: shownPin.comment, commentCount: comments.length, id: pin.id, number: shownPin.number });
    assert.equal(comments.length, 2);
    for (const comment of comments) {
      assert.deepEqual(await reader.comment(cart.id, pin.id, comment.id), { body: comment.body, id: comment.id });
    }

    // Batches with their linked sessions.
    const batches = (await call("pinar.list_batches", { limit: 50 })).batches as Json[];
    const shownBatch = batches.find((item) => item.id === batch.id)!;
    assert.deepEqual(await reader.batch(batch.id), { finishedAt: shownBatch.finishedAt, id: batch.id, label: "Sprint 12", sessionCount: shownBatch.sessionCount });
    assert.equal(shownBatch.sessionCount, 1);

    // No share links locally; unknown ids read as null.
    assert.equal(await reader.share("session", cart.id), null);
    assert.equal(await reader.session("missing"), null);
    assert.equal(await reader.collection("missing"), null);
    assert.equal(await reader.sessionOrder("missing"), null);
    assert.equal(await reader.collectionPlacements("missing"), null);
    assert.equal(await reader.project("missing"), null);
    assert.equal(await reader.batch("missing"), null);
    assert.equal(await reader.pin(cart.id, "missing"), null);
    assert.equal(await reader.pin("missing", pin.id), null);
    assert.equal(await reader.comment(cart.id, pin.id, "missing"), null);
  });

  test("collectionPlacements is the items shape pinar.reorder_collections takes back", async () => {
    const { call, reader } = localMcp();
    const project = (await call("pinar.create_project", { name: "Site" })).project;
    const first = (await call("pinar.create_collection", { name: "First", projectId: project.id })).collection;
    const second = (await call("pinar.create_collection", { name: "Second", projectId: project.id })).collection;
    await call("pinar.create_collection", { name: "Child", parentId: first.id, projectId: project.id });
    const before = await reader.collectionPlacements(project.id);
    const listed = async () => ((await call("pinar.list_collections", { limit: 50, projectId: project.id })).collections as Json[]).map((item) => [item.id, item.parentId ?? null, item.position]);
    const original = await listed();

    // A real reorder that also moves the child under the second collection.
    await call("pinar.reorder_collections", {
      items: [...(before as Json[]).filter((item) => item.id !== first.id && item.parentId !== first.id), { id: first.id, parentId: null }, ...(before as Json[]).filter((item) => item.parentId === first.id).map((item) => ({ id: item.id, parentId: second.id }))],
      projectId: project.id,
    });
    assert.notDeepEqual(await listed(), original);
    // Handing the earlier placements back restores parents and positions.
    await call("pinar.reorder_collections", { items: before, projectId: project.id });
    assert.deepEqual(await listed(), original);
  });
});
