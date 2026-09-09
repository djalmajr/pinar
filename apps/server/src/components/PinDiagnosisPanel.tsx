import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { asPinDiagnosis, type DiagnosisConfidence, type Pin, type PinDiagnosis } from "@pinar/shared";
import { Badge, Button } from "@pinar/ui";
import { isRecord } from "@/lib/api-data";
import { useServerI18n, type ServerMessageKey } from "@/lib/i18n";
import CheckIcon from "~icons/lucide/check";
import LoaderCircleIcon from "~icons/lucide/loader-circle";
import PencilIcon from "~icons/lucide/pencil";
import StethoscopeIcon from "~icons/lucide/stethoscope";
import Trash2Icon from "~icons/lucide/trash-2";
import TriangleAlertIcon from "~icons/lucide/triangle-alert";
import XIcon from "~icons/lucide/x";

export const PIN_DIAGNOSIS_CREDITS = 3;

interface PinDiagnosisPanelProps {
  canEdit: boolean;
  pin: Pin;
  sessionId: string;
  showAi: boolean;
  onPersist: (fields: Record<string, unknown>) => Promise<boolean>;
}

interface DiagnosisBodyProps {
  diagnosis: PinDiagnosis;
}

type AiRecovery = "pricing" | "retry" | "signIn" | null;

const CONFIDENCE_LABELS: Record<DiagnosisConfidence, ServerMessageKey> = {
  high: "viewer.diagnosisConfidenceHigh",
  low: "viewer.diagnosisConfidenceLow",
  medium: "viewer.diagnosisConfidenceMedium",
};

const CONFIDENCE_VARIANTS: Record<DiagnosisConfidence, "outline" | "success" | "warning"> = {
  high: "success",
  low: "outline",
  medium: "warning",
};

const TEXTAREA_CLASS = "min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function ConfidenceBadge({ confidence }: { confidence: DiagnosisConfidence }) {
  const { t } = useServerI18n();
  return <Badge variant={CONFIDENCE_VARIANTS[confidence]}>{t(CONFIDENCE_LABELS[confidence])}</Badge>;
}

function DiagnosisBody({ diagnosis }: DiagnosisBodyProps) {
  const { t } = useServerI18n();
  return (
    <div className="flex flex-col gap-3">
      {diagnosis.confidence === "low" ? (
        <p className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          {t("viewer.diagnosisLowConfidenceNote")}
        </p>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">{t("viewer.diagnosisCause")}</p>
        <p className="text-sm leading-relaxed [overflow-wrap:anywhere]">{diagnosis.cause}</p>
      </div>
      {diagnosis.properties.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">{t("viewer.diagnosisProperties")}</p>
          <ul className="flex flex-wrap gap-1">
            {diagnosis.properties.map((property) => (
              <li key={property}>
                <code className="rounded-md border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px]">{property}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">{t("viewer.diagnosisFix")}</p>
        {diagnosis.fix ? (
          <pre className="overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{diagnosis.fix}</pre>
        ) : (
          <p className="text-xs text-muted-foreground">{t("viewer.diagnosisNoFix")}</p>
        )}
      </div>
    </div>
  );
}

export function PinDiagnosisPanel({ canEdit, pin, sessionId, showAi, onPersist }: PinDiagnosisPanelProps) {
  const { language, t } = useServerI18n();
  const [proposal, setProposal] = useState<PinDiagnosis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<AiRecovery>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftCause, setDraftCause] = useState("");
  const [draftFix, setDraftFix] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const requestId = useRef<string | null>(null);

  const accepted = pin.diagnosis?.acceptedAt ? pin.diagnosis : null;
  const pinId = pin.pinId || pin.id || "";

  async function diagnose() {
    if (loading) return;
    setError("");
    setRecovery(null);
    setSaveFailed(false);
    setLoading(true);
    requestId.current ||= `ai_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      const response = await fetch("/api/ai/pin-diagnosis", {
        body: JSON.stringify({ language, pinId, requestId: requestId.current, sessionId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const data: unknown = await response.json();
      const result = isRecord(data) ? asPinDiagnosis(data.result) : undefined;
      if (!response.ok || !result) {
        const code = isRecord(data) && typeof data.code === "string" ? data.code : "";
        if (code !== "ai_request_in_progress" && code !== "ai_refund_pending") requestId.current = null;
        if (response.status === 401) {
          setError(t("viewer.aiSignIn"));
          setRecovery("signIn");
        } else if (code === "ai_requires_paid" || code === "insufficient_ai_credits") {
          setError(t("viewer.aiNoCredits"));
          setRecovery("pricing");
        } else if (code === "ai_rate_limited") {
          setError(t("viewer.aiRateLimited"));
          setRecovery("retry");
        } else if (code === "ai_refund_pending") {
          setError(t("viewer.aiRefundPending"));
          setRecovery("retry");
        } else if (code === "snapshot_required") {
          setError(t("viewer.diagnosisNeedsSnapshot"));
          setRecovery(null);
        } else {
          setError(t("viewer.aiUnavailable"));
          setRecovery("retry");
        }
        return;
      }
      if (isRecord(data) && isRecord(data.aiCredits) && typeof data.aiCredits.balance === "number") {
        setCreditsRemaining(data.aiCredits.balance);
      }
      requestId.current = null;
      setProposal(result);
      setEditing(false);
    } catch {
      setError(t("viewer.aiNetworkError"));
      setRecovery("retry");
    } finally {
      setLoading(false);
    }
  }

  async function accept(diagnosis: PinDiagnosis, edited: boolean) {
    if (saving) return;
    setSaving(true);
    setSaveFailed(false);
    const persisted = await onPersist({
      diagnosis: {
        ...diagnosis,
        acceptedAt: new Date().toISOString(),
        ...(edited ? { edited: true } : {}),
      },
    });
    setSaving(false);
    if (!persisted) {
      setSaveFailed(true);
      return;
    }
    setProposal(null);
    setEditing(false);
  }

  async function discardAccepted() {
    if (saving) return;
    setSaving(true);
    setSaveFailed(false);
    const persisted = await onPersist({ diagnosis: null });
    setSaving(false);
    if (!persisted) setSaveFailed(true);
  }

  function startEditing(diagnosis: PinDiagnosis) {
    setDraftCause(diagnosis.cause);
    setDraftFix(diagnosis.fix);
    setEditing(true);
  }

  function discardProposal() {
    setProposal(null);
    setEditing(false);
    setSaveFailed(false);
  }

  const saveError = saveFailed ? (
    <p className="text-xs text-destructive">{t("viewer.diagnosisSaveFailed")}</p>
  ) : null;

  if (accepted) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{t("viewer.diagnosisAccepted")}</p>
            <ConfidenceBadge confidence={accepted.confidence} />
            {accepted.edited ? <Badge variant="secondary">{t("viewer.diagnosisEdited")}</Badge> : null}
          </div>
          {canEdit ? (
            <Button disabled={saving} size="sm" type="button" variant="ghost" onClick={() => void discardAccepted()}>
              <Trash2Icon className="size-3.5" />
              {t("viewer.diagnosisDiscard")}
            </Button>
          ) : null}
        </div>
        <DiagnosisBody diagnosis={accepted} />
        {saveError}
      </div>
    );
  }

  if (!showAi) return null;

  if (!pin.snapshot) {
    return <p className="text-xs text-muted-foreground">{t("viewer.diagnosisNeedsSnapshot")}</p>;
  }

  if (proposal) {
    const draftValid = draftCause.trim().length > 0;
    return (
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{t("viewer.diagnosisProposal")}</p>
          <ConfidenceBadge confidence={proposal.confidence} />
        </div>
        {editing ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">{t("viewer.diagnosisCause")}</span>
              <textarea
                aria-invalid={!draftValid}
                className={TEXTAREA_CLASS}
                value={draftCause}
                onChange={(event) => setDraftCause(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">{t("viewer.diagnosisFix")}</span>
              <textarea
                className={`${TEXTAREA_CLASS} font-mono text-xs`}
                spellCheck={false}
                value={draftFix}
                onChange={(event) => setDraftFix(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={saving || !draftValid}
                size="sm"
                type="button"
                onClick={() => void accept({ ...proposal, cause: draftCause.trim(), fix: draftFix.trim() }, true)}
              >
                <CheckIcon className="size-3.5" />
                {t("viewer.diagnosisAccept")}
              </Button>
              <Button disabled={saving} size="sm" type="button" variant="ghost" onClick={() => setEditing(false)}>
                <XIcon className="size-3.5" />
                {t("viewer.diagnosisCancelEdit")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <DiagnosisBody diagnosis={proposal} />
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={saving || !canEdit} size="sm" type="button" onClick={() => void accept(proposal, false)}>
                <CheckIcon className="size-3.5" />
                {t("viewer.diagnosisAccept")}
              </Button>
              <Button disabled={saving || !canEdit} size="sm" type="button" variant="outline" onClick={() => startEditing(proposal)}>
                <PencilIcon className="size-3.5" />
                {t("viewer.diagnosisEdit")}
              </Button>
              <Button disabled={saving} size="sm" type="button" variant="ghost" onClick={discardProposal}>
                <Trash2Icon className="size-3.5" />
                {t("viewer.diagnosisDiscard")}
              </Button>
            </div>
          </>
        )}
        {creditsRemaining !== null ? (
          <p className="text-xs text-muted-foreground">{t("viewer.diagnosisCreditsRemaining", { count: creditsRemaining })}</p>
        ) : null}
        {saveError}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t("viewer.diagnosis")}</p>
          <p className="text-xs text-muted-foreground">{t("viewer.diagnosisDescription")}</p>
        </div>
        <Button disabled={loading} size="sm" type="button" variant="outline" onClick={() => void diagnose()}>
          {loading ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <StethoscopeIcon className="size-3.5" />}
          {loading ? t("viewer.diagnosisLoading") : t("viewer.diagnosisAction")}
          {loading ? null : <span className="text-muted-foreground">· {t("viewer.diagnosisCost", { count: PIN_DIAGNOSIS_CREDITS })}</span>}
        </Button>
      </div>
      {error ? (
        <div className="flex flex-col items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <p>{error}</p>
          {recovery === "signIn" ? (
            <Button render={<a href={`/sign-in?returnTo=${encodeURIComponent(`/v/${sessionId}`)}`} />} size="sm" variant="outline">
              {t("viewer.aiSignInAction")}
            </Button>
          ) : recovery === "pricing" ? (
            <Button render={<Link preload="intent" to="/pricing" />} size="sm" variant="outline">
              {t("viewer.aiViewPlans")}
            </Button>
          ) : recovery === "retry" ? (
            <Button size="sm" type="button" variant="outline" onClick={() => void diagnose()}>
              {t("viewer.aiRetry")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
