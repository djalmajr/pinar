import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { Link } from "@tanstack/react-router";
import { Button, cn } from "@pinar/ui";
import { useGlobalSettings } from "@/components/GlobalSettingsDialog";
import { parseAssistantTurnTerminal, type AssistantTurnTerminal } from "@/lib/assistant-turn-terminal";
import type { Translate } from "@/lib/i18n";
import IconHistory from "~icons/lucide/history";
import IconPlus from "~icons/lucide/plus";
import IconSparkles from "~icons/lucide/sparkles";
import IconX from "~icons/lucide/x";
import {
  assistantCreditsFromChatError,
  assistantErrorFromChatError,
  assistantErrorMessageKey,
  buildTurnRequestBody,
  deleteAssistantThread,
  fetchAssistantThreads,
  type AssistantErrorKey,
  type AssistantProposalActionKind,
  type AssistantPublicProposal,
  type AssistantStatus,
  type AssistantThread,
} from "./assistant-client";
import {
  applyAssistantProposalAction,
  createAssistantConversation,
  openAssistantConversation,
  startAssistantConversation,
  stopAssistantConversation,
  type AssistantConversation,
  type AssistantConversationHooks,
  type AssistantProposalCardStates,
} from "./assistant-conversation";
import { useAssistantPanel } from "./assistant-panel-state";
import { AssistantComposer } from "./AssistantComposer";
import { AssistantMessages } from "./AssistantMessages";
import { AssistantNoCreditsCard, AssistantTurnErrorText } from "./AssistantNotices";
import { assistantInterruptedMessageId } from "./assistant-trace";
import { AssistantThreadList } from "./AssistantThreadList";

export interface AssistantTurnError {
  credits: { balance: number; required: number } | null;
  key: AssistantErrorKey | AssistantTurnTerminalKey;
}

export type AssistantTurnTerminalKey =
  | "assistant.errorFailed"
  | "assistant.errorIncomplete"
  | "assistant.errorTimeoutInactivity"
  | "assistant.errorTimeoutLimit";

// The typed final error of a turn (lib/assistant-turn-terminal.ts): a
// timeout says which limit ran out — a minute without progress, or the
// attempt's or the turn's ceiling.
export function assistantTurnTerminalMessageKey(terminal: AssistantTurnTerminal): AssistantTurnTerminalKey {
  switch (terminal.code) {
    case "ASSISTANT_TURN_TIMEOUT":
      return terminal.phase === "inactivity" ? "assistant.errorTimeoutInactivity" : "assistant.errorTimeoutLimit";
    case "ASSISTANT_TURN_INCOMPLETE":
      return "assistant.errorIncomplete";
    default:
      return "assistant.errorFailed";
  }
}

export function assistantTurnErrorFromChatError(error: Error): AssistantTurnError {
  const code = assistantErrorFromChatError(error);
  const terminal = parseAssistantTurnTerminal(error);
  const key = terminal !== null ? assistantTurnTerminalMessageKey(terminal) : assistantErrorMessageKey(code);
  return {
    credits: key === "assistant.errorNoCredits" ? assistantCreditsFromChatError(error) : null,
    key,
  };
}

export function AssistantTurnErrorNote({
  disabled = false,
  error,
  onRetry,

  t,
}: {
  disabled?: boolean;
  error: AssistantTurnError;
  onRetry: () => void;

  t: Translate;
}) {
  if (error.key === "assistant.errorNoCredits") {
    return <AssistantNoCreditsCard credits={error.credits} t={t} />;
  }
  return <AssistantTurnErrorText disabled={disabled} message={t(error.key)} onRetry={onRetry} t={t} />;
}

export interface AssistantPanelProps {
  className?: string;
  language: string;
  /** `null` = the status is still unknown (loading or unreachable). */
  status: AssistantStatus | null;
  t: Translate;
}

export function AssistantPanel({ className, language, status, t }: AssistantPanelProps) {
  const openSettings = useGlobalSettings();
  const { setOpen } = useAssistantPanel();
  const [threads, setThreads] = useState<AssistantThread[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [turnError, setTurnError] = useState<AssistantTurnError | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  // The answers marked "Resposta interrompida" by Stop or an abort, for as
  // long as the conversation stays open (the Skia's interruptedMessageIds);
  // reset on every conversation switch.
  const [interruptedIds, setInterruptedIds] = useState<ReadonlySet<string>>(() => new Set());
  // Card state per proposal id: the most recent proposal an action answer
  // (or a 409 refetch) returned, the in-flight flag and the action note.
  // Reset on every conversation switch: a reopened thread brings its own
  // fresher proposals, and an answer that arrives after a switch (even back
  // to the same thread) is dropped by the generation check.
  const [proposalStates, setProposalStates] = useState<AssistantProposalCardStates>({});
  const proposalsInFlightRef = useRef(new Set<string>());

  // The generation cell and the refs the conversation callbacks consult. The
  // hook closures only touch stable setters, so one memoized set of hooks
  // serves every conversation the panel creates.
  const generationRef = useRef(0);
  const requestedThreadRef = useRef<string | null>(null);
  const newThreadCountRef = useRef(0);
  const hooks = useMemo<AssistantConversationHooks>(
    () => ({
      generation: generationRef,
      onThreadEntry: (entry) => {
        setThreads((current) => {
          const item: AssistantThread = {
            createdAt: entry.now,
            id: entry.id,
            title: entry.title,
            updatedAt: entry.now,
          };
          return [item, ...(current ?? []).filter((existing) => existing.id !== entry.id)];
        });
      },
      onActiveThreadCreated: (id) => {
        setActiveThreadId(id);
      },
      onTurnError: (error) => {
        setTurnError(assistantTurnErrorFromChatError(error));
      },
      onTurnAborted: (messages) => {
        const id = assistantInterruptedMessageId(messages);
        if (id === null) return;
        setInterruptedIds((current) => (current.has(id) ? current : new Set(current).add(id)));
      },
    }),
    [],
  );

  // One real SDK Chat per conversation: a stream that is switched away from
  // still addresses the Chat it started from, so a late event of it can never
  // reach the messages of the conversation the user moved to.
  const [conversation, setConversation] = useState<AssistantConversation>(() =>
    createAssistantConversation({
      chatId: "assistant:new:0",
      generation: 0,
      hooks,
      messages: [],
      threadId: null,
    }),
  );

  const {
    messages,
    sendMessage,
    status: chatStatus,
    stop,
  } = useChat({ chat: conversation.chat });

  // The SDK does not stop a chat managed outside the hook (isExternallyManaged
  // in @ai-sdk/react): closing the panel mid-turn must interrupt the stream
  // itself. Conversation switches already stop before switching; this cleanup
  // covers the unmount.
  useEffect(() => {
    return () => {
      stopAssistantConversation(conversation);
    };
  }, [conversation]);

  const busy = chatStatus === "submitted" || chatStatus === "streaming";
  const available = status !== null && status.available;

  const refreshThreads = useCallback(async () => {
    const value = await fetchAssistantThreads().catch(() => null);
    setThreads(value);
  }, []);

  useEffect(() => {
    if (!available) return;
    void refreshThreads();
  }, [available, refreshThreads]);

  // "New conversation" waits for the in-flight stream to be interrupted
  // before the switch, so a late event of the previous conversation can never
  // reach the fresh one.
  async function startNewThread() {
    const next = await startAssistantConversation({
      current: conversation,
      hooks,
      newThreadCountRef,
      requestedThreadRef,
    });
    setActiveThreadId(null);
    setTurnError(null);
    setInterruptedIds(new Set());
    setProposalStates({});
    setHistoryOpen(false);
    setConversation(next);
  }

  // "Open conversation" does the same, then fetches the thread; a response
  // that arrives after a newer request was made is discarded.
  async function openThread(id: string) {
    if (id === activeThreadId) return;
    const result = await openAssistantConversation(
      { current: conversation, hooks, newThreadCountRef, requestedThreadRef },
      id,
    );
    if (result.kind === "superseded") return;
    if (result.kind === "gone") {
      // The thread vanished (deleted elsewhere): refresh the list.
      void refreshThreads();
      return;
    }
    setActiveThreadId(id);
    setTurnError(null);
    setInterruptedIds(new Set());
    setProposalStates({});
    setHistoryOpen(false);
    setConversation(result.conversation);
  }

  async function removeThread(id: string) {
    const deleted = await deleteAssistantThread(id).catch(() => false);
    if (!deleted) {
      void refreshThreads();
      return;
    }
    setThreads((current) => (current ?? []).filter((item) => item.id !== id));
    if (id === activeThreadId) void startNewThread();
  }

  function handleSend(text: string) {
    setTurnError(null);
    void sendMessage({ text });
  }

  // One action per proposal at a time, applied only to the conversation
  // generation it started in.
  function handleProposalAction(kind: AssistantProposalActionKind, proposal: AssistantPublicProposal) {
    return applyAssistantProposalAction(
      { generation: generationRef, inFlight: proposalsInFlightRef.current, setProposalStates },
      kind,
      proposal,
    );
  }

  function handleRetry() {
    const text = buildTurnRequestBody(null, messages).text;
    if (!text) return;
    setTurnError(null);
    void sendMessage({ text });
  }

  const hasThread = status !== null && status.available && messages.length > 0;
  const body =
    status === null || (status !== null && status.reason === "disabled") ? (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        {status === null ? t("assistant.errorNetwork") : t("assistant.errorFailed")}
      </p>
    ) : status.reason === "not_configured" ? (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">{t("assistant.notConfigured")}</p>
        <Button size="sm" type="button" variant="outline" onClick={() => openSettings("ai")}>
          {t("assistant.openSettings")}
        </Button>
      </div>
    ) : status.reason === "requires_pro" ? (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">{t("assistant.requiresPro")}</p>
        <Button render={<Link to="/pricing" />} size="sm" type="button">
          {t("assistant.seePlans")}
        </Button>
      </div>
    ) : messages.length === 0 ? (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">{t("assistant.empty")}</p>
        <p className="text-xs text-muted-foreground">{t("assistant.readOnlyNote")}</p>
      </div>
    ) : (
      <AssistantMessages
          footer={turnError !== null ? (
            <AssistantTurnErrorNote
              disabled={busy}
              error={turnError}
              onRetry={handleRetry}

              t={t}
            />
          ) : null}
          interruptedIds={interruptedIds}
          messages={messages}
          onAsk={handleSend}
          onProposalAction={(kind, proposal) => {
            void handleProposalAction(kind, proposal);
          }}
          onRetry={handleRetry}

          proposalStates={proposalStates}
          status={chatStatus}
          t={t}
        />
    );

  return (
    <section
      aria-label={t("assistant.title")}
      className={cn("flex h-full min-h-0 w-full flex-col bg-background", className)}
    >
      <header className="flex h-14 shrink-0 items-center gap-1 border-b px-4">
        <IconSparkles aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{t("assistant.title")}</h2>
        <Button
          aria-label={t("assistant.newThread")}
          size="icon-sm"
          title={t("assistant.newThread")}
          type="button"
          variant="ghost"
          onClick={() => {
            void startNewThread();
          }}
        >
          <IconPlus aria-hidden="true" className="size-4" />
        </Button>
        <Button
          aria-label={t("assistant.history")}
          aria-expanded={historyOpen}
          size="icon-sm"
          title={t("assistant.history")}
          type="button"
          variant={historyOpen ? "secondary" : "ghost"}
          onClick={() => setHistoryOpen((open) => !open)}
        >
          <IconHistory aria-hidden="true" className="size-4" />
        </Button>
        <Button
          aria-label={t("assistant.close")}
          size="icon-sm"
          title={t("assistant.close")}
          type="button"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          <IconX aria-hidden="true" className="size-4" />
        </Button>
      </header>

      {historyOpen ? (
        <div className="shrink-0 border-b">
          <AssistantThreadList
            activeThreadId={activeThreadId}
            language={language}
            t={t}
            threads={threads}
            onOpen={(id) => {
              void openThread(id);
            }}
            onDelete={(id) => {
              void removeThread(id);
            }}
          />
        </div>
      ) : null}

      {/* The thread scrolls in its own MessageScroller; the other states
          scroll here. */}
      <div className={cn("flex min-h-0 flex-1 flex-col", hasThread ? null : "overflow-y-auto")}>{body}</div>

      {available ? (
        <AssistantComposer busy={busy} t={t} onSend={handleSend} onStop={stop} />
      ) : null}
    </section>
  );
}
