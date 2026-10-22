import { useEffect, useState, type ReactNode } from "react";
import {
  Bubble,
  BubbleContent,
  Button,
  ChatMarkdown,
  Message,
  MessageContent,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@pinar/ui";
import type { Translate } from "@/lib/i18n";
import IconArrowDown from "~icons/lucide/arrow-down";
import {
  assistantErrorMessageKey,
  assistantMessageAsk,
  assistantMessageProposals,
  type AssistantProposalActionKind,
  type AssistantProposalErrorKey,
  type AssistantPublicProposal,
  type AssistantUIMessage,
} from "./assistant-client";
import {
  ASSISTANT_SLOW_WORKING_MS,
  assistantCollapsedTraces,
  assistantTurnProgressKey,
  assistantTurnTraceSteps,
  assistantWorkingState,
  watchSlowFlag,
  type AssistantWorkingState,
} from "./assistant-trace";
import { AssistantInterruptedMark, AssistantNoCreditsCard, AssistantTurnErrorText } from "./AssistantNotices";
import { AssistantProposalCard } from "./AssistantProposalCard";
import { AssistantCollapsedTrace, AssistantLiveTrace } from "./AssistantTrace";

/** The chat status the panel gets from useChat. */
export type AssistantChatStatus = "error" | "ready" | "streaming" | "submitted";

/** What the panel knows about a proposal beyond the message part that carried it. */
export interface AssistantProposalCardState {
  errorKey: AssistantProposalErrorKey | null;
  pending: boolean;
  /** The proposal of the last action answer (or refetch); null until there is one. */
  proposal: AssistantPublicProposal | null;
}

export interface AssistantMessagesProps {
  /** Rendered after the messages, inside the scroller (the failed turn's note). */
  footer?: ReactNode;
  /** The messages marked "Resposta interrompida" by Stop or an abort. */
  interruptedIds: ReadonlySet<string>;
  messages: readonly AssistantUIMessage[];
  /** An ask option was picked: send it as the next user message. */
  onAsk: (option: string) => void;
  onProposalAction: (kind: AssistantProposalActionKind, proposal: AssistantPublicProposal) => void;
  onRetry: () => void;

  /** Per proposal id; a proposal without an entry shows the state its part carried. */
  proposalStates: Readonly<Record<string, AssistantProposalCardState>>;
  status: AssistantChatStatus;
  t: Translate;
}

const browserSlowScheduler = {
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
};

/**
 * True once the turn has worked `delayMs` without visible progress (the
 * Skia's useSlowFlag). Any progress, and the end of the wait, clear it and
 * restart the count.
 */
export function useAssistantSlowFlag(active: boolean, progressKey: string, delayMs = ASSISTANT_SLOW_WORKING_MS): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => watchSlowFlag(active, delayMs, setSlow, browserSlowScheduler), [active, delayMs, progressKey]);
  return active && slow;
}

// The current action of the live turn (the Skia's title of the running
// Trace): the running step's label; without one, by phase.
function currentActionKey(working: Exclude<AssistantWorkingState, null>, stepCount: number) {
  if (working === "tool") return "assistant.working" as const;
  if (working === "writing") return "assistant.phaseWriting" as const;
  return stepCount > 0 ? ("assistant.phaseAnalyzing" as const) : ("assistant.phaseThinking" as const);
}

function messageText(message: AssistantUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function StoredErrorNotice({
  busy,
  errorCode,
  onRetry,

  t,
}: {
  busy: boolean;
  errorCode: string;
  onRetry: () => void;

  t: Translate;
}) {
  const key = assistantErrorMessageKey(errorCode);
  if (key === "assistant.errorNoCredits") return <AssistantNoCreditsCard credits={null} t={t} />;
  return (
    <AssistantTurnErrorText
      disabled={busy}
      message={t(key)}
      onRetry={onRetry}

      t={t}
    />
  );
}

/**
 * A `pinar_ask` question: the question as assistant text (unless a text part
 * of the message already says it) and one button per option. The buttons
 * only exist while the question is the last message: any later message
 * answers it.
 */
function AssistantAskOptions({
  busy,
  message,
  onAsk,
  open,
}: {
  busy: boolean;
  message: AssistantUIMessage;
  onAsk: (option: string) => void;
  open: boolean;
}) {
  const ask = assistantMessageAsk(message);
  if (ask === null) return null;
  const question = ask.question.trim();
  const questionShown = message.parts.some((part) => part.type === "text" && part.text.trim() === question);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {questionShown ? null : (
        <Bubble variant="muted">
          <BubbleContent className="whitespace-pre-wrap [overflow-wrap:anywhere]">{ask.question}</BubbleContent>
        </Bubble>
      )}
      {open ? (
        <div aria-label={ask.question} className="flex flex-wrap gap-2" role="group">
          {ask.options.map((option, index) => (
            <Button
              disabled={busy}
              key={`option-${index}`}
              onClick={() => onAsk(option)}
              size="sm"
              type="button"
              variant="outline"
            >
              {option}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AssistantProposalCards({
  message,
  onProposalAction,
  proposalStates,
  t,
}: {
  message: AssistantUIMessage;
  onProposalAction: AssistantMessagesProps["onProposalAction"];
  proposalStates: AssistantMessagesProps["proposalStates"];
  t: Translate;
}) {
  const proposals = assistantMessageProposals(message);
  if (proposals.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {proposals.map((part) => {
        const state = proposalStates[part.id];
        const proposal = state?.proposal ?? part;
        return (
          <AssistantProposalCard
            errorKey={state?.errorKey ?? null}
            key={part.id}
            onAction={(kind) => onProposalAction(kind, proposal)}
            pending={state?.pending ?? false}
            proposal={proposal}
            t={t}
          />
        );
      })}
    </div>
  );
}

export function AssistantMessages({
  footer,
  interruptedIds,
  messages,
  onAsk,
  onProposalAction,
  onRetry,

  proposalStates,
  status,
  t,
}: AssistantMessagesProps) {
  const busy = status === "submitted" || status === "streaming";
  // The live Trace exists only while the chat works on the current turn
  // (it starts at the last user message: an earlier answer already ended).
  const working = assistantWorkingState(status, messages);
  const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
  let liveAssistantId: string | null = null;
  if (working !== null) {
    for (let index = messages.length - 1; index > lastUserIndex; index -= 1) {
      if (messages[index].role === "assistant") {
        liveAssistantId = messages[index].id;
        break;
      }
    }
  }
  const liveSteps = working !== null ? assistantTurnTraceSteps(messages.slice(lastUserIndex + 1)) : [];
  const slow = useAssistantSlowFlag(working !== null, assistantTurnProgressKey(messages));
  const runningLabel = liveSteps.filter((step) => step.status === "running").at(-1)?.label ?? null;
  const currentText = working === null ? null : t(runningLabel ?? currentActionKey(working, liveSteps.length));
  const liveWork = working !== null && currentText !== null ? (
    <div className="px-1 py-1" data-state={working} data-testid="assistant-working">
      <AssistantLiveTrace
        current={currentText}
        description={slow ? t("assistant.slowNotice") : null}
        steps={liveSteps}
        t={t}
      />
    </div>
  ) : null;
  const collapsedTraces = assistantCollapsedTraces(messages, working !== null);

  function renderMessage(message: AssistantUIMessage, index: number) {
    const fromUser = message.role === "user";
    const text = messageText(message);
    const interrupted = interruptedIds.has(message.id);
    // The retry of an interrupted turn only in the current turn (the last
    // question or what came after it): a later question already moved on.
    // A question stopped during a lookup carries the mark while the tool's
    // message still follows it.
    const interruptedRetry = interrupted && index >= lastUserIndex ? onRetry : null;
    const errorCode = fromUser ? undefined : message.metadata?.errorCode;
    const collapsed = fromUser ? undefined : collapsedTraces.get(message.id);
    return (
      <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={fromUser}>
        <Message align={fromUser ? "end" : "start"}>
          <MessageContent>
            {message.id === liveAssistantId ? liveWork : null}
            {collapsed !== undefined ? <AssistantCollapsedTrace steps={collapsed} t={t} /> : null}
            {errorCode !== undefined ? (
              <StoredErrorNotice
                busy={busy}
                errorCode={errorCode}
                onRetry={onRetry}

                t={t}
              />
            ) : text.trim() !== "" ? (
              <Bubble variant={fromUser ? "default" : "muted"}>
                {fromUser ? (
                  <BubbleContent className="whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</BubbleContent>
                ) : (
                  <BubbleContent>
                    <ChatMarkdown
                      copiedLabel={t("common.copied")}
                      copyFailedLabel={t("assistant.copyCodeFailed")}
                      copyLabel={t("assistant.copyCode")}
                      markdown={text}
                    />
                  </BubbleContent>
                )}
              </Bubble>
            ) : null}
            {!fromUser && errorCode === undefined ? (
              <>
                <AssistantAskOptions
                  busy={busy}
                  message={message}
                  onAsk={onAsk}
                  open={index === messages.length - 1}
                />
                <AssistantProposalCards
                  message={message}
                  onProposalAction={onProposalAction}
                  proposalStates={proposalStates}
                  t={t}
                />
              </>
            ) : null}
            {interrupted ? (
              <AssistantInterruptedMark align={fromUser ? "end" : "start"} disabled={busy} onRetry={interruptedRetry} t={t} />
            ) : null}
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  }

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport
          aria-label={t("assistant.messagesLabel")}
          className="focus-visible:outline-none"
          data-testid="assistant-messages"
          tabIndex={-1}
        >
          {/* Items are direct children of the content: the primitive finds
              them by the data-* of its direct children. */}
          <MessageScrollerContent className="gap-3 px-4 py-3" role="presentation">
            {messages.map(renderMessage)}
            {/* No assistant message in the turn yet: the live Trace sits
                where the answer will appear. */}
            {working !== null && liveAssistantId === null ? (
              <MessageScrollerItem messageId="assistant-live-work">
                <Message align="start">
                  <MessageContent>{liveWork}</MessageContent>
                </Message>
              </MessageScrollerItem>
            ) : null}
            {footer ? <MessageScrollerItem messageId="assistant-turn-error">{footer}</MessageScrollerItem> : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton
          aria-label={t("assistant.scrollToEnd")}
          data-testid="assistant-scroll-to-end"
          direction="end"
          tooltip={t("assistant.scrollToEnd")}
        >
          <IconArrowDown aria-hidden="true" className="size-4" />
          <span className="sr-only">{t("assistant.scrollToEnd")}</span>
        </MessageScrollerButton>
      </MessageScroller>
      {/* The screen-reader announcement of the work in progress; the label
          changes only when a new step or phase starts, never per token. */}
      <div aria-live="polite" className="sr-only" role="status">
        {currentText !== null ? (slow ? t("assistant.slowNotice") : currentText) : ""}
      </div>
    </MessageScrollerProvider>
  );
}
