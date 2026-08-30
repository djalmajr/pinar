import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ProjectTreeProject, Session } from "@pinar/shared";
import { formatProjectMarkdown, formatSessionMarkdown } from "./markdown";

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
