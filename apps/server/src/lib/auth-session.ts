import { useEffect, useState } from "react";
import type { AuthSession, AuthSessionResponse } from "@pinar/shared";
import { isRecord } from "@/lib/api-data";

let sessionRequest: Promise<AuthSession | null> | null = null;

function isAuthSession(value: unknown): value is AuthSession {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "local") return value.plan === "free";
  if (value.kind === "installation") {
    return value.plan === "free" && typeof value.installationId === "string";
  }
  return value.kind === "account"
    && typeof value.email === "string"
    && typeof value.userId === "string"
    && (value.plan === "free" || value.plan === "pro" || value.plan === "lifetime");
}

function requestAuthSession() {
  sessionRequest ??= fetch("/api/auth/session", { cache: "no-store" })
    .then((response) => response.json() as Promise<AuthSessionResponse>)
    .then((data) => isAuthSession(data.session) ? data.session : null)
    .catch(() => null);
  return sessionRequest;
}

export function useAuthSession() {
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    let active = true;
    void requestAuthSession().then((nextSession) => {
      if (active) setSession(nextSession);
    });
    return () => {
      active = false;
    };
  }, []);

  return session;
}

export function isPaidAuthSession(session: AuthSession | null) {
  return session?.kind === "account"
    && (session.plan === "pro" || session.plan === "lifetime");
}
