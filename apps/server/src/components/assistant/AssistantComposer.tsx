import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Button } from "@pinar/ui";
import type { Translate } from "@/lib/i18n";

const MAX_AUTO_SIZE_LINES = 6;

// Same input classes as the viewer comment field (PinDiscussion): @pinar/ui
// has no Textarea, so the bare element carries the shared classes.
const INPUT_CLASSES =
  "min-h-20 w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30 dark:disabled:bg-input/80";

// Grows with the text up to six lines, then scrolls.
function autosize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  const computed = getComputedStyle(el);
  let lineHeight = parseFloat(computed.lineHeight);
  if (!Number.isFinite(lineHeight)) {
    lineHeight = 1.25 * (parseFloat(computed.fontSize) || 14);
  }
  const paddingTop = parseFloat(computed.paddingTop) || 0;
  const paddingBottom = parseFloat(computed.paddingBottom) || 0;
  const borderTop = parseFloat(computed.borderTopWidth) || 0;
  const borderBottom = parseFloat(computed.borderBottomWidth) || 0;
  const max = MAX_AUTO_SIZE_LINES * lineHeight + paddingTop + paddingBottom + borderTop + borderBottom;
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
}

export interface AssistantComposerProps {
  /** A turn is in flight: the send button becomes the stop action. */
  busy: boolean;
  t: Translate;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function AssistantComposer({ busy, t, onSend, onStop }: AssistantComposerProps) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canSend = !busy && draft.trim().length > 0;

  function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    onSend(text);
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setDraft(event.target.value);
    autosize(event.target);
  }

  // Re-autosizes after the draft resets (e.g. a sent message). The element
  // is controlled, so the height follows the state, not a manual write.
  useEffect(() => {
    if (textareaRef.current) autosize(textareaRef.current);
  }, [draft]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a line break (and composing Enter in
    // IMEs never sends).
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  return (
    <div className="shrink-0 border-t px-4 py-3">
      <form
        className="flex min-w-0 flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          aria-label={t("assistant.placeholder")}
          className={INPUT_CLASSES}
          disabled={busy}
          placeholder={t("assistant.placeholder")}
          ref={textareaRef}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
        <div className="flex items-center justify-end">
          {busy ? (
            <Button size="sm" type="button" onClick={onStop}>
              {t("assistant.stop")}
            </Button>
          ) : (
            <Button disabled={!canSend} size="sm" type="submit">
              {t("assistant.send")}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
