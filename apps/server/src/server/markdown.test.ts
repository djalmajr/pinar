import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ProjectTreeProject, Session } from "@pinar/shared";
import { formatBatchMarkdown, formatProjectMarkdown, formatSessionMarkdown } from "./markdown";

describe("aggregate markdown", () => {
  test("preserves manual collection, session, and pin order with live links", () => {
    // Mutation captured: sorting by creation date changes the explicit order encoded by the tree.
    const project: ProjectTreeProject = {
      collections: [{
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "collection-one",
        isProtected: false,
        name: "Review",
        ownerId: "owner",
        parentId: null,
        position: 0,
        projectId: "project-one",
        sessions: [{
          collectionId: "collection-one",
          createdAt: "2026-01-02T00:00:00.000Z",
          id: "session-two",
          page: { title: "Second capture", url: "https://example.test/second" },
          pins: [
            { comment: "First pin", coords: { x: 1, y: 2 }, number: 1, type: "point" },
            { comment: "Second pin", coords: { x: 3, y: 4 }, number: 2, type: "point" },
          ],
          position: 0,
        }],
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "project-one",
      icon: "rocket",
      isProtected: false,
      name: "Website",
      ownerId: "owner",
      position: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const markdown = formatProjectMarkdown(project, "https://pinar.test");

    assert.match(markdown, /Project viewer: https:\/\/pinar\.test\/p\/project-one/);
    assert.match(markdown, /## \[Review\]\(https:\/\/pinar\.test\/c\/collection-one\)/);
    assert.match(markdown, /### \[Second capture\]\(https:\/\/pinar\.test\/v\/session-two\)/);
    assert.ok(markdown.indexOf("1. First pin") < markdown.indexOf("2. Second pin"));
  });

  test("omits screenshots from collection markdown when includeScreenshot is false", () => {
    const project: ProjectTreeProject = {
      collections: [{
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "collection-one",
        isProtected: false,
        name: "Review",
        ownerId: "owner",
        parentId: null,
        position: 0,
        projectId: "project-one",
        sessions: [{
          collectionId: "collection-one",
          createdAt: "2026-01-02T00:00:00.000Z",
          id: "session-two",
          includeScreenshot: false,
          page: { title: "Second capture", url: "https://example.test/second" },
          pins: [{ comment: "First pin", coords: { x: 1, y: 2 }, number: 1, type: "point" }],
          position: 0,
          shotUrl: "https://pinar.test/shots/session-two.png",
        }],
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "project-one",
      icon: "rocket",
      isProtected: false,
      name: "Website",
      ownerId: "owner",
      position: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const markdown = formatProjectMarkdown(project, "https://pinar.test");
    assert.match(markdown, /Markdown: https:\/\/pinar\.test\/v\/session-two\.md/);
    assert.doesNotMatch(markdown, /Screenshot:/);
  });

  test("omits the screenshot from item markdown when includeScreenshot is false", () => {
    const session: Session = {
      createdAt: "2026-01-02T00:00:00.000Z",
      id: "session-two",
      includeScreenshot: false,
      page: { title: "Second capture", url: "https://example.test/second" },
      pins: [{ comment: "First pin", coords: { x: 1, y: 2 }, number: 1, type: "point" }],
      shotUrl: "https://pinar.test/shots/session-two.png",
    };
    const markdown = formatSessionMarkdown(session, "https://pinar.test/v/session-two");
    assert.match(markdown, /Viewer: https:\/\/pinar\.test\/v\/session-two/);
    assert.match(markdown, /First pin/);
    assert.doesNotMatch(markdown, /Screenshot:/);
    assert.doesNotMatch(markdown, /screenshot_missing/);
  });

  test("live delivery preference overrides a session stamp", () => {
    const session: Session = {
      createdAt: "2026-01-02T00:00:00.000Z",
      id: "session-two",
      includeScreenshot: true,
      page: { title: "Second capture", url: "https://example.test/second" },
      pins: [{ comment: "First pin", coords: { x: 1, y: 2 }, number: 1, type: "point" }],
      shotUrl: "https://pinar.test/shots/session-two.png",
    };
    const markdown = formatSessionMarkdown(
      session,
      "https://pinar.test/v/session-two",
      [],
      [],
      { includeScreenshot: false },
    );
    assert.match(markdown, /First pin/);
    assert.doesNotMatch(markdown, /Screenshot:/);
    assert.doesNotMatch(markdown, /screenshot_missing/);
  });
});

describe("batch markdown", () => {
  const batch = { id: "batch-1", label: "Batch · test" };
  const session = (id: string, pinId: string, comment: string): Session => ({
    createdAt: "2026-01-02T00:00:00.000Z",
    id,
    includeScreenshot: true,
    page: { title: id, url: `https://example.test/${id}` },
    pins: [{ comment, coords: { x: 1, y: 2 }, number: 1, pinId, type: "point" }],
    shotUrl: `https://pinar.test/shots/${id}.png`,
  });

  test("carries only the pins the agent is still expected to act on", () => {
    const sessions = [session("one", "pin-open", "still open"), session("two", "pin-done", "already accepted")];
    const markdown = formatBatchMarkdown(batch, sessions, { "pin-done": "accepted" }, "https://pinar.test");
    assert.match(markdown, /still open/);
    assert.doesNotMatch(markdown, /already accepted/);
    // A session left with no pending pin is dropped whole, not left as an empty heading.
    assert.doesNotMatch(markdown, /\/v\/two/);
  });

  test("treats an untriaged pin as open and a reopened one as pending", () => {
    const sessions = [session("one", "pin-new", "never triaged"), session("two", "pin-back", "reopened work")];
    const markdown = formatBatchMarkdown(batch, sessions, { "pin-back": "reopened" }, "https://pinar.test");
    assert.match(markdown, /never triaged/);
    assert.match(markdown, /reopened work/);
  });

  test("says so instead of handing over an empty document", () => {
    const markdown = formatBatchMarkdown(batch, [session("one", "pin-done", "done")], { "pin-done": "accepted" }, "https://pinar.test");
    assert.match(markdown, /No pins are waiting/);
  });

  test("honours the screenshot delivery preference like every other export", () => {
    const sessions = [session("one", "pin-open", "open pin")];
    const withShot = formatBatchMarkdown(batch, sessions, {}, "https://pinar.test");
    assert.match(withShot, /"screenshot":\{"url":"https:\/\/pinar.test\/shots\/one.png"\}/);
    assert.match(withShot, /Numbered screenshot badges/);
    const withoutShot = formatBatchMarkdown(batch, sessions, {}, "https://pinar.test", { includeScreenshot: false });
    assert.doesNotMatch(withoutShot, /shots\/one.png/);
    assert.doesNotMatch(withoutShot, /Numbered screenshot badges/);
  });

  test("is an agent handoff in the same shape as a single capture, one fence per page", () => {
    const sessions = [session("one", "pin-a", "first page"), session("two", "pin-b", "second page")];
    const markdown = formatBatchMarkdown(batch, sessions, {}, "https://pinar.test");
    assert.match(markdown, /^# Batch · test\n/);
    assert.match(markdown, /The pin notes below, across 2 pages, may ask for a change or an explanation\. Use selector and DOM path/);
    assert.equal(markdown.match(/```pinar-visual-context/g)?.length, 2);
    // Each fence is a parseable capture that keeps its own identity.
    const fences = [...markdown.matchAll(/```pinar-visual-context\n(.*)\n```/g)].map((m) => JSON.parse(m[1]));
    assert.deepEqual(fences.map((f) => f.captureId), ["one", "two"]);
    assert.deepEqual(fences.map((f) => f.pins[0].pinId), ["pin-a", "pin-b"]);
    assert.equal(fences[0].pins[0].comment, "first page");
    // The per-page full-context link sits above its own fence.
    assert.match(markdown, /## one\nFull context \(fetch only if the details above are insufficient\): https:\/\/pinar.test\/v\/one.md/);
  });

  test("full handoff mode carries the complete pin rather than the compact projection", () => {
    const sessions = [session("one", "pin-a", "first page")];
    const compact = formatBatchMarkdown(batch, sessions, {}, "https://pinar.test");
    const full = formatBatchMarkdown(batch, sessions, {}, "https://pinar.test", { handoffMode: "full" });
    assert.doesNotMatch(compact, /"number":1/);
    assert.match(full, /"number":1/);
  });

  test("localizes instruction lines while keeping the JSON fence identical", () => {
    const sessions = [session("one", "pin-a", "first page")];
    const en = formatBatchMarkdown(batch, sessions, {}, "https://pinar.test");
    const pt = formatBatchMarkdown(batch, sessions, {}, "https://pinar.test", { language: "pt" });
    assert.match(pt, /As notas dos pins abaixo, em 1 páginas, podem pedir uma alteração ou uma explicação/);
    const fences = (markdown: string) => [...markdown.matchAll(/```pinar-visual-context\n[\s\S]*?\n```/g)].map((match) => match[0]);
    assert.deepEqual(fences(pt), fences(en));
  });
});
