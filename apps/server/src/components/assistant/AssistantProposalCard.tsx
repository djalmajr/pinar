import { type ReactNode, useEffect, useState } from "react";
import { Badge, Button } from "@pinar/ui";
import IconLoader from "~icons/lucide/loader-circle";
import type { MessageValues, Translate } from "@/lib/i18n";
import {
  ASSISTANT_RESOURCE_TYPES,
  assistantProposalErrorKey,
  type AssistantProposalActionKind,
  type AssistantProposalErrorKey,
  type AssistantPublicProposal,
  type AssistantResourceType,
} from "./assistant-client";

const MINUTE_MS = 60_000;

/** Whole minutes left until `deadline` (ms), rounded up; 0 once it passed or when it is not a date. */
function minutesLeft(deadline: number | null, now: number): number {
  if (deadline === null || !(deadline > now)) return 0;
  return Math.ceil((deadline - now) / MINUTE_MS);
}

function parseTimestamp(value: string | null): number | null {
  if (value === null) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** The deadline the card counts down to: the expiry while proposed, the undo window once executed. */
export function proposalDeadline(proposal: AssistantPublicProposal): number | null {
  if (proposal.status === "proposed") return parseTimestamp(proposal.expiresAt);
  if (proposal.status === "executed") return parseTimestamp(proposal.undoExpiresAt);
  return null;
}

/**
 * The delay (ms) until the whole minutes left before `deadline` change next;
 * null when there is no deadline or it already passed (no timer needed).
 */
export function nextMinuteTick(deadline: number | null, now: number): number | null {
  if (deadline === null) return null;
  const left = deadline - now;
  if (!(left > 0)) return null;
  return left % MINUTE_MS || MINUTE_MS;
}

/** The clock and timers the countdown runs on. */
export interface MinuteClockScheduler<Timer> {
  clearTimeout: (timer: Timer) => void;
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => Timer;
}

const browserScheduler: MinuteClockScheduler<ReturnType<typeof setTimeout>> = {
  clearTimeout: (timer) => clearTimeout(timer),
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
};

/**
 * Call `onTick` each time the whole minutes left before `deadline` change,
 * the last time when it passes. Returns the cancel: it clears the pending
 * timer, and no tick runs after it.
 */
export function watchMinutesLeft<Timer>(
  deadline: number | null,
  onTick: () => void,
  scheduler: MinuteClockScheduler<Timer>,
): () => void {
  let active = true;
  let timer: Timer | null = null;
  const arm = () => {
    const delay = nextMinuteTick(deadline, scheduler.now());
    if (delay === null) return;
    timer = scheduler.setTimeout(() => {
      timer = null;
      onTick();
      // A tick that cancelled the countdown (a re-render that unmounted the card) arms nothing.
      if (active) arm();
    }, delay);
  };
  arm();
  return () => {
    active = false;
    if (timer !== null) scheduler.clearTimeout(timer);
    timer = null;
  };
}

/**
 * The current time, read on every render. While `deadline` is ahead, a timer
 * re-renders the card each time the whole minutes left change, and stops
 * once it passed; a new deadline (the proposal changed state) or the unmount
 * cancels it.
 */
function useMinuteClock(deadline: number | null): number {
  const [, setTick] = useState(0);
  useEffect(() => watchMinutesLeft(deadline, () => setTick((value) => value + 1), browserScheduler), [deadline]);
  return Date.now();
}

function isResourceType(value: string): value is AssistantResourceType {
  return (ASSISTANT_RESOURCE_TYPES as readonly string[]).includes(value);
}

/** The display params, with the share `kind` translated by `assistant.resource.<kind>`. */
function proposalValues(proposal: AssistantPublicProposal, t: Translate): MessageValues {
  const values: MessageValues = { ...proposal.display.params };
  const kind = values.kind;
  if (typeof kind === "string" && isResourceType(kind)) values.kind = t(`assistant.resource.${kind}`);
  return values;
}

export interface AssistantProposalCardProps {
  /** A note for the last action that did not settle the proposal (network, 404, ...). */
  errorKey: AssistantProposalErrorKey | null;
  onAction: (kind: AssistantProposalActionKind) => void;
  /** An action of this card is in flight: its buttons are disabled. */
  pending: boolean;
  /** The most recent state of the proposal the client received. */
  proposal: AssistantPublicProposal;
  t: Translate;
}

/**
 * A write the assistant proposed (contract section 4): the translated action,
 * the risk badge and the state; Confirm and Reject while it is proposed, Undo
 * while the undo window is open. Ids never reach the markup: the text comes
 * only from the action key and its params (names and counts).
 */
export function AssistantProposalCard({ errorKey, onAction, pending, proposal, t }: AssistantProposalCardProps) {
  const expiresAt = parseTimestamp(proposal.expiresAt);
  const undoExpiresAt = parseTimestamp(proposal.undoExpiresAt);
  const now = useMinuteClock(proposalDeadline(proposal));
  const expiresInMinutes = minutesLeft(expiresAt, now);
  const undoMinutes = minutesLeft(undoExpiresAt, now);
  // A proposal whose expiry passed while the card was open reads as expired,
  // the same lazy status the server applies.
  const status = proposal.status === "proposed" && expiresInMinutes === 0 ? "expired" : proposal.status;
  const showRisk = status === "proposed" || status === "executing" || status === "executed";

  let state: ReactNode;
  switch (status) {
    case "proposed":
      state = (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={pending}
            onClick={() => onAction("confirm")}
            size="sm"
            type="button"
            variant={proposal.risk === "irreversible" ? "destructive" : "default"}
          >
            {t("assistant.proposalConfirm")}
          </Button>
          <Button disabled={pending} onClick={() => onAction("reject")} size="sm" type="button" variant="outline">
            {t("assistant.proposalReject")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("assistant.proposalExpiresIn", { minutes: expiresInMinutes })}
          </span>
        </div>
      );
      break;
    case "executing":
    case "undoing":
      state = (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <IconLoader aria-hidden="true" className="size-3 animate-spin" />
          {t("assistant.proposalExecuting")}
        </p>
      );
      break;
    case "executed":
      state = (
        <div className="flex flex-col items-start gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-foreground">{t("assistant.proposalExecuted")}</span>
            {undoMinutes > 0 ? (
              <>
                <Button disabled={pending} onClick={() => onAction("undo")} size="sm" type="button" variant="outline">
                  {t("assistant.proposalUndo")}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {t("assistant.proposalUndoIn", { minutes: undoMinutes })}
                </span>
              </>
            ) : null}
          </div>
          {proposal.errorCode !== null ? (
            <p className="text-xs text-muted-foreground">{t(assistantProposalErrorKey(proposal.errorCode))}</p>
          ) : null}
        </div>
      );
      break;
    case "failed":
      state = (
        <p className="text-xs text-destructive">
          {t(assistantProposalErrorKey(proposal.errorCode ?? "proposal_failed"))}
        </p>
      );
      break;
    case "rejected":
      state = <p className="text-xs text-muted-foreground">{t("assistant.proposalRejected")}</p>;
      break;
    case "expired":
      state = <p className="text-xs text-muted-foreground">{t("assistant.proposalExpired")}</p>;
      break;
    case "undone":
      state = <p className="text-xs text-muted-foreground">{t("assistant.proposalUndone")}</p>;
      break;
  }

  return (
    <div aria-busy={pending} className="flex min-w-0 flex-col gap-2 rounded-md border bg-card p-3 text-sm">
      <p className="text-foreground [overflow-wrap:anywhere]">
        {t(`assistant.proposal.${proposal.display.action}`, proposalValues(proposal, t))}
      </p>
      {showRisk && proposal.risk === "irreversible" ? (
        <Badge variant="warning">{t("assistant.proposalIrreversible")}</Badge>
      ) : null}
      {showRisk && proposal.risk === "external" ? (
        <Badge variant="outline">{t("assistant.proposalExternal")}</Badge>
      ) : null}
      {state}
      {errorKey !== null ? (
        <p className="text-xs text-destructive" role="alert">{t(errorKey)}</p>
      ) : null}
    </div>
  );
}
