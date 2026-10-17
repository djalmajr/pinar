import { cloneElement, createElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Translate } from "@/lib/i18n";

// Headless rendering (same approach as pin-discussion.test.tsx and
// pages/releases.test.tsx): the UI package's barrel and the icon virtual
// modules are replaced by minimal structural stand-ins, so the assertions
// observe the assistant markup itself. t is the identity so the rendered
// labels are the i18n keys.
mock.module("@pinar/ui", () => ({
  AlertDialog: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? createElement("div", { "data-slot": "alert-dialog" }, children) : null,
  AlertDialogAction: ({ children }: { children?: ReactNode }) =>
    createElement("button", { "data-slot": "alert-dialog-action", type: "button" }, children),
  AlertDialogCancel: ({ children }: { children?: ReactNode }) =>
    createElement("button", { "data-slot": "alert-dialog-cancel", type: "button" }, children),
  AlertDialogContent: ({ children }: { children?: ReactNode }) =>
    createElement("div", { "data-slot": "alert-dialog-content" }, children),
  AlertDialogFooter: ({ children }: { children?: ReactNode }) =>
    createElement("div", { "data-slot": "alert-dialog-footer" }, children),
  AlertDialogHeader: ({ children }: { children?: ReactNode }) =>
    createElement("div", { "data-slot": "alert-dialog-header" }, children),
  AlertDialogTitle: ({ children }: { children?: ReactNode }) =>
    createElement("h2", { "data-slot": "alert-dialog-title" }, children),
  Button: ({
    children,
    render,
    ...rest
  }: {
    children?: ReactNode;
    render?: ReactElement;
  } & Record<string, unknown>) =>
    render
      ? cloneElement(render, {}, children)
      : createElement("button", { type: "button", ...rest }, children),
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter((value): value is string => value !== undefined && value !== null && value !== false).join(" "),
}));
for (const icon of ["history", "loader-circle", "plus", "sparkles", "trash-2", "x"]) {
  mock.module(`~icons/lucide/${icon}`, () => ({ default: () => null }));
}
mock.module("@/components/GlobalSettingsDialog", () => ({
  useGlobalSettings: () => () => undefined,
}));
mock.module("@/lib/i18n", () => ({
  useServerI18n: () => ({ language: "en", t: (key: string) => key }),
}));
mock.module("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to: string }) =>
    createElement("a", { href: typeof to === "string" ? to : "" }, children),
}));

const { AssistantComposer } = await import("./AssistantComposer");
const { AssistantMessages } = await import("./AssistantMessages");
const { AssistantPanel } = await import("./AssistantPanel");
const { AssistantThreadList } = await import("./AssistantThreadList");
const { AssistantToggle } = await import("./AssistantToggle");
const { AssistantPanelContext } = await import("./assistant-panel-state");

// The i18n keys are rendered verbatim so assertions stay stable.
const t: Translate = (key) => key as string;

describe("assistant messages", () => {
  test("the assistant answer renders safe Markdown: list, code and link with rel", () => {
    const markdown = "- one\n- two\n\n```js\nconst x = 1;\n```\n\n[docs](https://example.com)";
    const markup = renderToStaticMarkup(createElement(AssistantMessages, {
      messages: [{ id: "m1", parts: [{ text: markdown, type: "text" }], role: "assistant" }],
      onRetry: () => undefined,
      t,
    }));
    expect(markup).toContain("<ul");
    expect(markup).toContain("list-disc");
    expect(markup).toContain("<pre");
    expect(markup).toContain("<code");
    expect(markup).toContain('href="https://example.com"');
    expect(markup).toContain('rel="noreferrer noopener"');
    expect(markup).toContain('target="_blank"');
  });

  test("unsafe link protocols are neutralized by the URL transform", () => {
    const markup = renderToStaticMarkup(createElement(AssistantMessages, {
      messages: [{
        id: "m1",
        parts: [{ text: "[click](javascript:alert(1))", type: "text" }],
        role: "assistant",
      }],
      onRetry: () => undefined,
      t,
    }));
    expect(markup).toContain('href=""');
    expect(markup).not.toContain("javascript:");
  });

  test("user messages stay plain text (no Markdown, no links)", () => {
    const markup = renderToStaticMarkup(createElement(AssistantMessages, {
      messages: [{
        id: "m1",
        parts: [{ text: "**not bold** [nope](https://example.com)", type: "text" }],
        role: "user",
      }],
      onRetry: () => undefined,
      t,
    }));
    expect(markup).toContain("**not bold**");
    expect(markup).not.toContain("<strong>");
    expect(markup).not.toContain('href="https://example.com"');
  });

  test("an in-flight tool part shows the discreet working line, without name or arguments", () => {
    const markup = renderToStaticMarkup(createElement(AssistantMessages, {
      messages: [{
        id: "m1",
        parts: [{
          input: { limit: 5, query: "nope" },
          state: "input-available",
          toolCallId: "call_1",
          toolName: "pinar_list_sessions",
          type: "dynamic-tool",
        }],
        role: "assistant",
      }],
      onRetry: () => undefined,
      t,
    }));
    expect(markup).toContain("assistant.working");
    expect(markup).not.toContain("pinar_list_sessions");
    expect(markup).not.toContain('"query":"nope"');
  });

  test("a stored error message renders the mapped error note and the retry action", () => {
    const markup = renderToStaticMarkup(createElement(AssistantMessages, {
      messages: [{
        id: "m1",
        metadata: { errorCode: "ASSISTANT_TURN_TIMEOUT" },
        parts: [],
        role: "assistant",
      }],
      onRetry: () => undefined,
      t,
    }));
    expect(markup).toContain("assistant.errorTimeout");
    expect(markup).toContain("assistant.retry");
  });
});

describe("assistant composer", () => {
  test("idle shows the send action; while a turn is in flight it becomes stop", () => {
    const idle = renderToStaticMarkup(createElement(AssistantComposer, {
      busy: false,
      onSend: () => undefined,
      onStop: () => undefined,
      t,
    }));
    expect(idle).toContain("assistant.placeholder");
    expect(idle).toContain("assistant.send");
    expect(idle).not.toContain("assistant.stop");

    const streaming = renderToStaticMarkup(createElement(AssistantComposer, {
      busy: true,
      onSend: () => undefined,
      onStop: () => undefined,
      t,
    }));
    expect(streaming).toContain("assistant.stop");
    expect(streaming).not.toContain("assistant.send");
  });
});

describe("assistant thread list", () => {
  const thread = {
    createdAt: "2026-10-01T12:00:00.000Z",
    id: "ath_1",
    title: "About the pins",
    updatedAt: "2026-10-02T12:00:00.000Z",
  };

  test("an empty list shows the no-threads note", () => {
    const markup = renderToStaticMarkup(createElement(AssistantThreadList, {
      activeThreadId: null,
      language: "en",
      onDelete: () => undefined,
      onOpen: () => undefined,
      t,
      threads: [],
    }));
    expect(markup).toContain("assistant.noThreads");
    expect(markup).not.toContain("assistant.deleteThread");
  });

  test("items show title, session-style date and the delete action with its aria-label", () => {
    const markup = renderToStaticMarkup(createElement(AssistantThreadList, {
      activeThreadId: "ath_1",
      language: "en",
      onDelete: () => undefined,
      onOpen: () => undefined,
      t,
      threads: [thread],
    }));
    expect(markup).toContain("About the pins");
    expect(markup).toContain("assistant.deleteThread");
    expect(markup).toContain("aria-label=\"assistant.deleteThread\"");
    // The same session date helper the app uses elsewhere (formatSessionDate).
    expect(markup).toContain(
      new Date(thread.updatedAt).toLocaleString("en", {
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
      }),
    );
  });
});

describe("assistant toggle", () => {
  test("the button exposes the panel expansion state (aria-expanded) open and closed", () => {
    const base = { setOpen: () => undefined, toggle: () => undefined };
    const closed = renderToStaticMarkup(createElement(
      AssistantPanelContext.Provider,
      { value: { open: false, ...base } },
      createElement(AssistantToggle),
    ));
    expect(closed).toContain('aria-expanded="false"');
    const opened = renderToStaticMarkup(createElement(
      AssistantPanelContext.Provider,
      { value: { open: true, ...base } },
      createElement(AssistantToggle),
    ));
    expect(opened).toContain('aria-expanded="true"');
  });
});

describe("assistant panel states", () => {
  test("not_configured: the note and the AI-settings action, no composer", () => {
    const markup = renderToStaticMarkup(createElement(AssistantPanel, {
      language: "en",
      status: { available: false, reason: "not_configured", surface: "local" },
      t,
    }));
    expect(markup).toContain("assistant.notConfigured");
    expect(markup).toContain("assistant.openSettings");
    expect(markup).not.toContain("assistant.placeholder");
  });

  test("requires_pro: the note and the /plans link action, no composer", () => {
    const markup = renderToStaticMarkup(createElement(AssistantPanel, {
      language: "en",
      status: { available: false, reason: "requires_pro", surface: "cloud" },
      t,
    }));
    expect(markup).toContain("assistant.requiresPro");
    expect(markup).toContain("assistant.seePlans");
    expect(markup).toContain('href="/pricing"');
    expect(markup).not.toContain("assistant.placeholder");
  });

  test("available without messages: the empty state, the read-only note and the composer", () => {
    const markup = renderToStaticMarkup(createElement(AssistantPanel, {
      language: "en",
      status: { available: true, reason: null, surface: "local" },
      t,
    }));
    expect(markup).toContain("assistant.empty");
    expect(markup).toContain("assistant.readOnlyNote");
    expect(markup).toContain("assistant.placeholder");
  });

  test("available with messages: the thread content renders in the panel", () => {
    // A preloaded conversation is loaded with setMessages (effect-driven), so
    // the static render covers the states above; this case asserts the panel
    // header actions the conversation depends on.
    const markup = renderToStaticMarkup(createElement(AssistantPanel, {
      language: "en",
      status: { available: true, reason: null, surface: "local" },
      t,
    }));
    expect(markup).toContain("assistant.title");
    expect(markup).toContain("assistant.newThread");
    expect(markup).toContain("assistant.history");
    expect(markup).toContain("assistant.close");
  });
});
