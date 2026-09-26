import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentExecution, PinReview, ProjectTreeProject, Session } from "@pinar/shared";
import { formatBatchMarkdown, formatProjectMarkdown, formatSessionHandoffMarkdown, formatSessionMarkdown, viewerReferenceMarkdown } from "./markdown";

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

  test("keeps the localized handoff primary before appending private reference context", () => {
    const session: Session = {
      createdAt: "2026-01-02T00:00:00.000Z",
      id: "session-two",
      page: { title: "Second capture", url: "https://example.test/second" },
      pins: [{ comment: "First pin", coords: { x: 1, y: 2 }, number: 1, type: "point" }],
    };
    const compact = formatSessionHandoffMarkdown(session, "https://pinar.test/v/session-two", [], [], {
      includeViewerContent: true,
      language: "en",
      handoffMode: "compact",
    });
    const fullPortuguese = formatSessionHandoffMarkdown(session, "https://pinar.test/v/session-two", [], [], {
      includeViewerContent: true,
      language: "pt",
      handoffMode: "full",
    });
    assert.match(compact, /The pin notes below may ask for a change or an explanation/);
    assert.doesNotMatch(compact.split("## Reference only: full viewer Markdown")[0], /"number":1/);
    assert.match(fullPortuguese, /As notas dos pins abaixo podem pedir uma alteração ou uma explicação/);
    assert.match(fullPortuguese.split("## Reference only: full viewer Markdown")[0], /"number":1/);
  });

  test("renames unexpected visual-context fence variants without dropping their payload", () => {
    const converted = viewerReferenceMarkdown("```pinar-visual-context-v1\r\nline one\r\nline two\r\n```");
    assert.match(converted, /```pinar-viewer-reference/);
    assert.match(converted, /line one\r?\nline two/);
    assert.doesNotMatch(converted, /pinar-visual-context/);
  });

  test("keeps resolved pins out of the canonical single-page handoff while preserving full reference history", () => {
    const session: Session = {
      createdAt: "2026-01-02T00:00:00.000Z",
      id: "session-resolved",
      page: { title: "Resolved page", url: "https://example.test/resolved" },
      pins: [
        { comment: "Still open", coords: { x: 1, y: 2 }, id: "pin-open", number: 1, type: "point" },
        { comment: "Already accepted", coords: { x: 3, y: 4 }, id: "pin-done", number: 2, type: "point" },
      ],
    };
    const inline = formatSessionHandoffMarkdown(session, "https://pinar.test/v/session-resolved", [{
      agent: "codex",
      captureId: session.id,
      createdAt: "2026-01-03T00:00:00.000Z",
      id: "execution-resolved",
      idempotencyKey: "execution_resolved",
      results: [{
        createdAt: "2026-01-03T00:00:00.000Z",
        files: [],
        pinId: "pin-done",
        status: "changed",
        summary: "Resolved result",
      }],
    }], [{
      actions: ["accept"],
      pinId: "pin-done",
      status: "accepted",
      timeline: [],
      updatedAt: "2026-01-03T00:00:00.000Z",
    }], { includeViewerContent: true, language: "en" });
    assert.equal(inline.match(/```pinar-visual-context/g)?.length, 1);
    assert.match(inline, /Still open/);
    assert.match(inline, /## Reference only: full viewer Markdown/);
    assert.match(inline, /Already accepted/);
    assert.match(inline, /Resolved result/);
    assert.match(inline, /status: accepted/);
    assert.match(inline, /```pinar-viewer-reference/);
    assert.match(inline, /"referenceOnly":true/);
    assert.doesNotMatch(inline.split("## Reference only: full viewer Markdown")[1], /```pinar-visual-context/);
    const compactDefault = formatSessionHandoffMarkdown(session, "https://pinar.test/v/session-resolved", [], [{
      actions: ["accept"],
      pinId: "pin-done",
      status: "accepted",
      timeline: [],
      updatedAt: "2026-01-03T00:00:00.000Z",
    }], { includeViewerContent: false });
    assert.match(compactDefault, /pin-done/);
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
    // A batch has one shared context hint, with page links ordered before the capture blocks.
    assert.equal(markdown.match(/Full context by page \(open only if the details below are insufficient\):/g)?.length, 1);
    assert.match(markdown, /Full context by page \(open only if the details below are insufficient\):\n1\. https:\/\/pinar.test\/v\/one.md\n2\. https:\/\/pinar.test\/v\/two.md/);
    assert.ok(markdown.indexOf("2. https://pinar.test/v/two.md") < markdown.indexOf("## one"));
    assert.doesNotMatch(markdown, /## one\nFull context/);
  });

  test("full handoff mode carries the complete pin rather than the compact projection", () => {
    const sessions = [session("one", "pin-a", "first page")];
    const compact = formatBatchMarkdown(batch, sessions, {}, "https://pinar.test");
    const full = formatBatchMarkdown(batch, sessions, {}, "https://pinar.test", { handoffMode: "full" });
    assert.doesNotMatch(compact, /"number":1/);
    assert.match(full, /"number":1/);
  });

  test("can append full viewer Markdown as non-canonical reference while preserving actionable JSON blocks", () => {
    const sessions = [session("one", "pin-a", "first page"), session("two", "pin-b", "second page")];
    const executions: AgentExecution[] = [{
      agent: "codex",
      captureId: "one",
      createdAt: "2026-09-26T00:00:00.000Z",
      id: "execution-one",
      idempotencyKey: "execution_one",
      results: [{
        createdAt: "2026-09-26T00:00:00.000Z",
        files: ["src/button.tsx"],
        pinId: "pin-a",
        status: "changed",
        summary: "Updated the button",
      }],
    }];
    const reviews: PinReview[] = [{
      actions: ["accept"],
      pinId: "pin-a",
      status: "open",
      timeline: [],
      updatedAt: "2026-09-26T00:00:00.000Z",
    }, {
      actions: ["accept"],
      pinId: "pin-b",
      status: "accepted",
      timeline: [],
      updatedAt: "2026-09-26T00:00:00.000Z",
    }];
    const inline = formatBatchMarkdown(batch, sessions, {}, "https://pinar.test", {
      includeViewerContent: true,
      viewerContent: { executions: { one: executions }, reviews: { one: reviews } },
    });
    assert.equal(inline.match(/```pinar-visual-context/g)?.length, 1);
    assert.match(inline, /## Reference only: full viewer Markdown/);
    assert.match(inline, /The filtered canonical blocks above are authoritative/);
    assert.match(inline, /URL: https:\/\/example\.test\/one/);
    assert.match(inline, /Viewer: https:\/\/pinar\.test\/v\/one/);
    assert.match(inline, /URL: https:\/\/example\.test\/two/);
    assert.match(inline, /captureId":"one"/);
    assert.match(inline, /pinId":"pin-a"/);
    assert.match(inline, /Updated the button/);
    assert.match(inline, /pin-a: open/);
    assert.match(inline, /```pinar-viewer-reference/);
    assert.match(inline, /"referenceOnly":true/);
    assert.doesNotMatch(inline, /token=/);
  });

  test("does not append a completed page or a second actionable fence", () => {
    const completed = formatBatchMarkdown(
      batch,
      [session("done", "pin-done", "already accepted")],
      { "pin-done": "accepted" },
      "https://pinar.test",
      {
        includeViewerContent: true,
        viewerContent: {
          executions: { done: [] },
          reviews: { done: [{ actions: ["reopen"], pinId: "pin-done", status: "accepted", timeline: [], updatedAt: "2026-09-26T00:00:00.000Z" }] },
        },
      },
    );
    assert.match(completed, /No pins are waiting/);
    assert.doesNotMatch(completed, /```pinar-visual-context/);
    assert.match(completed, /already accepted/);
    assert.match(completed, /pin-done/);
    assert.match(completed, /status: accepted/);
  });

  test("localizes the reference-only full viewer Markdown in every supported language", () => {
    const expected = {
      de: "vollständiges Viewer-Markdown",
      en: "full viewer Markdown",
      es: "Markdown completo del visor",
      fr: "Markdown complet du viewer",
      ja: "完全なビューアーMarkdown",
      pt: "Markdown completo do viewer",
      zh: "完整查看器 Markdown",
    } as const;
    for (const [language, heading] of Object.entries(expected)) {
      const localized = formatBatchMarkdown(batch, [session("one", "pin-a", "first page")], {}, "https://pinar.test", {
        includeViewerContent: true,
        language: language as keyof typeof expected,
      });
      assert.match(localized, new RegExp(heading));
    }
  });

  test("localizes instruction lines while keeping the JSON fence identical", () => {
    const sessions = [session("one", "pin-a", "first page")];
    const en = formatBatchMarkdown(batch, sessions, {}, "https://pinar.test");
    const pt = formatBatchMarkdown(batch, sessions, {}, "https://pinar.test", { language: "pt" });
    assert.match(pt, /As notas dos pins abaixo, em 1 páginas, podem pedir uma alteração ou uma explicação/);
    assert.match(pt, /Contexto completo por página \(acesse apenas se os detalhes abaixo forem insuficientes\):/);
    const fences = (markdown: string) => [...markdown.matchAll(/```pinar-visual-context\n[\s\S]*?\n```/g)].map((match) => match[0]);
    assert.deepEqual(fences(pt), fences(en));
  });
});
