/**
 * Every "copy batch" affordance - sidebar row, session card, viewer - hands
 * over the same thing: the batch handoff served by /b/{id}.md. Returns whether
 * the clipboard actually received it, so callers can show the copied state
 * only when it is true.
 */
export async function copyBatchHandoff(batchId: string): Promise<boolean> {
  try {
    const response = await fetch(`/b/${encodeURIComponent(batchId)}.md`);
    if (!response.ok) return false;
    await navigator.clipboard.writeText(await response.text());
    return true;
  } catch {
    return false;
  }
}
