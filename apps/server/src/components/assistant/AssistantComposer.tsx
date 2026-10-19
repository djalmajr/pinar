import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@pinar/ui";
import type { Translate } from "@/lib/i18n";
import IconArrowUp from "~icons/lucide/arrow-up";
import IconSquare from "~icons/lucide/square";

const MAX_AUTO_SIZE_LINES = 6;

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

  // The Skia's composer (skedly skia-composer.tsx): the field and its
  // actions in one InputGroup, with icon buttons that say what they do in
  // the tooltip and the aria-label. While a turn runs only the field fades:
  // Stop stays active and must not look disabled.
  return (
    <div className="shrink-0 px-4 pt-2 pb-3">
      <form
        className="w-full"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <InputGroup className="bg-muted has-disabled:opacity-100">
          <InputGroupTextarea
            aria-label={t("assistant.placeholder")}
            className="min-h-10 flex-none overflow-y-auto px-3 py-2 text-sm placeholder:text-foreground/60"
            disabled={busy}
            placeholder={t("assistant.placeholder")}
            ref={textareaRef}
            rows={1}
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
          />
          <InputGroupAddon align="block-end" className="justify-end p-1.5">
            {busy ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <InputGroupButton
                      aria-label={t("assistant.stop")}
                      className="rounded-full"
                      data-testid="assistant-stop"
                      onClick={onStop}
                      size="icon-sm"
                      type="button"
                      variant="default"
                    />
                  }
                >
                  <IconSquare aria-hidden="true" className="size-3.5 fill-current" />
                </TooltipTrigger>
                <TooltipContent>{t("assistant.stop")}</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <InputGroupButton
                      aria-label={t("assistant.send")}
                      className="rounded-full data-disabled:opacity-50"
                      data-testid="assistant-send"
                      disabled={!canSend}
                      size="icon-sm"
                      type="submit"
                      variant="default"
                    />
                  }
                >
                  <IconArrowUp aria-hidden="true" className="size-4" />
                </TooltipTrigger>
                <TooltipContent>{t("assistant.send")}</TooltipContent>
              </Tooltip>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}
