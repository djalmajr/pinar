import type { Session } from "@pinar/shared";

export function formatSessionDate(session: Pick<Session, "createdAt">, language: string) {
  return new Date(session.createdAt).toLocaleString(language === "pt" ? "pt-BR" : language, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}
