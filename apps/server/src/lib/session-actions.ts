import type { PinReview, Session } from "@pinar/shared";

/**
 * Every "copy batch" affordance - sidebar row, session card, viewer - hands
 * over the same thing: the batch handoff served by /b/{id}.md. Returns whether
 * the clipboard actually received it, so callers can show the copied state
 * only when it is true.
 */
export async function copyBatchHandoff(batchId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/batches/${encodeURIComponent(batchId)}/markdown`, { cache: "no-store" });
    if (!response.ok) return false;
    await navigator.clipboard.writeText(await response.text());
    return true;
  } catch {
    return false;
  }
}

/** Fields the aggregated handoff renders and the viewer can still edit. */
export function batchPromptRevision(captures: Session[], reviews: Pick<PinReview, "pinId" | "status">[]) {
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
    reviews: reviews.map((review) => ({ pinId: review.pinId, status: review.status })),
  });
}

async function fetchBatchMarkdown(batchId: string) {
  const response = await fetch(`/api/batches/${encodeURIComponent(batchId)}/markdown`, { cache: "no-store" });
  if (!response.ok) throw new Error("batch prompt unavailable");
  return response.text();
}

/** Keep only the current prompt while this viewer is mounted. */
export function createBatchPromptCache(
  fetchText: (batchId: string) => Promise<string> = fetchBatchMarkdown,
) {
  let key: string | null = null;
  let ready: string | undefined;
  let pending: Promise<string> | null = null;
  return {
    prepared(batchId: string, revision: string) {
      return key === `${batchId}\n${revision}` ? ready : undefined;
    },
    prepare(batchId: string, revision: string) {
      const nextKey = `${batchId}\n${revision}`;
      if (key === nextKey) {
        if (ready !== undefined) return Promise.resolve(ready);
        if (pending) return pending;
      }
      key = nextKey;
      ready = undefined;
      const request = fetchText(batchId).then((text) => {
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
