import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@pinar/ui";
import { ServerFooter } from "@/components/ServerFooter";
import { ServerShell } from "@/components/ServerShell";
import { isRecord } from "@/lib/api-data";
import { useServerI18n } from "@/lib/i18n";
import { CURRENT_LEGAL_VERSION } from "@/lib/legal-documents";
import KeyRoundIcon from "~icons/lucide/key-round";
import MailIcon from "~icons/lucide/mail";

interface SignInPageProps {
  extensionCode: string;
  returnTo: string;
}

type Step = "accept" | "request" | "verify";

async function responseError(response: Response) {
  const data: unknown = await response.json().catch(() => ({}));
  return isRecord(data) && typeof data.error === "string" ? data.error : "Request failed";
}

export function SignInPage({ extensionCode, returnTo }: SignInPageProps) {
  const { language, t } = useServerI18n();
  const [code, setCode] = useState(extensionCode);
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [error, setError] = useState("");
  const autoExchangeStarted = useRef(false);
  const [loading, setLoading] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [step, setStep] = useState<Step>("request");

  async function exchangeCode(value: string) {
    const normalized = value.replace(/[\s-]/g, "").toUpperCase();
    if (normalized.length !== 8) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/extension-codes/exchange", {
        body: JSON.stringify({ code: normalized, returnTo }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data: unknown = await response.json();
      window.location.href = isRecord(data) && typeof data.redirectTo === "string" ? data.redirectTo : returnTo;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("signIn.codeInvalid"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!extensionCode || autoExchangeStarted.current) return;
    autoExchangeStarted.current = true;
    void exchangeCode(extensionCode);
  }, [extensionCode]);

  async function submitExtensionCode(event: FormEvent) {
    event.preventDefault();
    await exchangeCode(code);
  }

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
          legalAcceptance: step === "accept" ? {
            acceptableUseVersion: CURRENT_LEGAL_VERSION,
            accepted: legalAccepted,
            locale: language === "pt" ? "pt" : "en",
            privacyVersion: CURRENT_LEGAL_VERSION,
            termsVersion: CURRENT_LEGAL_VERSION,
          } : undefined,
          returnTo,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data: unknown = await response.json().catch(() => ({}));
      if (response.status === 428 && isRecord(data) && data.code === "legal_acceptance_required") {
        setStep("accept");
        return;
      }
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
    setLegalAccepted(false);
    setStep("request");
  }

  return (
    <ServerShell activePage="signIn" className="bg-muted/30">
      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 py-10">
          <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
            <Tabs className="w-full" defaultValue="extension" onValueChange={() => setError("")}>
              <TabsList className="w-full" variant="segmented">
                <TabsTrigger value="extension">{t("signIn.extensionTab")}</TabsTrigger>
                <TabsTrigger value="account">{t("signIn.accountTab")}</TabsTrigger>
              </TabsList>
              <Card>
                <TabsContent className="flex flex-col gap-4" value="extension">
                  <CardHeader>
                    <div className="flex items-center gap-2 text-card-foreground" data-testid="extension-sign-in-heading">
                      <KeyRoundIcon className="size-4 shrink-0 text-current" />
                      <CardTitle>{t("signIn.freeTitle")}</CardTitle>
                    </div>
                    <CardDescription>{t("signIn.freeDescription")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form className="flex flex-col gap-3" onSubmit={submitExtensionCode}>
                      <Input
                        autoComplete="one-time-code"
                        inputMode="text"
                        maxLength={11}
                        placeholder={t("signIn.extensionPlaceholder")}
                        value={code}
                        onChange={(event) => {
                          setCode(event.target.value.toUpperCase());
                          setError("");
                        }}
                      />
                      <Button className="w-full" disabled={loading || code.replace(/[\s-]/g, "").length !== 8} type="submit">
                        {loading ? t("signIn.entering") : t("signIn.openApp")}
                      </Button>
                    </form>
                  </CardContent>
                </TabsContent>
                <TabsContent className="flex flex-col gap-4" value="account">
                  <CardHeader>
                    <div className="flex items-center gap-2 text-card-foreground" data-testid="account-sign-in-heading">
                      <MailIcon className="size-4 shrink-0 text-current" />
                      <CardTitle>{t("signIn.accountTitle")}</CardTitle>
                    </div>
                    <CardDescription>{t(step === "request"
                      ? "signIn.accountDescription"
                      : step === "accept"
                        ? "signIn.legalDescription"
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
                    ) : step === "verify" ? (
                      <form className="flex flex-col gap-3" onSubmit={verifyEmailCode}>
                        <Input autoComplete="one-time-code" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" placeholder="000000" required value={emailCode} onChange={(event) => {
                          setEmailCode(event.target.value.replace(/\D/g, ""));
                          setError("");
                        }} />
                        <Button className="w-full" disabled={loading || emailCode.length !== 6} type="submit">{loading ? t("signIn.entering") : t("signIn.verifyCode")}</Button>
                        <Button className="w-full" type="button" variant="ghost" onClick={changeEmail}>{t("signIn.changeEmail")}</Button>
                      </form>
                    ) : (
                      <form className="flex flex-col gap-3" onSubmit={verifyEmailCode}>
                        <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
                          <input
                            checked={legalAccepted}
                            className="mt-0.5 size-4 shrink-0 accent-primary"
                            type="checkbox"
                            onChange={(event) => setLegalAccepted(event.currentTarget.checked)}
                          />
                          <span>
                            {t("pricing.legalConsentPrefix")}{" "}
                            <a className="font-medium underline underline-offset-4" href="/legal/terms" target="_blank">{t("pricing.legalTerms")}</a>
                            {", "}
                            <a className="font-medium underline underline-offset-4" href="/legal/privacy" target="_blank">{t("pricing.legalPrivacy")}</a>
                            {" "}{t("pricing.legalAnd")}{" "}
                            <a className="font-medium underline underline-offset-4" href="/legal/acceptable-use" target="_blank">{t("pricing.legalAcceptableUse")}</a>.
                            <span className="mt-1 block text-xs text-muted-foreground">{t("pricing.legalDialogVersion", { version: CURRENT_LEGAL_VERSION })}</span>
                          </span>
                        </label>
                        <Button className="w-full" disabled={loading || !legalAccepted} type="submit">
                          {loading ? t("signIn.entering") : t("signIn.acceptAndEnter")}
                        </Button>
                        <Button className="w-full" type="button" variant="ghost" onClick={changeEmail}>{t("signIn.changeEmail")}</Button>
                      </form>
                    )}
                  </CardContent>
                </TabsContent>
                {error && (
                  <CardContent>
                    <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>
                  </CardContent>
                )}
              </Card>
            </Tabs>
          </div>
          <ServerFooter className="pt-8" />
        </main>
      </ScrollArea>
    </ServerShell>
  );
}
