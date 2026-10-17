import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import { Button } from "@pinar/ui";
import { isToolUIPart } from "ai";
import IconLoader from "~icons/lucide/loader-circle";
import type { Translate } from "@/lib/i18n";
import {
  assistantErrorMessageKey,
  type AssistantUIMessage,
} from "./assistant-client";

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
// arguments (internal detail the UI must not expose).
function toolPartInProgress(part: AssistantPart): part is Extract<AssistantPart, { toolCallId: string; state: string }> {
  if (!isToolUIPart(part)) return false;
  return part.state === "input-available" || part.state === "input-streaming";
}

export interface AssistantMessagesProps {
  messages: readonly AssistantUIMessage[];
  onRetry: () => void;
  t: Translate;
}

function AssistantAnswer({
  message,
  onRetry,
  t,
}: {
  message: AssistantUIMessage;
  onRetry: () => void;
  t: Translate;
}) {
  const errorCode = message.metadata?.errorCode;
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
        if (toolPartInProgress(part)) {
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

export function AssistantMessages({ messages, onRetry, t }: AssistantMessagesProps) {
  return (
    <ol className="flex min-w-0 flex-col gap-3 px-4 py-3">
      {messages.map((message) => (
        <li className="min-w-0" key={message.id}>
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
            <AssistantAnswer message={message} onRetry={onRetry} t={t} />
          )}
        </li>
      ))}
    </ol>
  );
}
