import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Button, cn, TooltipButton } from "@pinar/ui";
import type { Translate } from "@/lib/i18n";
import IconCoins from "~icons/lucide/coins";
import IconRotateCcw from "~icons/lucide/rotate-ccw";

// The Skia's turn notices (skedly skia-chat-ready.tsx SkiaTurnError and the
// interrupted answer of skia-message-list.tsx) on the Pinar kit.

/** "Tentar de novo" with only the icon: the tooltip and the aria-label say what it does. */
export function AssistantRetryButton({ disabled = false, onRetry, t }: { disabled?: boolean; onRetry: () => void; t: Translate }) {
  return (
    <TooltipButton
      aria-label={t("assistant.retry")}
      className="shrink-0 data-disabled:opacity-50"
      data-testid="assistant-retry"
      disabled={disabled}
      onClick={onRetry}
      size="icon-xs"
      tooltip={t("assistant.retry")}
      type="button"
      variant="ghost"
    >
      <IconRotateCcw aria-hidden="true" className="size-4" />
    </TooltipButton>
  );
}

export function AssistantTurnErrorText({
  className,
  detail = null,
  disabled = false,
  message,
  onRetry,

  t,
}: {
  className?: string;
  detail?: ReactNode;
  disabled?: boolean;
  message: string;
  onRetry: () => void;

  t: Translate;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)} data-testid="assistant-turn-error" role="alert">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]">{message}</p>
        <div className="flex shrink-0 items-center gap-1">
          <AssistantRetryButton disabled={disabled} onRetry={onRetry} t={t} />
        </div>
      </div>
      {detail}
    </div>
  );
}

/**
 * Lack of credits: its own card with the balance and the purchase link the
 * Pinar already has (/pricing), in place of the Skia's SkiaBuyCreditsCard.
 * No retry: the same question would be refused again.
 */
export function AssistantNoCreditsCard({
  className,
  credits,
  t,
}: {
  className?: string;
  credits: { balance: number; required: number } | null;
  t: Translate;
}) {
  return (
    <div
      className={cn("flex min-w-0 flex-col items-start gap-2 rounded-xl border bg-card p-3 text-card-foreground", className)}
      data-testid="assistant-no-credits"
      role="alert"
    >
      <p className="flex items-start gap-2 text-sm">
        <IconCoins aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {credits
            ? t("assistant.errorNoCredits", { count: credits.balance, required: credits.required })
            : t("viewer.aiNoCredits")}
        </span>
      </p>
      <Button render={<Link to="/pricing" />} size="sm" type="button" variant="outline">
        {t("assistant.buyCredits")}
      </Button>
    </div>
  );
}

/** "Resposta interrompida", with the retry when the turn is the last one. */
export function AssistantInterruptedMark({
  align = "start",
  disabled,
  onRetry,
  t,
}: {
  align?: "end" | "start";
  disabled: boolean;
  /** null when a later turn already followed. */
  onRetry: (() => void) | null;
  t: Translate;
}) {
  return (
    <div
      className={cn("flex items-center gap-1 px-1", align === "end" ? "justify-end" : null)}
      data-testid="assistant-interrupted"
    >
      <span className="text-[11px] text-muted-foreground">{t("assistant.interrupted")}</span>
      {onRetry !== null ? <AssistantRetryButton disabled={disabled} onRetry={onRetry} t={t} /> : null}
    </div>
  );
}
