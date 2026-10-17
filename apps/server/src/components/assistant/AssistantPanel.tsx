import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { Link } from "@tanstack/react-router";
import { Button, cn } from "@pinar/ui";
import { useGlobalSettings } from "@/components/GlobalSettingsDialog";
import type { Translate } from "@/lib/i18n";
import IconHistory from "~icons/lucide/history";
import IconPlus from "~icons/lucide/plus";
import IconSparkles from "~icons/lucide/sparkles";
import IconX from "~icons/lucide/x";
import {
  assistantErrorFromChatError,
  assistantErrorMessageKey,
  buildTurnRequestBody,
  deleteAssistantThread,
  fetchAssistantThreads,
  runAssistantProposalAction,
  type AssistantErrorKey,
  type AssistantProposalActionKind,
  type AssistantPublicProposal,
  type AssistantStatus,
  type AssistantThread,
} from "./assistant-client";
import {
  createAssistantConversation,
  openAssistantConversation,
  startAssistantConversation,
  stopAssistantConversation,
  type AssistantConversation,
  type AssistantConversationHooks,
} from "./assistant-conversation";
import { useAssistantPanel } from "./assistant-panel-state";
import { AssistantComposer } from "./AssistantComposer";
import { AssistantMessages, type AssistantProposalCardState } from "./AssistantMessages";
import { AssistantThreadList } from "./AssistantThreadList";

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
  const [turnErrorKey, setTurnErrorKey] = useState<AssistantErrorKey | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  // Card state per proposal id: the most recent proposal an action answer
  // (or a 409 refetch) returned, the in-flight flag and the action note.
  // Reset on every conversation switch: a reopened thread brings its own
  // fresher proposals. Ids are unique, so a late answer for a conversation
  // already left only fills an entry no card reads.
  const [proposalStates, setProposalStates] = useState<Record<string, AssistantProposalCardState>>({});
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
        // The transport delivers the JSON error body as the error message;
        // only the mapped i18n key is ever shown, never the raw text.
        setTurnErrorKey(assistantErrorMessageKey(assistantErrorFromChatError(error)));
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
    setTurnErrorKey(null);
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
    setTurnErrorKey(null);
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
    setTurnErrorKey(null);
    void sendMessage({ text });
  }

  // One action per proposal at a time: the ref drops a second click before
  // React re-renders the disabled buttons.
  async function handleProposalAction(kind: AssistantProposalActionKind, proposal: AssistantPublicProposal) {
    const inFlight = proposalsInFlightRef.current;
    if (inFlight.has(proposal.id)) return;
    inFlight.add(proposal.id);
    setProposalStates((current) => ({
      ...current,
      [proposal.id]: { errorKey: null, pending: true, proposal: current[proposal.id]?.proposal ?? null },
    }));
    try {
      const outcome = await runAssistantProposalAction(kind, proposal);
      setProposalStates((current) => ({
        ...current,
        [proposal.id]: { errorKey: outcome.errorKey, pending: false, proposal: outcome.proposal },
      }));
    } finally {
      inFlight.delete(proposal.id);
    }
  }

  function handleRetry() {
    const text = buildTurnRequestBody(null, messages).text;
    if (!text) return;
    setTurnErrorKey(null);
    void sendMessage({ text });
  }

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
      <>
        <AssistantMessages
          busy={busy}
          messages={messages}
          onAsk={handleSend}
          onProposalAction={(kind, proposal) => {
            void handleProposalAction(kind, proposal);
          }}
          onRetry={handleRetry}
          proposalStates={proposalStates}
          t={t}
        />
        {turnErrorKey !== null ? (
          <div className="flex flex-col items-start gap-2 px-4 pb-3" role="alert">
            <p className="text-sm text-destructive">{t(turnErrorKey)}</p>
            <Button onClick={handleRetry} size="sm" type="button" variant="outline">
              {t("assistant.retry")}
            </Button>
          </div>
        ) : null}
      </>
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

      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>

      {available ? (
        <AssistantComposer busy={busy} t={t} onSend={handleSend} onStop={stop} />
      ) : null}
    </section>
  );
}
