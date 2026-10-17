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

/**
 * The current time, read on every render. While `deadline` is ahead, a timer
 * re-renders the card each time the whole minutes left change, and stops
 * once it passed.
 */
function useMinuteClock(deadline: number | null): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (deadline === null) return;
    const left = deadline - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => setTick((value) => value + 1), left % MINUTE_MS || MINUTE_MS);
    return () => clearTimeout(timer);
  }, [deadline, tick]);
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
  const deadline = proposal.status === "proposed"
    ? expiresAt
    : proposal.status === "executed"
      ? undoExpiresAt
      : null;
  const now = useMinuteClock(deadline);
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
