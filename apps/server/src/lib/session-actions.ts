import type { Translate } from "./i18n";

export function sessionMarkdownUrl(sessionId: string) {
  return new URL(`/v/${sessionId}.md`, window.location.origin).toString();
}

/**
 * Both the listing menu and the viewer hand a session to an assistant, and they
 * must hand over the same thing: a link to the markdown projection wrapped in
 * the localized review prompt.
 */
export function openSessionInAssistant(
  sessionId: string,
  assistant: "chatgpt" | "claude",
  t: Translate,
) {
  const prompt = t("viewer.reviewPrompt", { url: sessionMarkdownUrl(sessionId) });
  const url =
    assistant === "chatgpt"
      ? `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`
      : `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
