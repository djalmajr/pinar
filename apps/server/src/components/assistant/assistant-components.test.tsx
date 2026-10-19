import { cloneElement, createElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Translate } from "@/lib/i18n";
import type { AssistantProposalErrorKey, AssistantPublicProposal, AssistantThreadDetail } from "./assistant-client";
import type {
  AssistantConversation,
  AssistantConversationHooks,
  AssistantConversationStore,
  AssistantProposalActionStore,
  AssistantProposalCardStates,
} from "./assistant-conversation";
import type { MinuteClockScheduler } from "./AssistantProposalCard";

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
const { AssistantProposalCard, nextMinuteTick, proposalDeadline, watchMinutesLeft } = await import(
  "./AssistantProposalCard"
);
const { AssistantPanel } = await import("./AssistantPanel");
const { AssistantThreadList } = await import("./AssistantThreadList");
const { AssistantToggle } = await import("./AssistantToggle");
const { AssistantPanelContext } = await import("./assistant-panel-state");
const {
  applyAssistantProposalAction,
  createAssistantConversation,
  openAssistantConversation,
  startAssistantConversation,
} = await import("./assistant-conversation");

// The i18n keys are rendered verbatim so assertions stay stable.
const t: Translate = (key) => key as string;

// The props AssistantMessages needs besides the messages.
const messageProps = {
  busy: false,
  onAsk: () => undefined,
  onProposalAction: () => undefined,
  onRetry: () => undefined,
  onRetryWithCredits: () => undefined,
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
      // The working line exists only while the chat is working.
      busy: true,
    }));
    expect(markup).toContain("assistant.working");
    expect(markup).not.toContain("pinar_list_sessions");
    expect(markup).not.toContain('"query":"nope"');
  });

  test("after an error or an abort (chat not working) a tool part left in progress shows no working line", () => {
    const toolMessage = {
      id: "m1",
      parts: [{
        input: {},
        state: "input-available" as const,
        toolCallId: "call_1",
        toolName: "pinar_list_sessions",
        type: "dynamic-tool" as const,
      }],
      role: "assistant" as const,
    };
    const stopped = renderToStaticMarkup(createElement(AssistantMessages, {
      messages: [{ id: "u1", parts: [{ text: "?", type: "text" }], role: "user" }, toolMessage],
      ...messageProps,
      busy: false,
    }));
    expect(stopped).not.toContain("assistant.working");
    expect(stopped).not.toContain("animate-spin");
    const working = renderToStaticMarkup(createElement(AssistantMessages, {
      messages: [{ id: "u1", parts: [{ text: "?", type: "text" }], role: "user" }, toolMessage],
      ...messageProps,
      busy: true,
    }));
    expect(working).toContain("assistant.working");
  });

  test("a new turn does not revive the working line of an earlier answer that stopped mid-tool", () => {
    const markup = renderToStaticMarkup(createElement(AssistantMessages, {
      messages: [
        { id: "u1", parts: [{ text: "?", type: "text" }], role: "user" },
        {
          id: "m1",
          parts: [{ input: {}, state: "input-available", toolCallId: "call_1", toolName: "pinar_list_sessions", type: "dynamic-tool" }],
          role: "assistant",
        },
        { id: "u2", parts: [{ text: "de novo", type: "text" }], role: "user" },
      ],
      ...messageProps,
      busy: true,
    }));
    expect(markup).not.toContain("assistant.working");
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

describe("proposal card countdown (injected clock and scheduler)", () => {
  const T0 = Date.parse("2026-10-17T12:00:00.000Z");
  const at = (ms: number) => new Date(T0 + ms).toISOString();

  afterEach(() => {
    setSystemTime();
  });

  /** Timers that only fire when the test moves the clock, in deadline order. */
  function manualClock() {
    let now = T0;
    let nextId = 0;
    const pending = new Map<number, { at: number; callback: () => void }>();
    const cleared: number[] = [];
    const scheduler: MinuteClockScheduler<number> = {
      clearTimeout: (timer) => {
        cleared.push(timer);
        pending.delete(timer);
      },
      now: () => now,
      setTimeout: (callback, delay) => {
        nextId += 1;
        pending.set(nextId, { at: now + delay, callback });
        return nextId;
      },
    };
    function advanceTo(target: number) {
      for (;;) {
        const due = [...pending]
          .filter(([, timer]) => timer.at <= target)
          .sort(([, left], [, right]) => left.at - right.at)[0];
        if (due === undefined) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = target;
    }
    return { advanceTo, cleared, pending, scheduler };
  }

  // The card as a re-render at `time` draws it: the hook reads Date.now().
  function renderAt(time: number, proposal: AssistantPublicProposal): string {
    setSystemTime(new Date(time));
    return renderToStaticMarkup(createElement(AssistantProposalCard, {
      errorKey: null,
      onAction: () => undefined,
      pending: false,
      proposal,
      t: tv,
    }));
  }

  // Mutation captured: a tick every whole minute from now (ignoring the minute
  // boundary) fires at +60 s instead of +30 s.
  test("expires in: the text changes when the minute turns, and the label goes at the deadline", () => {
    const proposal = cardProposal({ expiresAt: at(150_000) });
    const clock = manualClock();
    const renders: Array<{ markup: string; time: number }> = [];
    const cancel = watchMinutesLeft(
      proposalDeadline(proposal),
      () => renders.push({ markup: renderAt(clock.scheduler.now(), proposal), time: clock.scheduler.now() }),
      clock.scheduler,
    );
    expect(renderAt(T0, proposal)).toContain("assistant.proposalExpiresIn[minutes=3]");

    clock.advanceTo(T0 + 29_999);
    expect(renders).toEqual([]);
    clock.advanceTo(T0 + 30_000);
    expect(renders.map((render) => render.time)).toEqual([T0 + 30_000]);
    expect(renders[0].markup).toContain("assistant.proposalExpiresIn[minutes=2]");

    clock.advanceTo(T0 + 90_000);
    expect(renders.map((render) => render.time)).toEqual([T0 + 30_000, T0 + 90_000]);
    expect(renders[1].markup).toContain("assistant.proposalExpiresIn[minutes=1]");
    expect(renders[1].markup).toMatch(button("assistant.proposalConfirm", false));

    clock.advanceTo(T0 + 150_000);
    expect(renders.map((render) => render.time)).toEqual([T0 + 30_000, T0 + 90_000, T0 + 150_000]);
    expect(renders[2].markup).toContain("assistant.proposalExpired");
    expect(renders[2].markup).not.toContain("assistant.proposalExpiresIn");
    expect(renders[2].markup).not.toContain("<button");
    // Past the deadline nothing is scheduled any more.
    expect(clock.pending.size).toBe(0);
    clock.advanceTo(T0 + 3_600_000);
    expect(renders).toHaveLength(3);
    cancel();
  });

  // Mutation captured: counting an executed card down to its expiry instead of
  // its undo window, or ignoring the minute boundary.
  test("can undo: the minutes change when the minute turns, and Undo and its label go at the deadline", () => {
    const proposal = cardProposal({ executedAt: at(-60_000), status: "executed", undoExpiresAt: at(75_000) });
    const clock = manualClock();
    const renders: string[] = [];
    const cancel = watchMinutesLeft(
      proposalDeadline(proposal),
      () => renders.push(renderAt(clock.scheduler.now(), proposal)),
      clock.scheduler,
    );
    expect(renderAt(T0, proposal)).toContain("assistant.proposalUndoIn[minutes=2]");

    clock.advanceTo(T0 + 15_000);
    expect(renders).toHaveLength(1);
    expect(renders[0]).toContain("assistant.proposalUndoIn[minutes=1]");
    expect(renders[0]).toMatch(button("assistant.proposalUndo", false));

    clock.advanceTo(T0 + 74_999);
    expect(renders).toHaveLength(1);
    clock.advanceTo(T0 + 75_000);
    expect(renders).toHaveLength(2);
    expect(renders[1]).toContain("assistant.proposalExecuted");
    expect(renders[1]).not.toContain("assistant.proposalUndo");
    expect(renders[1]).not.toContain("<button");
    expect(clock.pending.size).toBe(0);
    cancel();
  });

  // Mutation captured: a cancel that does not clear the pending timer lets it tick.
  test("the unmount cancels the pending timer: no tick after it", () => {
    const clock = manualClock();
    let ticks = 0;
    const cancel = watchMinutesLeft(T0 + 150_000, () => {
      ticks += 1;
    }, clock.scheduler);
    const [timer] = [...clock.pending.keys()];
    expect(clock.pending.get(timer)?.at).toBe(T0 + 30_000);

    cancel();
    expect(clock.cleared).toEqual([timer]);
    expect(clock.pending.size).toBe(0);
    clock.advanceTo(T0 + 3_600_000);
    expect(ticks).toBe(0);
  });

  // Mutation captured: a cancel without clearTimeout, or the undo deadline read from expiresAt.
  test("a state change moves the deadline: the old timer is cancelled and only the new deadline counts", () => {
    // The hook's effect depends on proposalDeadline(proposal): each state
    // change below changes it, so the effect cleanup (the cancel) runs and a
    // new countdown starts for the new deadline.
    const clock = manualClock();
    let ticks: number[] = [];
    const onTick = () => {
      ticks.push(clock.scheduler.now());
    };
    const proposed = cardProposal({ expiresAt: at(150_000) });
    let cancel = watchMinutesLeft(proposalDeadline(proposed), onTick, clock.scheduler);
    const [proposedTimer] = [...clock.pending.keys()];

    // proposed → executing: no deadline, nothing scheduled.
    const executing = { ...proposed, status: "executing" as const };
    expect(proposalDeadline(executing)).toBeNull();
    cancel();
    cancel = watchMinutesLeft(proposalDeadline(executing), onTick, clock.scheduler);
    expect(clock.cleared).toEqual([proposedTimer]);
    expect(clock.pending.size).toBe(0);
    clock.advanceTo(T0 + 40_000);
    expect(ticks).toEqual([]);

    // executing → executed: the undo window is the new deadline.
    const executed = { ...proposed, executedAt: at(40_000), status: "executed" as const, undoExpiresAt: at(160_000) };
    expect(proposalDeadline(executed)).toBe(T0 + 160_000);
    cancel();
    cancel = watchMinutesLeft(proposalDeadline(executed), onTick, clock.scheduler);
    const [executedTimer] = [...clock.pending.keys()];
    expect(clock.pending.get(executedTimer)?.at).toBe(T0 + 100_000);

    // executed → undone: cancelled again; neither deadline ticks any more.
    const undone = { ...executed, status: "undone" as const };
    expect(proposalDeadline(undone)).toBeNull();
    cancel();
    cancel = watchMinutesLeft(proposalDeadline(undone), onTick, clock.scheduler);
    expect(clock.cleared).toEqual([proposedTimer, executedTimer]);
    expect(clock.pending.size).toBe(0);
    clock.advanceTo(T0 + 3_600_000);
    expect(ticks).toEqual([]);
    cancel();
  });

  // Mutation captured: re-arming after the tick without checking the cancel.
  test("a tick that cancels the countdown arms nothing", () => {
    const clock = manualClock();
    let ticks = 0;
    const cancel = watchMinutesLeft(T0 + 150_000, () => {
      ticks += 1;
      cancel();
    }, clock.scheduler);
    clock.advanceTo(T0 + 3_600_000);
    expect(ticks).toBe(1);
    expect(clock.pending.size).toBe(0);
  });

  // Mutation captured: the executed deadline read from expiresAt.
  test("proposalDeadline: the expiry while proposed, the undo window once executed, none otherwise", () => {
    const proposal = cardProposal({ expiresAt: at(60_000), undoExpiresAt: at(120_000) });
    expect(proposalDeadline(proposal)).toBe(T0 + 60_000);
    expect(proposalDeadline({ ...proposal, status: "executed" })).toBe(T0 + 120_000);
    expect(proposalDeadline({ ...proposal, status: "executed", undoExpiresAt: null })).toBeNull();
    expect(proposalDeadline({ ...proposal, expiresAt: "not a date" })).toBeNull();
    for (const status of ["executing", "undoing", "failed", "rejected", "expired", "undone"] as const) {
      expect(proposalDeadline({ ...proposal, status })).toBeNull();
    }
  });

  // Mutation captured: a fixed one-minute delay instead of the time to the next minute boundary.
  test("nextMinuteTick: the delay until the whole minutes left change; none at or past the deadline", () => {
    expect(nextMinuteTick(null, T0)).toBeNull();
    expect(nextMinuteTick(T0, T0)).toBeNull();
    expect(nextMinuteTick(T0 - 1, T0)).toBeNull();
    expect(nextMinuteTick(T0 + 1, T0)).toBe(1);
    expect(nextMinuteTick(T0 + 30_000, T0)).toBe(30_000);
    expect(nextMinuteTick(T0 + 60_000, T0)).toBe(60_000);
    expect(nextMinuteTick(T0 + 60_001, T0)).toBe(1);
    expect(nextMinuteTick(T0 + 150_000, T0)).toBe(30_000);
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

/** The card-state map of the test panel and every write the actions made to it. */
interface PanelCardStates {
  states: AssistantProposalCardStates;
  writes: AssistantProposalCardStates[];
}

describe("a card action answer from an earlier conversation generation", () => {
  // Review rev-f2 P2, the scenario of its probe through the real conversation
  // switch (openAssistantConversation bumps the generation) and the real
  // action client (fetch stubbed): the panel resets the card states on every
  // switch, exactly as AssistantPanel does.
  const originalFetch = globalThis.fetch;
  const threadA = LEAK_IDS.threadId;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function threadDetail(threadId: string, proposals: AssistantPublicProposal[]): AssistantThreadDetail {
    return {
      messages: [
        { ask: null, createdAt: "2026-10-17T12:00:00.000Z", errorCode: null, id: `amg_${threadId}_1`, role: "user", status: "final", text: "move it", threadId },
        { ask: null, createdAt: "2026-10-17T12:00:01.000Z", errorCode: null, id: LEAK_IDS.messageId, role: "assistant", status: "final", text: "Proposed.", threadId },
      ],
      proposals,
      thread: { createdAt: "2026-10-17T12:00:00.000Z", id: threadId, title: threadId, updatedAt: "2026-10-17T12:00:01.000Z" },
    };
  }

  /** The panel pieces: its conversation store, its card-state map and the action store over both. */
  function panel() {
    const hooks: AssistantConversationHooks = { generation: { current: 0 } };
    const conversations: AssistantConversationStore = {
      current: createAssistantConversation({ chatId: "assistant:new:0", generation: 0, hooks, messages: [], threadId: null }),
      hooks,
      newThreadCountRef: { current: 0 },
      requestedThreadRef: { current: null },
    };
    const state: PanelCardStates = { states: {}, writes: [] };
    const actions: AssistantProposalActionStore = {
      generation: hooks.generation,
      inFlight: new Set<string>(),
      setProposalStates: (update) => {
        state.states = update(state.states);
        state.writes.push(state.states);
      },
    };
    async function open(id: string, detail: AssistantThreadDetail): Promise<AssistantConversation> {
      const result = await openAssistantConversation(conversations, id, async () => detail);
      if (result.kind !== "switched") throw new Error(`open ${id}: ${result.kind}`);
      conversations.current = result.conversation;
      state.states = {};
      return result.conversation;
    }
    function cards(conversation: AssistantConversation): string {
      return renderToStaticMarkup(createElement(AssistantMessages, {
        ...messageProps,
        messages: conversation.chat.messages,
        proposalStates: state.states,
        t: tv,
      }));
    }
    return { actions, cards, conversations, open, state };
  }

  /** The POST of the action stays pending until the test settles it. */
  function pendingPost() {
    const posts: string[] = [];
    let reject: (error: Error) => void = () => undefined;
    let resolve: (response: Response) => void = () => undefined;
    globalThis.fetch = Object.assign(
      (input: Parameters<typeof fetch>[0]) => {
        posts.push(String(input));
        return new Promise<Response>((settleResolve, settleReject) => {
          reject = settleReject;
          resolve = settleResolve;
        });
      },
      { preconnect: originalFetch.preconnect },
    );
    const settle = {
      fail: (error: Error) => reject(error),
      succeed: (response: Response) => resolve(response),
    };
    return { posts, settle };
  }

  // Mutation captured: without the generation check (the e18472b handler) the
  // late failure writes the proposed proposal and the network note back.
  test("pending confirm → switch to B → reopen A with the executed GET → the late POST fails: Done with Undo stays", async () => {
    const proposed = cardProposal();
    const executed = cardProposal({ executedAt: inMinutes(0), status: "executed", undoExpiresAt: inMinutes(9.5) });
    const { actions, cards, open, state } = panel();
    const { posts, settle } = pendingPost();

    const a = await open(threadA, threadDetail(threadA, [proposed]));
    const action = applyAssistantProposalAction(actions, "confirm", proposed);
    expect(posts).toEqual([`/api/assistant/proposals/${proposed.id}/confirm`]);
    expect(cards(a)).toMatch(button("assistant.proposalConfirm", true));

    await open("ath_B", threadDetail("ath_B", []));
    const reopened = await open(threadA, threadDetail(threadA, [executed]));
    const before = cards(reopened);
    expect(before).toContain("assistant.proposalExecuted");
    expect(before).toMatch(button("assistant.proposalUndo", false));
    expect(before).not.toContain("assistant.proposalConfirm");

    // The write committed, then the connection broke before the answer.
    settle.fail(new TypeError("Failed to fetch"));
    await action;

    const after = cards(reopened);
    expect(after).toContain("assistant.proposalExecuted");
    expect(after).toMatch(button("assistant.proposalUndo", false));
    expect(after).toContain("assistant.proposalUndoIn[minutes=10]");
    expect(after).not.toContain("assistant.proposalConfirm");
    expect(after).not.toContain("assistant.proposalReject");
    expect(after).not.toContain("assistant.errorNetwork");
    expect(after).not.toContain('role="alert"');
    // Only the pending write ever happened; the late answer wrote nothing.
    expect(state.writes).toHaveLength(1);
    expect(state.states).toEqual({});
    expect(actions.inFlight.size).toBe(0);
    expect(posts).toHaveLength(1);
  });

  // Mutation captured: without the generation check the late answer is written.
  test("a late success after starting a new conversation is dropped too", async () => {
    const proposed = cardProposal();
    const { actions, conversations, open, state } = panel();
    const { settle } = pendingPost();

    await open(threadA, threadDetail(threadA, [proposed]));
    const action = applyAssistantProposalAction(actions, "confirm", proposed);
    conversations.current = await startAssistantConversation(conversations);
    state.states = {};

    settle.succeed(new Response(JSON.stringify({ proposal: { ...proposed, status: "executed" } }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }));
    await action;
    expect(state.writes).toHaveLength(1);
    expect(state.states).toEqual({});
    expect(actions.inFlight.size).toBe(0);
  });

  // Mutation captured: a check that drops every answer leaves the card pending.
  test("control: without a switch the same network failure keeps the proposal and shows the note", async () => {
    const proposed = cardProposal();
    const { actions, cards, open, state } = panel();
    const { settle } = pendingPost();

    const a = await open(threadA, threadDetail(threadA, [proposed]));
    const action = applyAssistantProposalAction(actions, "confirm", proposed);
    settle.fail(new TypeError("Failed to fetch"));
    await action;

    expect(state.writes).toHaveLength(2);
    expect(state.states).toEqual({
      [proposed.id]: { errorKey: "assistant.errorNetwork", pending: false, proposal: proposed },
    });
    const markup = cards(a);
    expect(markup).toMatch(button("assistant.proposalConfirm", false));
    expect(markup).toContain("assistant.errorNetwork");
    expect(actions.inFlight.size).toBe(0);
  });

  // Mutation captured: without the in-flight check the second click sends a second POST.
  test("control: a second click while the action is in flight sends no second POST", async () => {
    const proposed = cardProposal();
    const { actions, open } = panel();
    const { posts, settle } = pendingPost();

    await open(threadA, threadDetail(threadA, [proposed]));
    const first = applyAssistantProposalAction(actions, "confirm", proposed);
    await applyAssistantProposalAction(actions, "confirm", proposed);
    expect(posts).toHaveLength(1);
    settle.fail(new TypeError("Failed to fetch"));
    await first;
    expect(actions.inFlight.size).toBe(0);
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

describe("assistant turn error note (F4/S2 credits)", () => {
  test("a 402 shows the balance, the price and a link to buy credits, without retry", async () => {
    const { AssistantTurnErrorNote } = await import("./AssistantPanel");
    const markup = renderToStaticMarkup(createElement(AssistantTurnErrorNote, {
      error: { byok: null, credits: { balance: 2, required: 3 }, key: "assistant.errorNoCredits" },
      onRetry: () => {},
      onRetryWithCredits: () => {},
      t: tv,
    }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("assistant.errorNoCredits[count=2;required=3]");
    expect(markup).toContain('href="/pricing"');
    expect(markup).toContain("assistant.buyCredits");
    expect(markup).not.toContain("assistant.retry");
  });

  test("a 402 without a readable balance still links to /pricing with the generic note", async () => {
    const { AssistantTurnErrorNote } = await import("./AssistantPanel");
    const markup = renderToStaticMarkup(createElement(AssistantTurnErrorNote, {
      error: { byok: null, credits: null, key: "assistant.errorNoCredits" },
      onRetry: () => {},
      onRetryWithCredits: () => {},
      t: tv,
    }));
    expect(markup).toContain("viewer.aiNoCredits");
    expect(markup).toContain('href="/pricing"');
  });

  test("any other failure keeps the retry action and no pricing link", async () => {
    const { AssistantTurnErrorNote } = await import("./AssistantPanel");
    const markup = renderToStaticMarkup(createElement(AssistantTurnErrorNote, {
      error: { byok: null, credits: null, key: "assistant.errorRateLimited" },
      onRetry: () => {},
      onRetryWithCredits: () => {},
      t: tv,
    }));
    expect(markup).toContain("assistant.errorRateLimited");
    expect(markup).toContain("assistant.retry");
    expect(markup).not.toContain("/pricing");
  });
});

describe("assistant turn error note (F5/S3 byok_error)", () => {
  test("a byok_error shows the cause text, the retryAfter and the two actions", async () => {
    const { AssistantTurnErrorNote } = await import("./AssistantPanel");
    const markup = renderToStaticMarkup(createElement(AssistantTurnErrorNote, {
      error: {
        byok: { canUseCredits: true, cause: "key_rejected", retryAfter: 15 },
        credits: null,
        key: "byok.errorGeneric",
      },
      onRetry: () => {},
      onRetryWithCredits: () => {},
      t: tv,
    }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("byok.cause.key_rejected");
    expect(markup).toContain("byok.retryAfter[seconds=15]");
    expect(markup).toContain("assistant.retry");
    expect(markup).toContain("byok.useCredits");
    expect(markup).not.toContain("/pricing");
  });

  test("each cause has its own text, the retryAfter line only when there is one, and the credits button only when offered", async () => {
    const { AssistantTurnErrorNote } = await import("./AssistantPanel");
    for (const cause of [
      "egress_unavailable",
      "endpoint_blocked",
      "endpoint_unreachable",
      "invalid_response",
      "key_rejected",
      "model_not_configured",
      "model_not_found",
      "rate_limited",
      "scope_denied",
      "service_disabled",
      "timeout",
      "unavailable",
    ] as const) {
      const markup = renderToStaticMarkup(createElement(AssistantTurnErrorNote, {
        error: { byok: { canUseCredits: true, cause, retryAfter: null }, credits: null, key: "byok.errorGeneric" },
        onRetry: () => {},
        onRetryWithCredits: () => {},
        t,
      }));
      expect(markup).toContain(`byok.cause.${cause}`);
      expect(markup).not.toContain("byok.retryAfter");
    }
    const notOffered = renderToStaticMarkup(createElement(AssistantTurnErrorNote, {
      error: { byok: { canUseCredits: false, cause: "unavailable", retryAfter: null }, credits: null, key: "byok.errorGeneric" },
      onRetry: () => {},
      onRetryWithCredits: () => {},
      t,
    }));
    expect(notOffered).toContain("assistant.retry");
    expect(notOffered).not.toContain("byok.useCredits");
  });

  test("a stored byok_error message (reopened thread) shows the generic note and the two buttons", () => {
    const markup = renderToStaticMarkup(createElement(AssistantMessages, {
      messages: [{ id: "m1", metadata: { errorCode: "byok_error" }, parts: [], role: "assistant" }],
      ...messageProps,
    }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("byok.errorGeneric");
    expect(markup).toContain("assistant.retry");
    expect(markup).toContain("byok.useCredits");
  });

  test("a stored non-byok error message keeps its own key and the single retry", () => {
    const markup = renderToStaticMarkup(createElement(AssistantMessages, {
      messages: [{ id: "m1", metadata: { errorCode: "ASSISTANT_STREAM_FAILED" }, parts: [], role: "assistant" }],
      ...messageProps,
    }));
    expect(markup).toContain("assistant.errorFailed");
    expect(markup).toContain("assistant.retry");
    expect(markup).not.toContain("byok.useCredits");
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

describe("assistant turn error note (typed final error)", () => {
  const terminal = (code: string, phase: string) => new Error(JSON.stringify({ code, phase, retryable: true }));

  test("each code and phase of the terminal has its own message key", async () => {
    const { assistantTurnErrorFromChatError } = await import("./AssistantPanel");
    const cases: Array<[Error, string]> = [
      [terminal("ASSISTANT_TURN_TIMEOUT", "inactivity"), "assistant.errorTimeoutInactivity"],
      [terminal("ASSISTANT_TURN_TIMEOUT", "attempt"), "assistant.errorTimeoutLimit"],
      [terminal("ASSISTANT_TURN_TIMEOUT", "turn"), "assistant.errorTimeoutLimit"],
      [terminal("ASSISTANT_TURN_INCOMPLETE", "model"), "assistant.errorIncomplete"],
      [terminal("ASSISTANT_STREAM_FAILED", "model"), "assistant.errorFailed"],
      [terminal("ASSISTANT_STREAM_FAILED", "tool"), "assistant.errorFailed"],
      // The 504 before the stream: the transport puts the JSON body in the message.
      [new Error(JSON.stringify({ code: "ASSISTANT_TURN_TIMEOUT", error: "The assistant took too long to answer", phase: "turn", retryable: true })), "assistant.errorTimeoutLimit"],
      // The older plain codes still map as before.
      [new Error("ASSISTANT_TURN_TIMEOUT"), "assistant.errorTimeout"],
    ];
    for (const [error, key] of cases) {
      expect(assistantTurnErrorFromChatError(error, null)).toEqual({ byok: null, credits: null, key: key as never });
    }
  });

  test("a BYOK failure keeps its cause and the credits offer", async () => {
    const { assistantTurnErrorFromChatError } = await import("./AssistantPanel");
    expect(assistantTurnErrorFromChatError(new Error("byok_error"), { canUseCredits: true, cause: "timeout", retryAfter: null })).toEqual({
      byok: { canUseCredits: true, cause: "timeout", retryAfter: null },
      credits: null,
      key: "byok.errorGeneric",
    });
  });

  test("a timeout note shows its message and the retry action", async () => {
    const { AssistantTurnErrorNote, assistantTurnErrorFromChatError } = await import("./AssistantPanel");
    let retried = 0;
    const markup = renderToStaticMarkup(createElement(AssistantTurnErrorNote, {
      error: assistantTurnErrorFromChatError(terminal("ASSISTANT_TURN_TIMEOUT", "inactivity"), null),
      onRetry: () => {
        retried += 1;
      },
      onRetryWithCredits: () => {},
      t,
    }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("assistant.errorTimeoutInactivity");
    expect(markup).toContain("assistant.retry");
    expect(markup).not.toContain("byok.useCredits");
    expect(retried).toBe(0);
  });

  test("every new key has a message in the seven languages", async () => {
    for (const language of ["de", "en", "es", "fr", "ja", "pt", "zh"]) {
      const messages = (await import(`@/lib/ui-locales/${language}.ts`)).default as Record<string, string>;
      for (const key of ["assistant.errorTimeoutInactivity", "assistant.errorTimeoutLimit"]) {
        expect(typeof messages[key]).toBe("string");
        expect(messages[key].length).toBeGreaterThan(0);
      }
    }
  });
});

describe("assistant toggle variant", () => {
  test("the header button is the ghost variant (only the icon, no background)", () => {
    const base = { setOpen: () => undefined, toggle: () => undefined };
    for (const open of [false, true]) {
      const markup = renderToStaticMarkup(createElement(
        AssistantPanelContext.Provider,
        { value: { open, ...base } },
        createElement(AssistantToggle),
      ));
      expect(markup).toContain('variant="ghost"');
      expect(markup).toContain("aria-expanded:bg-transparent");
      expect(markup).toContain(`aria-expanded="${open}"`);
    }
  });
});
