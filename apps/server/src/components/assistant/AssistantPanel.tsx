import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Link } from "@tanstack/react-router";
import { Button, cn } from "@pinar/ui";
import { useGlobalSettings } from "@/components/GlobalSettingsDialog";
import type { Translate } from "@/lib/i18n";
import IconHistory from "~icons/lucide/history";
import IconPlus from "~icons/lucide/plus";
import IconSparkles from "~icons/lucide/sparkles";
import IconX from "~icons/lucide/x";
import {
  assistantErrorMessageKey,
  buildTurnRequestBody,
  deleteAssistantThread,
  fetchAssistantThread,
  fetchAssistantThreads,
  threadMessagesToUiMessages,
  type AssistantErrorKey,
  type AssistantStatus,
  type AssistantThread,
  type AssistantUIMessage,
} from "./assistant-client";
import { useAssistantPanel } from "./assistant-panel-state";
import { AssistantComposer } from "./AssistantComposer";
import { AssistantMessages } from "./AssistantMessages";
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
  const threadIdRef = useRef<string | null>(null);

  const available = status !== null && status.available;

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AssistantUIMessage>({
        api: "/api/assistant/turn",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: buildTurnRequestBody(threadIdRef.current, messages),
        }),
      }),
    [],
  );

  const {
    messages,
    sendMessage,
    setMessages,
    status: chatStatus,
    stop,
  } = useChat<AssistantUIMessage>({
    onData: (dataPart) => {
      // First part of the turn stream: the id of a new conversation.
      if (dataPart.type !== "data-thread") return;
      const data = dataPart.data;
      if (typeof data !== "object" || data === null || !("id" in data)) return;
      const id = data.id;
      if (typeof id !== "string" || id === "") return;
      const title = "title" in data && typeof data.title === "string" ? data.title : "";
      threadIdRef.current = id;
      setThreads((current) => {
        const now = new Date().toISOString();
        const entry: AssistantThread = { createdAt: now, id, title, updatedAt: now };
        return [entry, ...(current ?? []).filter((existing) => existing.id !== id)];
      });
    },
    onError: (error) => {
      // Stream failures deliver the AssistantErrorCode as the error text.
      setTurnErrorKey(assistantErrorMessageKey(error.message));
    },
    transport,
  });

  const busy = chatStatus === "submitted" || chatStatus === "streaming";

  const refreshThreads = useCallback(async () => {
    const value = await fetchAssistantThreads().catch(() => null);
    setThreads(value);
  }, []);

  useEffect(() => {
    if (!available) return;
    void refreshThreads();
  }, [available, refreshThreads]);

  function startNewThread() {
    threadIdRef.current = null;
    setMessages([]);
    setTurnErrorKey(null);
    setHistoryOpen(false);
  }

  async function openThread(id: string) {
    if (id === threadIdRef.current) return;
    const loaded = await fetchAssistantThread(id);
    if (!loaded) {
      // The thread vanished (deleted elsewhere): refresh the list.
      void refreshThreads();
      return;
    }
    threadIdRef.current = id;
    setTurnErrorKey(null);
    setHistoryOpen(false);
    setMessages(threadMessagesToUiMessages(loaded.messages));
  }

  async function removeThread(id: string) {
    const deleted = await deleteAssistantThread(id).catch(() => false);
    if (!deleted) {
      void refreshThreads();
      return;
    }
    setThreads((current) => (current ?? []).filter((item) => item.id !== id));
    if (id === threadIdRef.current) startNewThread();
  }

  function handleSend(text: string) {
    setTurnErrorKey(null);
    void sendMessage({ text });
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
        <AssistantMessages messages={messages} onRetry={handleRetry} t={t} />
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
          onClick={startNewThread}
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
            activeThreadId={threadIdRef.current}
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
