import type { AgentExecution, HandoffMode, PinReview, Session, SupportedLanguage } from "@pinar/shared";

/**
 * Every "copy batch" affordance - sidebar row, session card, viewer - hands
 * over the same thing: the batch handoff served by /b/{id}.md. Returns whether
 * the clipboard actually received it, so callers can show the copied state
 * only when it is true.
 */
function markdownRequestPath(path: string, includeViewerContent?: boolean) {
  if (typeof includeViewerContent !== "boolean") return path;
  return `${path}?includeViewerContent=${includeViewerContent ? "1" : "0"}`;
}

export async function copyBatchHandoff(batchId: string, includeViewerContent?: boolean): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(await fetchBatchHandoff(batchId, includeViewerContent));
    return true;
  } catch {
    return false;
  }
}

export async function fetchBatchHandoff(batchId: string, includeViewerContent?: boolean) {
  const response = await fetch(markdownRequestPath(`/api/batches/${encodeURIComponent(batchId)}/markdown`, includeViewerContent), { cache: "no-store" });
  if (!response.ok) throw new Error("batch prompt unavailable");
  return response.text();
}

export async function copySessionHandoff(sessionId: string, includeViewerContent?: boolean): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(await fetchSessionHandoff(sessionId, includeViewerContent));
    return true;
  } catch {
    return false;
  }
}

export async function fetchSessionHandoff(sessionId: string, includeViewerContent?: boolean) {
  const response = await fetch(markdownRequestPath(`/api/sessions/${encodeURIComponent(sessionId)}/markdown`, includeViewerContent), { cache: "no-store" });
  if (!response.ok) throw new Error("session prompt unavailable");
  return response.text();
}

/**
 * Complete a delayed prompt handoff only while the viewer is still on the
 * revision that requested it. The second check keeps a navigation that races
 * clipboard.writeText from being reported as a successful copy.
 */
export async function copyPromptIfCurrentRevision(
  fetchText: () => Promise<string>,
  revision: string,
  currentRevision: () => string,
  writeText: (text: string) => Promise<void>,
): Promise<"copied" | "stale"> {
  const text = await fetchText();
  if (currentRevision() !== revision) return "stale";
  await writeText(text);
  return currentRevision() === revision ? "copied" : "stale";
}

/** Fields the aggregated handoff renders and the viewer can still edit. */
export interface BatchPromptRevisionDelivery {
  copyViewerContent?: boolean;
  handoffMode?: HandoffMode;
  includeScreenshot?: boolean;
  language?: SupportedLanguage | null;
}

type BatchPromptReview = Pick<PinReview, "pinId" | "status"> & Partial<Omit<PinReview, "pinId" | "status">>;

export function batchPromptRevision(
  captures: Session[],
  reviews: BatchPromptReview[],
  executions: AgentExecution[] = [],
  delivery: BatchPromptRevisionDelivery = {},
) {
  return JSON.stringify({
    captures: captures.map((capture) => ({
      id: capture.id,
      pins: capture.pins.map((pin) => ({
        comment: pin.comment,
        component: pin.component ?? null,
        diagnosis: pin.diagnosis ?? null,
        evidence: pin.evidence ?? null,
        id: pin.pinId || pin.id || "",
      })),
      reproduction: capture.reproduction ?? null,
    })),
    delivery,
    executions,
    reviews,
  });
}

export function sessionPromptRevision(
  session: Session | null,
  reviews: BatchPromptReview[],
  executions: AgentExecution[],
  delivery: BatchPromptRevisionDelivery,
  captureKey: string,
) {
  return JSON.stringify({
    captureKey,
    delivery,
    executions,
    reviews,
    session,
  });
}

export function batchHandoffRevision(
  batchId: string,
  session: Session | null,
  reviews: BatchPromptReview[],
  executions: AgentExecution[],
  delivery: BatchPromptRevisionDelivery,
  captureKey: string,
) {
  return JSON.stringify({
    batchId,
    captureKey,
    delivery,
    executions,
    reviews,
    session,
  });
}

async function fetchBatchMarkdown(batchId: string, includeViewerContent?: boolean) {
  return fetchBatchHandoff(batchId, includeViewerContent);
}

/** Keep only the current prompt while this viewer is mounted. */
export function createBatchPromptCache(
  fetchText: (batchId: string, includeViewerContent?: boolean) => Promise<string> = fetchBatchMarkdown,
) {
  let key: string | null = null;
  let ready: string | undefined;
  let pending: Promise<string> | null = null;
  return {
    prepared(batchId: string, revision: string) {
      return key === `${batchId}\n${revision}` ? ready : undefined;
    },
    prepare(batchId: string, revision: string, includeViewerContent?: boolean) {
      const nextKey = `${batchId}\n${revision}`;
      if (key === nextKey) {
        if (ready !== undefined) return Promise.resolve(ready);
        if (pending) return pending;
      }
      key = nextKey;
      ready = undefined;
      const request = fetchText(batchId, includeViewerContent).then((text) => {
        if (key === nextKey && pending === request) ready = text;
        return text;
      }).finally(() => {
        if (key === nextKey && pending === request) pending = null;
      });
      pending = request;
      return request;
    },
  };
}
