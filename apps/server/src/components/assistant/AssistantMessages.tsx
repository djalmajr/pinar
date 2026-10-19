import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import { Button } from "@pinar/ui";
import { isToolUIPart } from "ai";
import IconLoader from "~icons/lucide/loader-circle";
import type { Translate } from "@/lib/i18n";
import {
  assistantErrorMessageKey,
  assistantMessageAsk,
  assistantMessageProposals,
  type AssistantProposalActionKind,
  type AssistantProposalErrorKey,
  type AssistantPublicProposal,
  type AssistantUIMessage,
} from "./assistant-client";
import { AssistantProposalCard } from "./AssistantProposalCard";

type AssistantPart = AssistantUIMessage["parts"][number];

/** Same safe-Markdown pattern as the viewer thread (PinDiscussion):
 *  react-markdown never injects raw HTML and every URL passes through
 *  defaultUrlTransform, which drops javascript:/data: and other unsafe
 *  protocols; links open in a new tab without referrer leakage. */
const assistantMarkdownComponents: Components = {
  a: (props) => (
    <a {...props} rel="noreferrer noopener" target="_blank" />
  ),
  blockquote: (props) => (
    <blockquote className="my-2 border-l-4 pl-3 [overflow-wrap:anywhere]" {...props} />
  ),
  code: (props) => (
    <code className="break-words rounded border bg-muted px-1 font-mono text-xs [overflow-wrap:anywhere]" {...props} />
  ),
  ol: (props) => (
    <ol className="my-2 list-decimal pl-5" {...props} />
  ),
  p: (props) => (
    <p className="whitespace-pre-wrap [overflow-wrap:anywhere]" {...props} />
  ),
  pre: (props) => (
    <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted p-2 text-xs [overflow-wrap:anywhere] [&_code]:rounded-none [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0" {...props} />
  ),
  ul: (props) => (
    <ul className="my-2 list-disc pl-5" {...props} />
  ),
};

// A tool call still running shows one discreet line: no tool name, no
// arguments (internal detail the UI must not expose). Only while the chat
// is working (submitted or streaming) and only in the current turn: after an
// error or an abort the part stays "input-available" forever, and the line
// goes (as the Skia's getSkiaWorkingState).
function toolPartInProgress(part: AssistantPart): part is Extract<AssistantPart, { toolCallId: string; state: string }> {
  if (!isToolUIPart(part)) return false;
  return part.state === "input-available" || part.state === "input-streaming";
}

/** What the panel knows about a proposal beyond the message part that carried it. */
export interface AssistantProposalCardState {
  errorKey: AssistantProposalErrorKey | null;
  pending: boolean;
  /** The proposal of the last action answer (or refetch); null until there is one. */
  proposal: AssistantPublicProposal | null;
}

export interface AssistantMessagesProps {
  /** A turn is in flight: the ask options are disabled. */
  busy: boolean;
  messages: readonly AssistantUIMessage[];
  /** An ask option was picked: send it as the next user message. */
  onAsk: (option: string) => void;
  onProposalAction: (kind: AssistantProposalActionKind, proposal: AssistantPublicProposal) => void;
  onRetry: () => void;
  /** The same request with useCredits for this send only (F5/S4). */
  onRetryWithCredits: () => void;
  /** Per proposal id; a proposal without an entry shows the state its part carried. */
  proposalStates: Readonly<Record<string, AssistantProposalCardState>>;
  t: Translate;
}

function AssistantAnswer({
  message,
  onRetry,
  onRetryWithCredits,
  t,
  working,
}: {
  message: AssistantUIMessage;
  onRetry: () => void;
  onRetryWithCredits: () => void;
  t: Translate;
  /** The chat is working on this message's turn. */
  working: boolean;
}) {
  const errorCode = message.metadata?.errorCode;
  if (errorCode === "byok_error") {
    // A stored BYOK failure: the cause is not stored with the message (F5/S3
    // records the code only), so the generic BYOK note and the two actions.
    return (
      <div className="flex min-w-0 flex-col items-start gap-2" role="alert">
        <p className="text-sm text-destructive">{t("byok.errorGeneric")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onRetry} size="sm" type="button" variant="outline">
            {t("assistant.retry")}
          </Button>
          <Button onClick={onRetryWithCredits} size="sm" type="button" variant="outline">
            {t("byok.useCredits")}
          </Button>
        </div>
      </div>
    );
  }
  if (errorCode !== undefined) {
    // A stored turn failure: the message has no text; show the translated
    // error note and the retry action instead.
    return (
      <div className="flex min-w-0 flex-col items-start gap-2" role="alert">
        <p className="text-sm text-destructive">{t(assistantErrorMessageKey(errorCode))}</p>
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          {t("assistant.retry")}
        </Button>
      </div>
    );
  }
  return (
    <div className="min-w-0 text-sm text-foreground">
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          return (
            <ReactMarkdown
              components={assistantMarkdownComponents}
              key={`text-${index}`}
              urlTransform={defaultUrlTransform}
            >
              {part.text}
            </ReactMarkdown>
          );
        }
        if (working && toolPartInProgress(part)) {
          return (
            <p key={`tool-${part.toolCallId ?? index}`} className="flex items-center gap-2 text-xs text-muted-foreground">
              <IconLoader aria-hidden="true" className="size-3 animate-spin" />
              {t("assistant.working")}
            </p>
          );
        }
        return null;
      })}
    </div>
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
        <p className="whitespace-pre-wrap text-sm text-foreground [overflow-wrap:anywhere]">{ask.question}</p>
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
  busy,
  messages,
  onAsk,
  onProposalAction,
  onRetry,
  onRetryWithCredits,
  proposalStates,
  t,
}: AssistantMessagesProps) {
  // The current turn starts at the last user message: an earlier answer has
  // already ended.
  const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
  return (
    <ol className="flex min-w-0 flex-col gap-3 px-4 py-3">
      {messages.map((message, index) => (
        <li className="flex min-w-0 flex-col gap-2" key={message.id}>
          {message.role === "user" ? (
            <div className="min-w-0">
              {message.parts
                .filter((part) => part.type === "text")
                .map((part, index) => (
                  <p className="whitespace-pre-wrap text-sm text-foreground [overflow-wrap:anywhere]" key={`part-${index}`}>
                    {part.text}
                  </p>
                ))}
            </div>
          ) : (
            <>
              <AssistantAnswer
                message={message}
                onRetry={onRetry}
                onRetryWithCredits={onRetryWithCredits}
                t={t}
                working={busy && index > lastUserIndex}
              />
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
          )}
        </li>
      ))}
    </ol>
  );
}
