import { type FormEvent, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  ScrollArea,
} from "@pinar/ui";
import { currentLegalAcceptance, LegalActionNotice } from "@/components/LegalActionNotice";
import { FairSourceSupportCard } from "@/components/ServerFooter";
import { ServerShell } from "@/components/ServerShell";
import { isRecord } from "@/lib/api-data";
import { useServerI18n } from "@/lib/i18n";
import MailIcon from "~icons/lucide/mail";

interface SignInPageProps {
  returnTo: string;
}

type Step = "request" | "verify";

async function responseError(response: Response) {
  const data: unknown = await response.json().catch(() => ({}));
  return isRecord(data) && typeof data.error === "string" ? data.error : "Request failed";
}

export function SignInPage({ returnTo }: SignInPageProps) {
  const { language, t } = useServerI18n();
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>("request");

  async function requestEmailCode(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/email-codes", {
        body: JSON.stringify({ email }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error(await responseError(response));
      setStep("verify");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("signIn.requestFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function verifyEmailCode(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/email-codes/verify", {
        body: JSON.stringify({
          code: emailCode,
          email,
          legalAcceptance: currentLegalAcceptance(language === "pt" ? "pt" : "en"),
          returnTo,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(isRecord(data) && typeof data.error === "string" ? data.error : "Request failed");
      }
      window.location.href = isRecord(data) && typeof data.redirectTo === "string" ? data.redirectTo : returnTo;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("signIn.codeInvalid"));
    } finally {
      setLoading(false);
    }
  }

  function changeEmail() {
    setEmailCode("");
    setError("");
    setStep("request");
  }

  return (
    <ServerShell activePage="signIn" className="bg-muted/30">
      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 py-10">
          <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
            <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2 text-card-foreground" data-testid="account-sign-in-heading">
                      <MailIcon className="size-4 shrink-0 text-current" />
                      <CardTitle>{t("signIn.accountTitle")}</CardTitle>
                    </div>
                    <CardDescription>{t(step === "request"
                      ? "signIn.accountDescription"
                      : "signIn.emailSent")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {step === "request" ? (
                      <form className="flex flex-col gap-3" onSubmit={requestEmailCode}>
                        <Input autoComplete="email" placeholder="you@example.com" required type="email" value={email} onChange={(event) => {
                          setEmail(event.target.value);
                          setError("");
                        }} />
                        <Button className="w-full" disabled={loading} type="submit">{loading ? t("signIn.sending") : t("signIn.sendCode")}</Button>
                      </form>
                    ) : (
                      <form className="flex flex-col gap-3" onSubmit={verifyEmailCode}>
                        <Input autoComplete="one-time-code" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" placeholder="000000" required value={emailCode} onChange={(event) => {
                          setEmailCode(event.target.value.replace(/\D/g, ""));
                          setError("");
                        }} />
                        <Button className="w-full" disabled={loading || emailCode.length !== 6} type="submit">{loading ? t("signIn.entering") : t("signIn.verifyCode")}</Button>
                        <LegalActionNotice showVersion={false} />
                        <Button className="w-full" type="button" variant="outline" onClick={changeEmail}>{t("signIn.changeEmail")}</Button>
                      </form>
                    )}
                  </CardContent>
                {error && (
                  <CardContent>
                    <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>
                  </CardContent>
                )}
              </Card>
          </div>
          <FairSourceSupportCard className="mt-auto" />
        </main>
      </ScrollArea>
    </ServerShell>
  );
}
