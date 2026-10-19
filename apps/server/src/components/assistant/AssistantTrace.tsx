import { useState } from "react";
import {
  cn,
  Spinner,
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@pinar/ui";
import type { Translate } from "@/lib/i18n";
import IconCheck from "~icons/lucide/check";
import IconCircleAlert from "~icons/lucide/circle-alert";
import type { AssistantTraceStep } from "./assistant-trace";

// The Skia's SkiaTrace (skedly skia-trace.tsx) on the Pinar kit: a running
// step shows the spinner, a done one the check, a failed or interrupted one
// the alert icon and "não concluído" (state by icon and text, not only by
// color). Only the friendly label is shown: never the tool name, its
// arguments, its output or the model's reasoning.
function StepLine({ step, t }: { step: AssistantTraceStep; t: Translate }) {
  return (
    <TraceLine
      data-status={step.status}
      data-testid="assistant-trace-step"
      status={step.status === "done" ? undefined : step.status}
    >
      <TraceIcon>
        {step.status === "running" ? (
          <Spinner aria-hidden="true" className="size-3.5" />
        ) : step.status === "done" ? (
          <IconCheck aria-hidden="true" className="size-3.5" />
        ) : (
          <IconCircleAlert aria-hidden="true" className="size-3.5" />
        )}
      </TraceIcon>
      <TraceTitle className="text-xs">{t(step.label)}</TraceTitle>
      {step.status === "error" ? <span className="shrink-0 text-xs">{t("assistant.stepFailed")}</span> : null}
    </TraceLine>
  );
}

// The current action of the live turn, with the slow notice as its
// description after the wait without progress.
function CurrentLine({ description, title }: { description: string | null; title: string }) {
  return (
    <TraceLine className={description ? "flex-wrap" : undefined} data-testid="assistant-trace-current" status="running">
      <TraceIcon>
        <Spinner aria-hidden="true" className="size-3.5" />
      </TraceIcon>
      <TraceTitle className="text-xs">{title}</TraceTitle>
      {description ? (
        <TraceDescription className="min-w-0 basis-full pl-6 text-xs" data-testid="assistant-trace-slow">
          {description}
        </TraceDescription>
      ) : null}
    </TraceLine>
  );
}

function StepList({ steps, t }: { steps: readonly AssistantTraceStep[]; t: Translate }) {
  return (
    <Trace>
      {steps.map((step) => (
        <StepLine key={step.id} step={step} t={t} />
      ))}
    </Trace>
  );
}

/**
 * The live Trace of the turn in flight: the current action as the title and
 * the turn's steps under it, open while the turn runs. Without a step yet
 * only the title: a trigger with nothing to open would be a dead control.
 */
export function AssistantLiveTrace({
  className,
  current,
  description,
  steps,
  t,
}: {
  className?: string;
  current: string;
  description: string | null;
  steps: readonly AssistantTraceStep[];
  t: Translate;
}) {
  const [open, setOpen] = useState(true);
  if (steps.length === 0) {
    return (
      <Trace className={cn("py-0.5", className)} data-testid="assistant-trace">
        <CurrentLine description={description} title={current} />
      </Trace>
    );
  }
  return (
    <Trace className={cn("py-0.5", className)} data-testid="assistant-trace">
      <TraceCollapsible onOpenChange={setOpen} open={open}>
        <TraceCollapsibleTrigger>
          <CurrentLine description={description} title={current} />
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <StepList steps={steps} t={t} />
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

/** A turn that ended: "N passos", collapsed; a click opens the steps. */
export function AssistantCollapsedTrace({
  className,
  steps,
  t,
}: {
  className?: string;
  steps: readonly AssistantTraceStep[];
  t: Translate;
}) {
  const [open, setOpen] = useState(false);
  return (
    <TraceCollapsible
      className={cn("py-0.5", className)}
      data-testid="assistant-trace-collapsed"
      onOpenChange={setOpen}
      open={open}
    >
      <TraceCollapsibleTrigger data-testid="assistant-trace-toggle">
        <TraceLine>
          <TraceTitle className="text-xs">{t("assistant.steps", { count: steps.length })}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <StepList steps={steps} t={t} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
