// Test fixtures for assistant proposals: an in-memory world, a state reader
// over it and an MCP tool host that writes into it, so the reader sees what
// the host did. Every fixture id starts with FIXTURE_ID_PREFIX so tests can
// prove no id reaches a summary or the display params.
//
// The host mirrors the handler rules the undo depends on: reorder_* must
// list every member exactly once ("Invalid ordering"), a missing entity is
// a McpToolError, move_session appends to the end of the target collection,
// deleting a collection or project sends its sessions to the Inbox.

import { McpToolError } from "../mcp-protocol";
import type { AssistantStateReader } from "./state-reader";
import type { AssistantToolHost } from "./tools";

export const FIXTURE_ID_PREFIX = "fxid-";
export const INBOX_ID = `${FIXTURE_ID_PREFIX}col-inbox`;

export interface FixtureWorld {
  batches: Array<{ finishedAt: string | null; id: string; label: string }>;
  collections: Array<{ id: string; name: string; parentId: string | null; projectId: string }>;
  comments: Array<{ body: string; id: string; pinId: string; sessionId: string }>;
  pins: Array<{ comment: string; id: string; number: number; sessionId: string }>;
  projects: Array<{ id: string; name: string }>;
  sessions: Array<{ batchId: string | null; collectionId: string; id: string; title: string }>;
  shares: Array<{ active: boolean; name: string; resourceId: string; resourceType: string }>;
}

const id = (suffix: string) => `${FIXTURE_ID_PREFIX}${suffix}`;

/** Two projects, four collections (one of them the Inbox), five sessions, two pins, two comments, two batches. */
export function fixtureWorld(): FixtureWorld {
  return {
    batches: [
      { finishedAt: null, id: id("batch-1"), label: "Sprint 12" },
      { finishedAt: null, id: id("batch-2"), label: "QA pass" },
    ],
    collections: [
      { id: INBOX_ID, name: "Inbox", parentId: null, projectId: id("project-1") },
      { id: id("col-a"), name: "Checkout", parentId: null, projectId: id("project-1") },
      { id: id("col-b"), name: "Onboarding", parentId: null, projectId: id("project-1") },
      { id: id("col-c"), name: "Landing", parentId: null, projectId: id("project-2") },
    ],
    comments: [
      { body: "Looks off on mobile", id: id("comment-1"), pinId: id("pin-1"), sessionId: id("session-1") },
      { body: "Fixed in staging", id: id("comment-2"), pinId: id("pin-1"), sessionId: id("session-1") },
    ],
    pins: [
      { comment: "Button misaligned", id: id("pin-1"), number: 1, sessionId: id("session-1") },
      { comment: "Typo in header", id: id("pin-2"), number: 3, sessionId: id("session-1") },
    ],
    projects: [
      { id: id("project-1"), name: "Personal" },
      { id: id("project-2"), name: "Marketing site" },
    ],
    sessions: [
      { batchId: id("batch-1"), collectionId: id("col-a"), id: id("session-1"), title: "Cart page" },
      { batchId: null, collectionId: id("col-a"), id: id("session-2"), title: "Payment form" },
      { batchId: null, collectionId: id("col-a"), id: id("session-3"), title: "Receipt" },
      { batchId: null, collectionId: id("col-b"), id: id("session-4"), title: "Welcome" },
      { batchId: null, collectionId: INBOX_ID, id: id("session-5"), title: "Untitled capture" },
    ],
    shares: [
      { active: false, name: "Checkout", resourceId: id("col-a"), resourceType: "collection" },
      { active: true, name: "Cart page", resourceId: id("session-1"), resourceType: "session" },
    ],
  };
}

export function fixtureReader(world: FixtureWorld): AssistantStateReader {
  return {
    async batch(batchId) {
      const batch = world.batches.find((item) => item.id === batchId);
      return batch ? { ...batch, sessionCount: world.sessions.filter((item) => item.batchId === batchId).length } : null;
    },
    async collection(collectionId) {
      const collection = world.collections.find((item) => item.id === collectionId);
      if (!collection) return null;
      return { ...collection, sessionCount: world.sessions.filter((item) => item.collectionId === collectionId).length };
    },
    async collectionPlacements(projectId) {
      if (!world.projects.some((item) => item.id === projectId)) return null;
      return world.collections.filter((item) => item.projectId === projectId).map((item) => ({ id: item.id, parentId: item.parentId }));
    },
    async comment(sessionId, pinId, commentId) {
      const comment = world.comments.find((item) => item.sessionId === sessionId && item.pinId === pinId && item.id === commentId);
      return comment ? { body: comment.body, id: comment.id } : null;
    },
    async pin(sessionId, pinId) {
      const pin = world.pins.find((item) => item.sessionId === sessionId && item.id === pinId);
      if (!pin) return null;
      const commentCount = world.comments.filter((item) => item.sessionId === sessionId && item.pinId === pinId).length;
      return { comment: pin.comment, commentCount, id: pin.id, number: pin.number };
    },
    async project(projectId) {
      const project = world.projects.find((item) => item.id === projectId);
      if (!project) return null;
      return { ...project, collectionCount: world.collections.filter((item) => item.projectId === projectId).length };
    },
    async projectOrder() {
      return world.projects.map((item) => item.id);
    },
    async session(sessionId) {
      const session = world.sessions.find((item) => item.id === sessionId);
      if (!session) return null;
      return { ...session, pinCount: world.pins.filter((item) => item.sessionId === sessionId).length };
    },
    async sessionOrder(collectionId) {
      if (!world.collections.some((item) => item.id === collectionId)) return null;
      return world.sessions.filter((item) => item.collectionId === collectionId).map((item) => item.id);
    },
    async share(resourceType, resourceId) {
      const share = world.shares.find((item) => item.resourceType === resourceType && item.resourceId === resourceId);
      return share ? { active: share.active, name: share.name } : null;
    },
  };
}

/** The world as ordered per-entity views, independent of array positions across collections/projects. */
export function worldView(world: FixtureWorld) {
  return {
    batches: world.batches.map((item) => ({ ...item })),
    projects: world.projects.map((project) => ({
      collections: world.collections
        .filter((collection) => collection.projectId === project.id)
        .map((collection) => ({
          id: collection.id,
          name: collection.name,
          parentId: collection.parentId,
          sessions: world.sessions
            .filter((session) => session.collectionId === collection.id)
            .map((session) => ({
              batchId: session.batchId,
              id: session.id,
              pins: world.pins
                .filter((pin) => pin.sessionId === session.id)
                .sort((left, right) => left.number - right.number)
                .map((pin) => ({
                  comment: pin.comment,
                  comments: world.comments.filter((item) => item.sessionId === session.id && item.pinId === pin.id).map((item) => ({ body: item.body, id: item.id })),
                  id: pin.id,
                  number: pin.number,
                })),
              title: session.title,
            })),
        })),
      id: project.id,
      name: project.name,
    })),
    shares: world.shares.map((item) => ({ ...item })),
  };
}

function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw new McpToolError(`${key} is required`);
  return value;
}

function ids(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new McpToolError(`${key} is required`);
  return value as string[];
}

function sameMembers(order: string[], members: string[]): boolean {
  return order.length === members.length && new Set(order).size === order.length && order.every((item) => members.includes(item));
}

export interface FixtureHost extends AssistantToolHost {
  calls: Array<{ args: Record<string, unknown>; name: string }>;
  /** Return an error to throw it instead of running the call. */
  failOn?: (name: string, args: Record<string, unknown>) => Error | null;
}

export function fixtureHost(world: FixtureWorld): FixtureHost {
  let serial = 0;
  const newId = (kind: string) => `${FIXTURE_ID_PREFIX}new-${kind}-${++serial}`;
  const host: FixtureHost = {
    calls: [],
    async callTool(name, args) {
      host.calls.push({ args: structuredClone(args), name });
      const failure = host.failOn?.(name, args);
      if (failure) throw failure;
      const session = (sessionId: string) => {
        const found = world.sessions.find((item) => item.id === sessionId);
        if (!found) throw new McpToolError("Session not found");
        return found;
      };
      const collection = (collectionId: string) => {
        const found = world.collections.find((item) => item.id === collectionId);
        if (!found) throw new McpToolError("Collection not found");
        return found;
      };
      const project = (projectId: string) => {
        const found = world.projects.find((item) => item.id === projectId);
        if (!found) throw new McpToolError("Project not found");
        return found;
      };
      const batch = (batchId: string) => {
        const found = world.batches.find((item) => item.id === batchId);
        if (!found) throw new McpToolError("Batch not found");
        return found;
      };
      const pin = (sessionId: string, pinId: string) => {
        session(sessionId);
        const found = world.pins.find((item) => item.sessionId === sessionId && item.id === pinId);
        if (!found) throw new McpToolError("Pin not found");
        return found;
      };
      const comment = (sessionId: string, pinId: string, commentId: string) => {
        pin(sessionId, pinId);
        const found = world.comments.find((item) => item.sessionId === sessionId && item.pinId === pinId && item.id === commentId);
        if (!found) throw new McpToolError("Comment not found");
        return found;
      };
      const toInbox = (collectionIds: string[]) => {
        for (const item of world.sessions) {
          if (collectionIds.includes(item.collectionId)) item.collectionId = INBOX_ID;
        }
      };
      switch (name) {
        case "pinar.create_project": {
          const created = { id: newId("project"), name: text(args, "name") };
          world.projects.push(created);
          return { ok: true, project: { ...created } };
        }
        case "pinar.rename_project": {
          project(text(args, "projectId")).name = text(args, "name");
          return { ok: true };
        }
        case "pinar.reorder_projects": {
          const order = ids(args, "ids");
          if (!sameMembers(order, world.projects.map((item) => item.id))) throw new McpToolError("Invalid ordering");
          world.projects = order.map((projectId) => project(projectId));
          return { ok: true };
        }
        case "pinar.delete_project": {
          const projectId = text(args, "projectId");
          project(projectId);
          const removed = world.collections.filter((item) => item.projectId === projectId).map((item) => item.id);
          toInbox(removed);
          world.collections = world.collections.filter((item) => item.projectId !== projectId);
          world.projects = world.projects.filter((item) => item.id !== projectId);
          return { ok: true };
        }
        case "pinar.create_collection": {
          const projectId = text(args, "projectId");
          project(projectId);
          const created = { id: newId("collection"), name: text(args, "name"), parentId: typeof args.parentId === "string" ? args.parentId : null, projectId };
          world.collections.push(created);
          return { collection: { ...created }, ok: true };
        }
        case "pinar.rename_collection": {
          collection(text(args, "collectionId")).name = text(args, "name");
          return { collection: {}, ok: true };
        }
        case "pinar.reorder_collections": {
          const projectId = text(args, "projectId");
          project(projectId);
          const items = args.items as Array<{ id: string; parentId: string | null }>;
          const members = world.collections.filter((item) => item.projectId === projectId);
          if (!sameMembers(items.map((item) => item.id), members.map((item) => item.id))) throw new McpToolError("Invalid ordering");
          const ordered = items.map((item) => ({ ...collection(item.id), parentId: item.parentId ?? null }));
          world.collections = [...world.collections.filter((item) => item.projectId !== projectId), ...ordered];
          return { ok: true };
        }
        case "pinar.delete_collection": {
          const collectionId = text(args, "collectionId");
          collection(collectionId);
          toInbox([collectionId]);
          world.collections = world.collections.filter((item) => item.id !== collectionId);
          return { ok: true };
        }
        case "pinar.move_session": {
          const moved = session(text(args, "sessionId"));
          collection(text(args, "collectionId"));
          world.sessions = [...world.sessions.filter((item) => item !== moved), { ...moved, collectionId: text(args, "collectionId") }];
          return { ok: true, session: { id: moved.id } };
        }
        case "pinar.reorder_sessions": {
          const collectionId = text(args, "collectionId");
          collection(collectionId);
          const order = ids(args, "ids");
          const members = world.sessions.filter((item) => item.collectionId === collectionId).map((item) => item.id);
          if (!sameMembers(order, members)) throw new McpToolError("Invalid ordering");
          world.sessions = [...world.sessions.filter((item) => item.collectionId !== collectionId), ...order.map((sessionId) => session(sessionId))];
          return { ok: true };
        }
        case "pinar.create_session": {
          const page = args.page as { title: string };
          const collectionId = typeof args.collectionId === "string" ? collection(args.collectionId).id : INBOX_ID;
          const created = { batchId: typeof args.batchId === "string" ? batch(args.batchId).id : null, collectionId, id: newId("session"), title: page.title };
          world.sessions.push(created);
          return { ok: true, session: { id: created.id, title: created.title } };
        }
        case "pinar.update_session": {
          const page = args.page as { title?: string } | undefined;
          const target = session(text(args, "sessionId"));
          if (page?.title) target.title = page.title;
          return { ok: true };
        }
        case "pinar.delete_session": {
          const sessionId = session(text(args, "sessionId")).id;
          world.sessions = world.sessions.filter((item) => item.id !== sessionId);
          world.pins = world.pins.filter((item) => item.sessionId !== sessionId);
          world.comments = world.comments.filter((item) => item.sessionId !== sessionId);
          return { ok: true };
        }
        case "pinar.create_batch": {
          const created = { finishedAt: null, id: newId("batch"), label: text(args, "label") };
          world.batches.push(created);
          return { batch: { ...created }, ok: true };
        }
        case "pinar.rename_batch": {
          batch(text(args, "batchId")).label = text(args, "label");
          return { batch: {}, ok: true };
        }
        case "pinar.finish_batch": {
          batch(text(args, "batchId")).finishedAt = "2026-10-17T00:00:00.000Z";
          return { ok: true };
        }
        case "pinar.delete_batch": {
          const batchId = batch(text(args, "batchId")).id;
          world.batches = world.batches.filter((item) => item.id !== batchId);
          for (const item of world.sessions) if (item.batchId === batchId) item.batchId = null;
          return { ok: true };
        }
        case "pinar.create_pin": {
          const sessionId = session(text(args, "sessionId")).id;
          const number = Math.max(0, ...world.pins.filter((item) => item.sessionId === sessionId).map((item) => item.number)) + 1;
          const created = { comment: text(args, "comment"), id: newId("pin"), number, sessionId };
          world.pins.push(created);
          return { ok: true, pin: { comment: created.comment, id: created.id, number }, sessionId };
        }
        case "pinar.edit_pin_note": {
          pin(text(args, "sessionId"), text(args, "pinId")).comment = text(args, "comment");
          return { ok: true };
        }
        case "pinar.delete_pin": {
          const target = pin(text(args, "sessionId"), text(args, "pinId"));
          world.pins = world.pins.filter((item) => item !== target);
          world.comments = world.comments.filter((item) => !(item.sessionId === target.sessionId && item.pinId === target.id));
          return { ok: true };
        }
        case "pinar.conclude_pin":
        case "pinar.reopen_pin": {
          pin(text(args, "sessionId"), text(args, "pinId"));
          return { ok: true };
        }
        case "pinar.add_pin_comment": {
          const target = pin(text(args, "sessionId"), text(args, "pinId"));
          const created = { body: text(args, "body"), id: newId("comment"), pinId: target.id, sessionId: target.sessionId };
          world.comments.push(created);
          return { comment: { body: created.body, id: created.id }, ok: true };
        }
        case "pinar.edit_pin_comment": {
          comment(text(args, "sessionId"), text(args, "pinId"), text(args, "commentId")).body = text(args, "body");
          return { comment: {}, ok: true };
        }
        case "pinar.delete_pin_comment": {
          const target = comment(text(args, "sessionId"), text(args, "pinId"), text(args, "commentId"));
          world.comments = world.comments.filter((item) => item !== target);
          return { ok: true };
        }
        case "pinar.publish_share":
        case "pinar.revoke_share": {
          const share = world.shares.find((item) => item.resourceType === args.resourceType && item.resourceId === args.resourceId);
          if (!share) throw new McpToolError("Resource not found");
          share.active = name === "pinar.publish_share";
          return { ok: true };
        }
        default:
          throw new McpToolError(`Unknown tool ${name}`);
      }
    },
  };
  return host;
}
