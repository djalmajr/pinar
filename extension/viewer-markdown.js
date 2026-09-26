export const MAX_VIEWER_MARKDOWN_BYTES = 1024 * 1024;

export async function readBoundedResponseText(response, maxBytes = MAX_VIEWER_MARKDOWN_BYTES) {
  const contentLength = Number(response.headers?.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    try {
      await response.body?.cancel?.();
    } catch {
      /* The body may already be unavailable; the size guard still holds. */
    }
    throw new Error("viewer_content_too_large");
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error("viewer_content_stream_unavailable");
  const decoder = new TextDecoder();
  let bytes = 0;
  let cancelled = false;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        return text;
      }
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        cancelled = true;
        await reader.cancel();
        throw new Error("viewer_content_too_large");
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    if (!cancelled) await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock?.();
  }
}

export async function readOptionalViewerMarkdown(response, maxBytes = MAX_VIEWER_MARKDOWN_BYTES) {
  try {
    return { content: await readBoundedResponseText(response, maxBytes), warning: null };
  } catch {
    return { content: null, warning: "viewer_content_unavailable" };
  }
}
