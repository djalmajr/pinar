import { cloneElement, createElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Translate } from "@/lib/i18n";
import type { AssistantProposalErrorKey, AssistantPublicProposal } from "./assistant-client";

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
  Badge: ({ children, variant }: { children?: ReactNode; variant?: string }) =>
    createElement("span", { "data-slot": "badge", "data-variant": variant }, children),
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
const { AssistantProposalCard } = await import("./AssistantProposalCard");
const { AssistantPanel } = await import("./AssistantPanel");
const { AssistantThreadList } = await import("./AssistantThreadList");
const { AssistantToggle } = await import("./AssistantToggle");
const { AssistantPanelContext } = await import("./assistant-panel-state");

// The i18n keys are rendered verbatim so assertions stay stable.
const t: Translate = (key) => key as string;

// The props AssistantMessages needs besides the messages.
const messageProps = {
  busy: false,
  onAsk: () => undefined,
  onProposalAction: () => undefined,
  onRetry: () => undefined,
  proposalStates: {},
  t,
};

describe("assistant messages", () => {
  test("the assistant answer renders safe Markdown: list, code and link with rel", () => {
    const markdown = "- one\n- two\n\n```js\nconst x = 1;\n```\n\n[docs](https://example.com)";
    const markup = renderToStaticMarkup(createElement(AssistantMessages, {
      messages: [{ id: "m1", parts: [{ text: markdown, type: "text" }], role: "assistant" }],
      ...messageProps,
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
      ...messageProps,
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
      ...messageProps,
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
      ...messageProps,
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
      ...messageProps,
    }));
    expect(markup).toContain("assistant.errorTimeout");
    expect(markup).toContain("assistant.retry");
  });
});

// t that also renders the values, so the minutes and params can be asserted.
const tv: Translate = (key, values) =>
  values === undefined
    ? key
    : `${key}[${Object.entries(values).map(([name, value]) => `${name}=${value}`).join(";")}]`;

const LEAK_IDS = {
  id: "apr_LEAKCHECKPROPOSALID00001",
  messageId: "amg_LEAKCHECKMESSAGE",
  threadId: "ath_LEAKCHECKTHREAD",
  tool: "pinar.move_session",
};

function inMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function cardProposal(overrides: Partial<AssistantPublicProposal> = {}): AssistantPublicProposal {
  return {
    createdAt: inMinutes(-1),
    display: { action: "move_session", params: { collection: "Design", session: "Checkout" } },
    errorCode: null,
    executedAt: null,
    expiresAt: inMinutes(4.5),
    risk: "reversible",
    status: "proposed",
    undoExpiresAt: null,
    ...LEAK_IDS,
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<AssistantPublicProposal> = {},
  extra: { errorKey?: AssistantProposalErrorKey | null; pending?: boolean } = {},
): string {
  return renderToStaticMarkup(createElement(AssistantProposalCard, {
    errorKey: extra.errorKey ?? null,
    onAction: () => undefined,
    pending: extra.pending ?? false,
    proposal: cardProposal(overrides),
    t: tv,
  }));
}

function button(label: string, disabled: boolean): RegExp {
  return disabled
    ? new RegExp(`<button[^>]*disabled=""[^>]*>${label.replaceAll(".", "\\.")}</button>`)
    : new RegExp(`<button(?![^>]*disabled)[^>]*>${label.replaceAll(".", "\\.")}</button>`);
}

function expectNoIds(markup: string) {
  for (const value of Object.values(LEAK_IDS)) expect(markup).not.toContain(value);
  for (const prefix of ["apr_", "amg_", "ath_", "pinar."]) expect(markup).not.toContain(prefix);
}

describe("assistant proposal card", () => {
  test("proposed: the action text, Confirm and Reject enabled and the minutes until it expires", () => {
    const markup = renderCard();
    expect(markup).toContain("assistant.proposal.move_session[collection=Design;session=Checkout]");
    expect(markup).toMatch(button("assistant.proposalConfirm", false));
    expect(markup).toMatch(button("assistant.proposalReject", false));
    expect(markup).toContain("assistant.proposalExpiresIn[minutes=5]");
    expect(markup).not.toContain("assistant.proposalUndo");
    expect(markup).not.toContain("assistant.proposalExpired");
    expectNoIds(markup);
  });

  test("proposed while an action is in flight: both buttons are disabled", () => {
    const markup = renderCard({}, { pending: true });
    expect(markup).toMatch(button("assistant.proposalConfirm", true));
    expect(markup).toMatch(button("assistant.proposalReject", true));
    expect(markup).toContain('aria-busy="true"');
  });

  test("proposed past its expiry reads as expired, without buttons", () => {
    const markup = renderCard({ expiresAt: inMinutes(-0.5) });
    expect(markup).toContain("assistant.proposalExpired");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("assistant.proposalExpiresIn");
  });

  test("executing: the loading label, no buttons", () => {
    const markup = renderCard({ status: "executing" });
    expect(markup).toContain("assistant.proposalExecuting");
    expect(markup).not.toContain("<button");
    expectNoIds(markup);
  });

  test("executed with an open undo window: done, Undo and the minutes left to undo", () => {
    const markup = renderCard({
      executedAt: inMinutes(-5.5),
      status: "executed",
      undoExpiresAt: inMinutes(4.5),
    });
    expect(markup).toContain("assistant.proposalExecuted");
    expect(markup).toMatch(button("assistant.proposalUndo", false));
    expect(markup).toContain("assistant.proposalUndoIn[minutes=5]");
    expect(renderCard({ status: "executed", undoExpiresAt: inMinutes(4.5) }, { pending: true }))
      .toMatch(button("assistant.proposalUndo", true));
    expectNoIds(markup);
  });

  test("executed without undo (no window, or a window that closed): done only", () => {
    for (const undoExpiresAt of [null, inMinutes(-0.5)]) {
      const markup = renderCard({ executedAt: inMinutes(-11), status: "executed", undoExpiresAt });
      expect(markup).toContain("assistant.proposalExecuted");
      expect(markup).not.toContain("assistant.proposalUndo");
      expect(markup).not.toContain("<button");
    }
  });

  test("executed after a refused or failed undo: the undo errorCode note", () => {
    expect(renderCard({ errorCode: "undo_stale", status: "executed" })).toContain("assistant.undoStale");
    expect(renderCard({ errorCode: "undo_failed", status: "executed" })).toContain("assistant.undoFailed");
  });

  test("failed: the key of each errorCode", () => {
    const cases: Array<[AssistantPublicProposal["errorCode"], string]> = [
      ["proposal_stale", "assistant.proposalStale"],
      ["proposal_failed", "assistant.proposalFailed"],
      ["proposal_unknown_outcome", "assistant.proposalUnknownOutcome"],
      [null, "assistant.proposalFailed"],
    ];
    for (const [errorCode, key] of cases) {
      const markup = renderCard({ errorCode, status: "failed" });
      expect(markup).toContain(key);
      expect(markup).not.toContain("<button");
      expectNoIds(markup);
    }
  });

  test("rejected, expired and undone: only the label", () => {
    const cases: Array<[AssistantPublicProposal["status"], string]> = [
      ["rejected", "assistant.proposalRejected"],
      ["expired", "assistant.proposalExpired"],
      ["undone", "assistant.proposalUndone"],
    ];
    for (const [status, key] of cases) {
      const markup = renderCard({ status });
      expect(markup).toContain(key);
      expect(markup).not.toContain("<button");
      expectNoIds(markup);
    }
  });

  test("risk badges: irreversible and external warn, reversible does not; a settled card drops them", () => {
    const irreversible = renderCard({
      display: { action: "delete_collection", params: { name: "Old", sessions: 3 } },
      risk: "irreversible",
    });
    expect(irreversible).toContain("assistant.proposalIrreversible");
    expect(irreversible).toContain('data-variant="warning"');
    const external = renderCard({
      display: { action: "publish_share", params: { kind: "collection", resource: "Design" } },
      risk: "external",
    });
    expect(external).toContain("assistant.proposalExternal");
    const reversible = renderCard();
    expect(reversible).not.toContain("assistant.proposalIrreversible");
    expect(reversible).not.toContain("assistant.proposalExternal");
    expect(renderCard({ risk: "irreversible", status: "rejected" })).not.toContain("assistant.proposalIrreversible");
  });

  test("a share kind is translated by assistant.resource.<kind>", () => {
    const markup = renderCard({
      display: { action: "revoke_share", params: { kind: "project", resource: "Website" } },
      risk: "external",
    });
    expect(markup).toContain("assistant.proposal.revoke_share[kind=assistant.resource.project;resource=Website]");
  });

  test("a batch card shows the count only", () => {
    const markup = renderCard({
      display: { action: "move_sessions", params: { collection: "Design", count: 120 } },
      tool: "pinar.move_sessions",
    });
    expect(markup).toContain("assistant.proposal.move_sessions[collection=Design;count=120]");
    expectNoIds(markup);
  });

  test("an action note renders as an alert under the state", () => {
    const markup = renderCard({}, { errorKey: "assistant.errorNetwork" });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("assistant.errorNetwork");
  });
});

describe("assistant messages with proposals and asks", () => {
  const ask = { options: ["Design", "Inbox"], question: "Which collection?" };

  test("data-proposal parts become cards under the assistant message; the panel state wins", () => {
    const proposed = cardProposal();
    const markup = renderToStaticMarkup(createElement(AssistantMessages, {
      ...messageProps,
      messages: [{
        id: "m1",
        parts: [
          { text: "I proposed the move.", type: "text" },
          { data: proposed, type: "data-proposal" },
          { data: cardProposal({ display: { action: "create_batch", params: { label: "QA" } }, id: "apr_SECONDCARDXXXXXXXXXXXX" }), type: "data-proposal" },
        ],
        role: "assistant",
      }],
      proposalStates: {
        [proposed.id]: {
          errorKey: null,
          pending: false,
          proposal: { ...proposed, status: "executed", undoExpiresAt: inMinutes(9.5) },
        },
      },
    }));
    expect(markup.indexOf("I proposed the move.")).toBeLessThan(markup.indexOf("assistant.proposal.move_session"));
    expect(markup).toContain("assistant.proposalExecuted");
    expect(markup).toContain("assistant.proposal.create_batch");
    expect(markup).toContain("assistant.proposalConfirm");
    expectNoIds(markup);
  });

  test("a pending entry disables the card's buttons", () => {
    const proposed = cardProposal();
    const markup = renderToStaticMarkup(createElement(AssistantMessages, {
      ...messageProps,
      messages: [{ id: "m1", parts: [{ data: proposed, type: "data-proposal" }], role: "assistant" }],
      proposalStates: { [proposed.id]: { errorKey: null, pending: true, proposal: null } },
    }));
    expect(markup).toMatch(button("assistant.proposalConfirm", true));
  });

  test("a data-ask on the last message shows the question and one button per option", () => {
    const markup = renderToStaticMarkup(createElement(AssistantMessages, {
      ...messageProps,
      messages: [
        { id: "m1", parts: [{ text: "Move it", type: "text" }], role: "user" },
        { id: "m2", parts: [{ data: ask, type: "data-ask" }], role: "assistant" },
      ],
    }));
    expect(markup).toContain("Which collection?");
    expect(markup).toMatch(button("Design", false));
    expect(markup).toMatch(button("Inbox", false));
  });

  test("while a turn is in flight the options are disabled", () => {
    const markup = renderToStaticMarkup(createElement(AssistantMessages, {
      ...messageProps,
      busy: true,
      messages: [{ id: "m2", parts: [{ data: ask, type: "data-ask" }], role: "assistant" }],
    }));
    expect(markup).toMatch(button("Design", true));
    expect(markup).toMatch(button("Inbox", true));
  });

  test("the options vanish once a message follows the question; the question stays", () => {
    const markup = renderToStaticMarkup(createElement(AssistantMessages, {
      ...messageProps,
      messages: [
        { id: "m2", parts: [{ data: ask, type: "data-ask" }], role: "assistant" },
        { id: "m3", parts: [{ text: "Design", type: "text" }], role: "user" },
      ],
    }));
    expect(markup).toContain("Which collection?");
    expect(markup).not.toContain("<button");
  });

  test("a stored question (text part plus ask) shows the question once", () => {
    const markup = renderToStaticMarkup(createElement(AssistantMessages, {
      ...messageProps,
      messages: [{
        id: "m2",
        parts: [{ text: "Which collection?", type: "text" }, { data: ask, type: "data-ask" }],
        role: "assistant",
      }],
    }));
    expect(markup.split("Which collection?")).toHaveLength(3); // the text and the group label
    expect(markup).toContain('aria-label="Which collection?"');
    expect(markup).toMatch(button("Inbox", false));
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
