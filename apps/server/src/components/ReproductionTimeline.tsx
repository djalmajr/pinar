import { useState } from "react";
import { describeReproductionStep, type Reproduction, type ReproductionStep } from "@pinar/shared";
import { Badge, Button, Input } from "@pinar/ui";
import { useServerI18n, type ServerMessageKey } from "@/lib/i18n";
import { isRecord } from "@/lib/api-data";
import CheckIcon from "~icons/lucide/check";
import CopyIcon from "~icons/lucide/copy";
import ListVideoIcon from "~icons/lucide/list-video";
import PencilIcon from "~icons/lucide/pencil";
import Trash2Icon from "~icons/lucide/trash-2";

export const REPRODUCTION_CREDITS = 5;

interface ReproductionTimelineProps {
  canEdit: boolean;
  reproduction: Reproduction;
  sessionId: string;
  showAi: boolean;
  onPersist: (reproduction: Reproduction | null) => Promise<boolean>;
}

type Recovery = "plans" | "retry" | "signIn" | null;

function requestId() {
  return crypto.randomUUID().replaceAll("-", "");
}

function stepKindLabel(step: ReproductionStep): ServerMessageKey {
  switch (step.kind) {
    case "click":
      return "viewer.reproductionKindClick";
    case "input":
      return "viewer.reproductionKindInput";
    case "key":
      return "viewer.reproductionKindKey";
    case "navigate":
      return "viewer.reproductionKindNavigate";
    case "scroll":
      return "viewer.reproductionKindScroll";
    default:
      return "viewer.reproductionKindWait";
  }
}

export function ReproductionTimeline({ canEdit, reproduction, sessionId, showAi, onPersist }: ReproductionTimelineProps) {
  const { language, t } = useServerI18n();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [recovery, setRecovery] = useState<Recovery>(null);
  const generated = reproduction.generated;

  async function persistSteps(steps: ReproductionStep[]) {
    setBusy(true);
    setError("");
    try {
      const ok = await onPersist(steps.length ? { ...reproduction, steps } : null);
      if (!ok) setError(t("viewer.reproductionSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  function removeStep(index: number) {
    void persistSteps(reproduction.steps.filter((_step, position) => position !== index));
  }

  function startEdit(index: number) {
    setEditingIndex(index);
    setEditingValue(reproduction.steps[index]?.value ?? "");
  }

  async function saveEdit() {
    if (editingIndex === null) return;
    const steps = reproduction.steps.map((step, position) => {
      if (position !== editingIndex) return step;
      const next: ReproductionStep = { ...step, redacted: undefined, value: editingValue.trim() || undefined };
      return next;
    });
    setEditingIndex(null);
    await persistSteps(steps);
  }

  async function generate() {
    if (generating) return;
    setGenerating(true);
    setError("");
    setRecovery(null);
    try {
      const response = await fetch("/api/ai/reproduction", {
        body: JSON.stringify({ language, requestId: requestId(), sessionId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const data: unknown = await response.json().catch(() => null);
      const code = isRecord(data) && typeof data.code === "string" ? data.code : "";
      if (response.ok) {
        // The server persisted the result; reloading the session brings it in.
        await onPersist(reproduction);
        return;
      }
      if (response.status === 401) {
        setError(t("viewer.aiSignIn"));
        setRecovery("signIn");
      } else if (code === "insufficient_ai_credits" || code === "ai_requires_paid") {
        setError(t("viewer.aiNoCredits"));
        setRecovery("plans");
      } else if (code === "ai_rate_limited") {
        setError(t("viewer.aiRateLimited"));
        setRecovery("retry");
      } else if (code === "ai_refund_pending") {
        setError(t("viewer.aiRefundPending"));
        setRecovery("retry");
      } else {
        setError(t("viewer.aiUnavailable"));
        setRecovery("retry");
      }
    } catch {
      setError(t("viewer.aiNetworkError"));
      setRecovery("retry");
    } finally {
      setGenerating(false);
    }
  }

  async function copyTest() {
    if (!generated) return;
    await navigator.clipboard.writeText(generated.test);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-1.5 text-sm font-medium">
            <ListVideoIcon className="text-primary" />
            {t("viewer.reproduction")}
          </p>
          <p className="text-xs text-muted-foreground">{t("viewer.reproductionDescription")}</p>
        </div>
        {showAi ? (
          <div className="flex flex-col items-end gap-1">
            <Button disabled={generating || busy || !reproduction.steps.length} size="sm" type="button" onClick={() => void generate()}>
              {generating ? t("viewer.reproductionGenerating") : generated ? t("viewer.reproductionRegenerate") : t("viewer.reproductionGenerate")}
            </Button>
            <span className="text-[11px] text-muted-foreground">{t("viewer.reproductionCreditCost")}</span>
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-destructive">
          {error}
          {recovery === "retry" ? (
            <Button size="sm" type="button" variant="outline" onClick={() => void generate()}>{t("viewer.aiRetry")}</Button>
          ) : null}
          {recovery === "plans" ? (
            <Button render={<a href="/pricing" />} size="sm" variant="outline">{t("viewer.aiViewPlans")}</Button>
          ) : null}
          {recovery === "signIn" ? (
            <Button render={<a href={`/sign-in?returnTo=${encodeURIComponent(`/v/${sessionId}`)}`} />} size="sm" variant="outline">
              {t("viewer.aiSignInAction")}
            </Button>
          ) : null}
        </p>
      ) : null}
      {reproduction.steps.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("viewer.reproductionEmpty")}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {reproduction.steps.map((step, index) => (
            <li className="flex items-start gap-3 rounded-md border bg-card px-3 py-2 text-xs" key={`${step.at}-${index}`}>
              <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground">
                {index + 1}
              </span>
              {step.thumbnail ? (
                <img alt="" className="w-20 shrink-0 rounded border object-cover" src={step.thumbnail} />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{t(stepKindLabel(step))}</Badge>
                  {step.redacted ? <Badge variant="outline">{t("viewer.reproductionRedacted")}</Badge> : null}
                </div>
                {editingIndex === index ? (
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      aria-label={t("viewer.reproductionEditValue")}
                      className="h-8 text-xs"
                      value={editingValue}
                      onChange={(event) => setEditingValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void saveEdit();
                        if (event.key === "Escape") setEditingIndex(null);
                      }}
                    />
                    <Button disabled={busy} size="sm" type="button" onClick={() => void saveEdit()}>
                      <CheckIcon />
                    </Button>
                  </div>
                ) : (
                  <p className="mt-1 text-foreground [overflow-wrap:anywhere]">{describeReproductionStep(step)}</p>
                )}
                {step.url ? <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{step.url}</p> : null}
              </div>
              {canEdit ? (
                <div className="flex shrink-0 items-center gap-1">
                  {step.kind === "input" || step.kind === "key" || step.kind === "scroll" ? (
                    <Button
                      aria-label={t("viewer.reproductionEditValue")}
                      disabled={busy}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                      onClick={() => startEdit(index)}
                    >
                      <PencilIcon />
                    </Button>
                  ) : null}
                  <Button
                    aria-label={t("viewer.reproductionRemoveStep")}
                    disabled={busy}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                    onClick={() => removeStep(index)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {generated ? (
        <div className="flex flex-col gap-3 border-t pt-3">
          <div>
            <p className="text-xs font-medium">{t("viewer.reproductionGeneratedSteps")}</p>
            <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5 text-xs text-foreground">
              {generated.steps.map((step, index) => <li key={`${index}-${step.slice(0, 24)}`}>{step}</li>)}
            </ol>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">{t("viewer.reproductionTest")}</p>
              <Button size="sm" type="button" variant="outline" onClick={() => void copyTest()}>
                {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
                {copied ? t("viewer.reproductionCopied") : t("viewer.reproductionCopyTest")}
              </Button>
            </div>
            <pre className="mt-1 max-h-80 overflow-auto rounded-md border bg-muted p-3 font-mono text-[11px] leading-relaxed text-foreground">
              <code>{generated.test}</code>
            </pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}
