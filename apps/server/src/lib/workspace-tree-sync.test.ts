import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ProjectTreeProject } from "@pinar/shared";
import {
  applyRememberedShareTokens,
  beginWorkspaceTreeRefresh,
  finishWorkspaceTreeRefresh,
  projectTreeFingerprint,
  resolveSelectedCollectionId,
  WORKSPACE_TREE_POLL_MS,
  workspaceTreeRefreshIncludesMetadata,
  type WorkspaceShareTokenCache,
  type WorkspaceTreeRefreshFlight,
} from "./workspace-tree-sync";

describe("workspace tree sync", () => {
  test("changes fingerprint when pin review counts change", () => {
    const session = {
      id: "cap_1",
      reviewCounts: { accepted: 0, correction_ready: 0, open: 1, reopened: 0 },
    };
    const before = projectTreeFingerprint([{ collections: [{ sessions: [session] }] }]);
    const after = projectTreeFingerprint([{
      collections: [{
        sessions: [{
          ...session,
          reviewCounts: { accepted: 0, correction_ready: 1, open: 0, reopened: 0 },
        }],
      }],
    }]);
    assert.notEqual(before, after);
  });

  test("keeps the same fingerprint for identical trees", () => {
    const projects = [{ id: "prj", collections: [] }];
    assert.equal(projectTreeFingerprint(projects), projectTreeFingerprint(projects));
  });

  test("keeps All sessions selected when the current id is already null", () => {
    assert.equal(
      resolveSelectedCollectionId(null, null, new Set(["col_inbox"])),
      null,
    );
  });

  test("hydrates a stored collection only before the user picks All sessions", () => {
    assert.equal(
      resolveSelectedCollectionId(null, "col_inbox", new Set(["col_inbox"])),
      "col_inbox",
    );
    assert.equal(
      resolveSelectedCollectionId("col_inbox", "col_inbox", new Set(["col_inbox"])),
      "col_inbox",
    );
  });

  test("polls the visible workspace every 30 seconds and keeps metadata off that round", () => {
    assert.equal(WORKSPACE_TREE_POLL_MS, 30_000);
    assert.equal(workspaceTreeRefreshIncludesMetadata("poll"), false);
    assert.equal(workspaceTreeRefreshIncludesMetadata("initial"), true);
    assert.equal(workspaceTreeRefreshIncludesMetadata("focus"), true);
    assert.equal(workspaceTreeRefreshIncludesMetadata("mutation"), true);
  });

  test("collapses consecutive focus refreshes and waits out a delayed poll", () => {
    const idle: WorkspaceTreeRefreshFlight = { active: null, queued: null };
    const focus = beginWorkspaceTreeRefresh(idle, "focus");
    assert.equal(focus.started, true);
    const again = beginWorkspaceTreeRefresh(focus.flight, "focus");
    assert.equal(again.started, false);
    assert.equal(again.flight.queued, null);
    const afterFocus = finishWorkspaceTreeRefresh(again.flight);
    assert.equal(afterFocus.next, null);

    const poll = beginWorkspaceTreeRefresh(idle, "poll");
    const focusDuringPoll = beginWorkspaceTreeRefresh(poll.flight, "focus");
    assert.equal(focusDuringPoll.started, false);
    assert.equal(focusDuringPoll.flight.queued, "focus");
    const overlappedPoll = beginWorkspaceTreeRefresh(focusDuringPoll.flight, "poll");
    assert.equal(overlappedPoll.started, false);
    assert.equal(overlappedPoll.flight.queued, "focus");
    const afterPoll = finishWorkspaceTreeRefresh(overlappedPoll.flight);
    assert.equal(afterPoll.next, "focus");
    assert.equal(afterPoll.flight.active, "focus");
    assert.equal(afterPoll.flight.queued, null);
  });

  test("keeps isShared on a metadata-free poll and clears it when focus returns revoked tokens", () => {
    const projects = [{
      collections: [{
        id: "col_live",
        sessions: [{ id: "live-review" }],
      }],
      id: "prj_live",
    }] as ProjectTreeProject[];
    const now = Date.parse("2026-09-25T18:00:00.000Z");
    const active = [{
      resourceId: "live-review",
      resourceType: "session",
      status: "active",
      token: "sh_live",
    }];
    const empty: WorkspaceShareTokenCache = { ready: false, tokens: [] };
    const loaded = applyRememberedShareTokens(projects, empty, active, now);
    assert.equal(loaded.cache.ready, true);
    assert.equal(loaded.projects[0]?.collections[0]?.sessions[0]?.isShared, true);

    const polled = applyRememberedShareTokens(projects, loaded.cache, null, now);
    assert.equal(polled.cache, loaded.cache);
    assert.equal(polled.projects[0]?.collections[0]?.sessions[0]?.isShared, true);

    const revoked = applyRememberedShareTokens(projects, polled.cache, [{
      resourceId: "live-review",
      resourceType: "session",
      revokedAt: "2026-09-25T17:00:00.000Z",
      status: "active",
      token: "sh_live",
    }], now);
    assert.equal(revoked.projects[0]?.collections[0]?.sessions[0]?.isShared, false);

    const stillRevoked = applyRememberedShareTokens(projects, revoked.cache, null, now);
    assert.equal(stillRevoked.projects[0]?.collections[0]?.sessions[0]?.isShared, false);
  });

  test("clears a collection that disappeared from the tree", () => {
    assert.equal(
      resolveSelectedCollectionId("col_gone", "col_gone", new Set(["col_inbox"])),
      null,
    );
  });
});
