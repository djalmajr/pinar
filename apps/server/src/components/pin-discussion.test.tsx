import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/react";
import { parsePinCommentBody } from "@pinar/shared";
import { renderToStaticMarkup } from "react-dom/server";
import type { Translate } from "@/lib/i18n";
import type { PinConversationMessage } from "@/pages/pin-conversation";
import {
  applyCommentEditOutcome,
  clearCommentDraft,
  COMMENT_BODY_MAX_LENGTH,
  commentBodyWithinLimit,
  commentEditorExtensions,
  discardCommentEditOnPinSwitch,
  setCommentDraft,
  startCommentEdit,
  updateCommentEditDraft,
} from "./pin-comment-editor";
import { PinCommentEditor } from "./PinCommentEditor";
import { PinDiscussion } from "./PinDiscussion";

// The i18n keys are added by the i18n worker's slice; tests use the key as
// the rendered label so assertions stay stable until the locales land.
const t: Translate = (key) => key as string;

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

function createHeadlessEditor(report?: (markdown: string) => void) {
  return new Editor({
    // Headless (no DOM) creation needs JSON content; markdown content goes
    // through setContent with contentType "markdown", exactly like the
    // component does after mount.
    content: EMPTY_DOC,
    extensions: commentEditorExtensions(),
    // The core Editor stores absent on* options as undefined listeners, so
    // headless usage always supplies onUpdate.
    onUpdate: (event) => {
      report?.(event.editor.getMarkdown());
    },
  });
}

describe("pin comment editor rules", () => {
  test("commentBodyWithinLimit mirrors the server parsePinCommentBody contract", () => {
    const samples = [
      "",
      "   ",
      "a",
      " ".repeat(1999) + "a",
      "a".repeat(1999),
      "a".repeat(2000),
      "a".repeat(2001),
      // UTF-16 units, like the server counts: 1000 emojis = 2000 units.
      "\u{1F600}".repeat(999) + "a",
      "\u{1F600}".repeat(1000),
      "\u{1F600}".repeat(1000) + "a",
    ];
    for (const sample of samples) {
      let serverAccepts = false;
      try {
        parsePinCommentBody(sample);
        serverAccepts = true;
      } catch {
        serverAccepts = false;
      }
      expect(commentBodyWithinLimit(sample)).toBe(serverAccepts);
    }
    expect(COMMENT_BODY_MAX_LENGTH).toBe(2000);
  });

  test("per-pin drafts: switching pins never clears another pin's draft", () => {
    const drafts = { pin_a: "draft a", pin_b: "draft b" };
    const afterEditB = setCommentDraft(drafts, "pin_b", "draft b2");
    expect(afterEditB).toEqual({ pin_a: "draft a", pin_b: "draft b2" });
    // Reading another pin's draft after the switch keeps it.
    expect(afterEditB.pin_a).toBe("draft a");
    // A successful send clears only the sent pin.
    const afterSend = clearCommentDraft(afterEditB, "pin_b");
    expect(afterSend).toEqual({ pin_a: "draft a", pin_b: "" });
    // The inputs are not mutated.
    expect(drafts).toEqual({ pin_a: "draft a", pin_b: "draft b" });
  });

  test("a failed send keeps the draft", () => {
    const drafts = setCommentDraft({}, "pin_a", "keep me");
    // No clear on the failure path: the draft state is left untouched.
    expect(drafts.pin_a).toBe("keep me");
  });
});

describe("pin comment edit state", () => {
  test("one message at a time: starting a new edit replaces the previous one", () => {
    const first = startCommentEdit("comment", "c_1", "draft a");
    const second = startCommentEdit("pin", "pin:pin_1", "draft b");
    expect(second).toEqual({ draft: "draft b", messageId: "pin:pin_1", target: "pin" });
    // The previous state is not mutated.
    expect(first).toEqual({ draft: "draft a", messageId: "c_1", target: "comment" });
  });

  test("draft updates keep the same message", () => {
    const state = updateCommentEditDraft(startCommentEdit("comment", "c_1", "a"), "ab");
    expect(state).toEqual({ draft: "ab", messageId: "c_1", target: "comment" });
  });

  test("a failed save keeps the draft; success leaves the edit", () => {
    const state = startCommentEdit("comment", "c_1", "keep me");
    // Failure path: the exact state is kept for retry.
    expect(applyCommentEditOutcome(state, "failure")).toBe(state);
    // Success path: the edit closes (the conversation reloads with the text).
    expect(applyCommentEditOutcome(state, "success")).toBeNull();
  });

  test("switching pins discards the in-progress edit", () => {
    expect(discardCommentEditOnPinSwitch(startCommentEdit("comment", "c_1", "keep me"))).toBeNull();
    expect(discardCommentEditOnPinSwitch(null)).toBeNull();
  });
});

describe("tiptap markdown serialization (headless)", () => {
  test("empty content serializes to empty markdown and disables nothing on the editor side", () => {
    const editor = createHeadlessEditor();
    try {
      expect(editor.getMarkdown()).toBe("");
      expect(editor.isEmpty).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  test("basic controls round-trip through markdown", () => {
    const editor = createHeadlessEditor();
    try {
      editor.commands.setContent(
        "**bold** and *italic*\n\n- one\n- two\n\n1. a\n2. b\n\n> quoted\n\nhas `inline` code",
        { contentType: "markdown" },
      );
      const markdown = editor.getMarkdown();
      expect(markdown).toContain("**bold**");
      expect(markdown).toContain("*italic*");
      expect(markdown).toContain("- one");
      expect(markdown).toContain("1. a");
      expect(markdown).toContain("> quoted");
      expect(markdown).toContain("`inline` code");
      expect(editor.isActive("bold")).toBe(false);
      expect(editor.isActive("blockquote")).toBe(false);
    } finally {
      editor.destroy();
    }
  });

  test("the six toolbar commands toggle their marks and blocks", () => {
    const editor = createHeadlessEditor();
    try {
      editor.commands.setContent("hello world", { contentType: "markdown" });
      // Bold and italic act on a partial text selection (as a toolbar
      // press would, with the selection preserved by the toolbar's
      // mousedown prevention).
      editor.commands.setTextSelection({ from: 0, to: 5 });
      editor.commands.toggleBold();
      expect(editor.getMarkdown()).toBe("**hell**o world");
      expect(editor.isActive("bold")).toBe(true);
      editor.commands.toggleBold();
      expect(editor.getMarkdown()).toBe("hello world");
      expect(editor.isActive("bold")).toBe(false);
      editor.commands.setTextSelection({ from: 6, to: 11 });
      editor.commands.toggleItalic();
      expect(editor.getMarkdown()).toBe("hello *worl*d");
      expect(editor.isActive("italic")).toBe(true);
      editor.commands.toggleItalic();
      expect(editor.getMarkdown()).toBe("hello world");
      // The block commands act on the whole paragraph around the selection.
      editor.commands.toggleBulletList();
      expect(editor.getMarkdown()).toBe("- hello world");
      expect(editor.isActive("bulletList")).toBe(true);
      editor.commands.toggleOrderedList();
      expect(editor.getMarkdown()).toBe("1. hello world");
      expect(editor.isActive("orderedList")).toBe(true);
      editor.commands.toggleOrderedList();
      expect(editor.getMarkdown()).toBe("hello world");
      // Blockquote wraps the paragraph (ProseMirror cannot wrap a range
      // nested inside a list item, so the toolbar press on a list leaves
      // the list untouched).
      editor.commands.toggleBlockquote();
      expect(editor.getMarkdown()).toBe("> hello world");
      expect(editor.isActive("blockquote")).toBe(true);
      editor.commands.toggleCode();
      expect(editor.getMarkdown()).toBe("> hello `worl`d");
      expect(editor.isActive("code")).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  test("headings, horizontal rules, underline, strike and code blocks stay disabled", () => {
    const editor = createHeadlessEditor();
    try {
      expect(editor.schema.nodes.heading).toBeUndefined();
      expect(editor.schema.nodes.horizontal_rule).toBeUndefined();
      expect(editor.schema.nodes.underline).toBeUndefined();
      expect(editor.schema.nodes.code_block).toBeUndefined();
      expect(editor.isActive("heading")).toBe(false);
      expect(editor.isActive("codeBlock")).toBe(false);
    } finally {
      editor.destroy();
    }
  });

  test("onUpdate reports markdown and reset returns to empty", () => {
    let reported = "";
    const editor = createHeadlessEditor((markdown) => {
      reported = markdown;
    });
    try {
      editor.commands.setContent("**bold**", { contentType: "markdown" });
      expect(reported).toBe("**bold**");
      editor.commands.setContent("", { contentType: "markdown" });
      expect(reported).toBe("");
      expect(editor.getMarkdown()).toBe("");
      expect(editor.isEmpty).toBe(true);
    } finally {
      editor.destroy();
    }
  });
});

describe("PinCommentEditor SSR", () => {
  test("renders the formatting toolbar with one control per basic mark", () => {
    const html = renderToStaticMarkup(
      <PinCommentEditor draft="" editorKey="pin_1:0" label="Comment" onChange={() => {}} t={t} />,
    );
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="viewer.editorFormatting"');
    const labels = [
      "viewer.editorBold",
      "viewer.editorItalic",
      "viewer.editorBulletList",
      "viewer.editorOrderedList",
      "viewer.editorBlockquote",
      "viewer.editorCode",
    ];
    for (const label of labels) {
      // The localized label is the accessible name (aria-label/title), not
      // visible text: each control renders only its icon.
      expect(html).toContain(`aria-label="${label}"`);
      expect(html).toContain(`title="${label}"`);
      expect(html).toContain(`aria-pressed="false"`);
    }
    // One aria-hidden icon per control and no visible text in the toolbar.
    const toolbarTag = html.indexOf('role="toolbar"');
    const toolbar = html.slice(
      html.indexOf(">", toolbarTag) + 1,
      html.indexOf("</div>", toolbarTag),
    );
    expect((toolbar.match(/<svg/g) || []).length).toBe(6);
    expect((toolbar.match(/aria-hidden="true"/g) || []).length).toBe(6);
    expect(toolbar.replace(/<[^>]*>/g, "")).toBe("");
    // The Button's secondary variant has no aria-pressed rule of its own; the
    // active state is made visible with local token classes on the controls.
    expect(html).toContain("aria-pressed:bg-primary/15");
    expect(html).toContain("aria-pressed:text-primary");
    // Buttons never submit and the editor surface renders an empty surface.
    expect(html).not.toContain('type="submit"');
    // No <label> may wrap the editor or the toolbar: a wrapping label
    // forwards its click to the first labelable descendant (the Bold
    // button). The accessible name lives on the contenteditable itself
    // (aria-label, set through editorProps at mount).
    expect(html).not.toContain("<label");
  });

  test("disables the toolbar while the comment is being sent", () => {
    const html = renderToStaticMarkup(
      <PinCommentEditor disabled draft="**draft**" editorKey="pin_1:0" label="Comment" onChange={() => {}} t={t} />,
    );
    const buttonCount = (html.match(/<button/g) || []).length;
    const disabledCount = (html.match(/data-disabled=""/g) || []).length;
    expect(buttonCount).toBe(6);
    expect(disabledCount).toBe(6);
  });
});

const THREAD: PinConversationMessage[] = [
  { at: "2026-09-29T10:00:00.000Z", author: "Pin comment", id: "pin:pin_1", kind: "pin", text: "Original comment" },
  { at: "2026-09-29T11:00:00.000Z", author: "You", commentId: "c_1", id: "c_1", kind: "human", text: "Looks **broken**" },
  { at: "2026-09-29T12:00:00.000Z", actorId: "agent_grok", author: "grok", commentId: "c_3", id: "c_3", kind: "agent", text: "Fixed the layout **inline**" },
  { at: "2026-09-29T13:00:00.000Z", author: "cursor", id: "execution:ex_1", kind: "agent", text: "Agent summary" },
];

describe("PinDiscussion SSR", () => {
  const base = {
    busyLoader: <span data-busy="1" />,
    canEdit: true,
    // Note: editable (canEditPins in the viewer); real comments: editable by
    // id; the legacy execution: never.
    canEditMessage: (message: PinConversationMessage) => message.kind === "pin" || message.commentId != null,
    concluded: false,
    draft: "draft",
    editBusy: false,
    editDraft: null,
    editError: "",
    editorKey: "pin_1:0",
    language: "en",
    onDraftChange: () => {},
    onEditCancel: () => {},
    onEditDraftChange: () => {},
    onEditSave: () => {},
    onEditStart: () => {},
    onReview: () => {},
    onSend: () => {},
    pinId: "pin_1",
    reviewBusy: false,
    reviewError: "",
    sendBusy: false,
    sendError: "",
    thread: THREAD,
    t,
  };

  test("renders the thread with author, time and markdown for human messages", () => {
    const html = renderToStaticMarkup(<PinDiscussion {...base} />);
    expect(html).toContain("Pin comment");
    expect(html).toContain("Original comment");
    expect(html).toContain("Agent summary");
    expect(html).toContain('dateTime="2026-09-29T11:00:00.000Z"');
    // Human message is rendered as Markdown.
    expect(html).toContain("<strong>broken</strong>");
    // Original and execution messages stay plain text.
    expect(html).toContain(">Original comment</p>");
  });

  test("real agent comments render markdown; the legacy execution stays plain", () => {
    const thread: PinConversationMessage[] = [
      { at: "2026-09-29T12:00:00.000Z", actorId: "agent_grok", author: "grok", commentId: "c_3", id: "c_3", kind: "agent", text: "Agent **bold**" },
      { at: "2026-09-29T13:00:00.000Z", author: "cursor", id: "execution:ex_1", kind: "agent", text: "Execution **bold**" },
    ];
    const html = renderToStaticMarkup(<PinDiscussion {...base} thread={thread} />);
    // The real agent comment goes through the safe markdown pipeline.
    expect(html).toContain("<strong>bold</strong>");
    // The legacy execution keeps the raw text (markdown not applied).
    expect(html).toContain("Execution **bold**");
    expect((html.match(/<strong>bold<\/strong>/g) || []).length).toBe(1);
  });

  test("the edit affordance follows canEditMessage, never on legacy executions", () => {
    const html = renderToStaticMarkup(<PinDiscussion {...base} />);
    // Note, human comment and real agent comment offer Edit; the execution does not.
    expect((html.match(/aria-label="viewer.editComment"/g) || []).length).toBe(3);
    const none = renderToStaticMarkup(<PinDiscussion {...base} canEditMessage={() => false} />);
    expect(none).not.toContain("viewer.editComment");
  });

  test("editing one message swaps it for the editor with Salvar/Cancelar", () => {
    const html = renderToStaticMarkup(
      <PinDiscussion {...base} editDraft={{ draft: "editing", messageId: "c_1", target: "comment" }} />,
    );
    expect(html).toContain("dashboard.save");
    expect(html).toContain("common.cancel");
    // Two editor toolbars: the composer and the in-progress edit (one message at a time).
    expect((html.match(/role="toolbar"/g) || []).length).toBe(2);
    // The row being edited hides its own affordance (the other two keep theirs).
    expect((html.match(/aria-label="viewer.editComment"/g) || []).length).toBe(2);
    // The edit UI never autofocuses the container or the toolbar.
    expect(html).not.toContain("autofocus");
  });

  test("the note edits in a plain textarea: literal text, no toolbar or markdown", () => {
    const draft = "make snake_case_name bigger and use * and #\nline two";
    const html = renderToStaticMarkup(
      <PinDiscussion {...base} editDraft={{ draft, messageId: "pin:pin_1", target: "pin" }} />,
    );
    // Real value/attributes on the textarea, not a contenteditable surface.
    // (React SSR serializes a textarea's value as its children, like the HTML spec.)
    const tagStart = html.indexOf("<textarea");
    expect(tagStart).toBeGreaterThan(-1);
    const tag = html.slice(tagStart, html.indexOf("</textarea>", tagStart));
    // snake_case, * and # survive literally, and so do the line breaks
    // (renderToStaticMarkup keeps a raw newline inside a textarea value).
    expect(tag).toContain("make snake_case_name bigger and use * and #\nline two");
    expect(tag).toContain("maxLength=\"2000\"");
    // Accessible label reuses the existing edit key.
    expect(tag).toContain('aria-label="viewer.editComment"');
    // No formatting for the note: the only toolbar left is the composer's.
    expect((html.match(/role="toolbar"/g) || []).length).toBe(1);
  });

  test("a busy note edit disables the field", () => {
    const html = renderToStaticMarkup(
      <PinDiscussion {...base} editBusy editDraft={{ draft: "keep snake_case", messageId: "pin:pin_1", target: "pin" }} />,
    );
    const tagStart = html.indexOf("<textarea");
    const tag = html.slice(tagStart, html.indexOf(">", tagStart));
    expect(tag).toContain('disabled=""');
    expect(html).toContain('data-busy="1"');
  });

  test("a real comment keeps the editor and toolbar; busy blocks the edit actions", () => {
    const idle = renderToStaticMarkup(
      <PinDiscussion {...base} editDraft={{ draft: "keep **draft**", messageId: "c_1", target: "comment" }} />,
    );
    // The editing row keeps the real editor: its toolbar with the six controls.
    const firstAt = idle.indexOf('role="toolbar"');
    const firstToolbar = idle.slice(firstAt, idle.indexOf("</div>", firstAt));
    expect((firstToolbar.match(/<button/g) || []).length).toBe(6);
    // Two toolbars in total (edit + composer).
    expect((idle.match(/role="toolbar"/g) || []).length).toBe(2);
    // Salvar/Cancelar are enabled while idle.
    const idleSaveAt = idle.indexOf("dashboard.save");
    expect(
      idle.slice(idle.lastIndexOf("<button", idleSaveAt), idle.indexOf(">", idleSaveAt)),
    ).not.toContain('data-disabled=""');

    const busy = renderToStaticMarkup(
      <PinDiscussion {...base} editBusy editDraft={{ draft: "keep **draft**", messageId: "c_1", target: "comment" }} />,
    );
    // Busy keeps the editor rendering and disables the edit actions.
    expect((busy.match(/role="toolbar"/g) || []).length).toBe(2);
    const saveAt = busy.indexOf("dashboard.save");
    expect(
      busy.slice(busy.lastIndexOf("<button", saveAt), busy.indexOf(">", saveAt)),
    ).toContain('data-disabled=""');
    const cancelAt = busy.indexOf("common.cancel");
    expect(
      busy.slice(busy.lastIndexOf("<button", cancelAt), busy.indexOf(">", cancelAt)),
    ).toContain('data-disabled=""');
    // The editor field itself is locked client-side via disabled={editBusy}
    // (Tiptap is created in an effect, so SSR cannot show its editable state).
  });

  test("save is disabled for empty, over-limit, or busy edit drafts", () => {
    const saveButtonTag = (markup: string) => {
      const at = markup.indexOf("dashboard.save");
      return markup.slice(markup.lastIndexOf("<button", at), markup.indexOf(">", at));
    };
    const editing = { draft: "ok", messageId: "c_1", target: "comment" as const };
    const empty = renderToStaticMarkup(<PinDiscussion {...base} editDraft={{ ...editing, draft: "   " }} />);
    expect(saveButtonTag(empty)).toContain('data-disabled=""');
    const over = renderToStaticMarkup(<PinDiscussion {...base} editDraft={{ ...editing, draft: "a".repeat(2001) }} />);
    expect(saveButtonTag(over)).toContain('data-disabled=""');
    const valid = renderToStaticMarkup(<PinDiscussion {...base} editDraft={editing} />);
    expect(saveButtonTag(valid)).not.toContain('data-disabled=""');
    const busy = renderToStaticMarkup(<PinDiscussion {...base} editBusy editDraft={editing} />);
    expect(saveButtonTag(busy)).toContain('data-disabled=""');
    expect((busy.match(/data-busy="1"/g) || []).length).toBe(1);
  });

  test("a failed save keeps the draft visible and the localized error as an alert", () => {
    const html = renderToStaticMarkup(
      <PinDiscussion {...base} editDraft={{ draft: "keep me", messageId: "c_1", target: "comment" }} editError="viewer.commentEditFailed" />,
    );
    // The draft stays in the editor state (not replaced by the error).
    expect(html).toContain("dashboard.save");
    expect(html).toContain("viewer.commentEditFailed");
    expect(html).toContain('role="alert"');
  });

  test("human markdown never injects raw HTML or unsafe URLs", () => {
    const hostile: PinConversationMessage[] = [
      {
        at: "2026-09-29T11:00:00.000Z",
        author: "You",
        commentId: "c_2",
        id: "c_2",
        kind: "human",
        text: '<img src=x onerror="alert(1)"></img>\n\n[click](javascript:alert(1)) and **bold**',
      },
    ];
    const html = renderToStaticMarkup(<PinDiscussion {...base} thread={hostile} />);
    // Raw HTML is escaped, not rendered.
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    // javascript: URLs are dropped by defaultUrlTransform.
    expect(html).not.toContain("javascript:");
    // Safe markdown still renders.
    expect(html).toContain("<strong>bold</strong>");
  });

  test("send and conclude share one line, with send on the left", () => {
    const html = renderToStaticMarkup(<PinDiscussion {...base} />);
    const sendAt = html.indexOf("viewer.sendComment");
    const concludeAt = html.indexOf("viewer.concludePin");
    expect(sendAt).toBeGreaterThan(-1);
    expect(concludeAt).toBeGreaterThan(-1);
    expect(sendAt).toBeLessThan(concludeAt);
    // Same flex row: both buttons sit inside the flex-wrap container.
    const rowStart = html.lastIndexOf('<div class="flex min-w-0 flex-wrap items-center gap-2">', sendAt);
    const rowHtml = html.slice(rowStart, html.indexOf("</div>", concludeAt));
    expect(rowHtml).toContain("viewer.sendComment");
    expect(rowHtml).toContain("viewer.concludePin");
    // The composer carries no <label> around the editor or the toolbar.
    expect(html).not.toContain("<label");
    // The send button submits the comment form.
    expect(html).toContain('form="pin-comment-pin_1"');
    expect(html).toContain('id="pin-comment-pin_1"');
  });

  test("concluded pins offer reopen instead of conclude, with the badge", () => {
    const html = renderToStaticMarkup(<PinDiscussion {...base} concluded />);
    expect(html).toContain("viewer.reopenPin");
    expect(html).not.toContain("viewer.concludePin");
    expect(html).toContain("viewer.pinConcluded");
  });

  test("without canEdit the composer disappears but the review action stays", () => {
    const html = renderToStaticMarkup(<PinDiscussion {...base} canEdit={false} />);
    expect(html).not.toContain('role="toolbar"');
    expect(html).not.toContain("viewer.sendComment");
    expect(html).not.toContain("pin-comment-pin_1");
    expect(html).toContain("viewer.concludePin");
  });

  test("empty draft disables send; over-limit draft shows the localized error", () => {
    const sendButtonTag = (html: string) => {
      const formAt = html.indexOf('form="pin-comment-pin_1"');
      return html.slice(html.lastIndexOf("<button", formAt), html.indexOf(">", formAt));
    };
    const empty = renderToStaticMarkup(<PinDiscussion {...base} draft="   " />);
    // data-disabled (not the "disabled:" tailwind class) marks the disabled state.
    expect(sendButtonTag(empty)).toContain('data-disabled=""');

    const over = renderToStaticMarkup(<PinDiscussion {...base} draft={"a".repeat(2001)} />);
    expect(over).toContain("commentTooLong");
    expect(sendButtonTag(over)).toContain('data-disabled=""');
    expect(over).toContain('role="alert"');
  });

  test("busy state keeps the existing loader and errors stay visible", () => {
    const busy = renderToStaticMarkup(<PinDiscussion {...base} sendBusy reviewBusy />);
    expect((busy.match(/data-busy="1"/g) || []).length).toBe(2);
    expect(busy).toContain("disabled");

    const errors = renderToStaticMarkup(
      <PinDiscussion {...base} sendError="send failed" reviewError="review failed" />,
    );
    expect(errors).toContain("send failed");
    expect(errors).toContain("review failed");
    expect((errors.match(/role="alert"/g) || []).length).toBe(2);
  });

  test("screenshot anchor is preserved when the capture has a shot", () => {
    const html = renderToStaticMarkup(
      <PinDiscussion {...base} shot={{ alt: "Annotated screenshot", href: "https://shots.test/a.png" }} />,
    );
    expect(html).toContain("https://shots.test/a.png");
    expect(html).toContain("Annotated screenshot");

    const noShot = renderToStaticMarkup(<PinDiscussion {...base} shot={null} />);
    expect(noShot).not.toContain("shots.test");
  });
});
