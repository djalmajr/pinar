import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, ScrollArea } from "@pinar/ui";
import { ServerShell } from "@/components/ServerShell";
import { ServerFooter } from "@/components/ServerFooter";
import CheckCircleIcon from "~icons/lucide/circle-check";
import CopyIcon from "~icons/lucide/copy";
import HistoryIcon from "~icons/lucide/history";
import { isRecord } from "@/lib/api-data";
import { useServerI18n } from "@/lib/i18n";

interface Activation {
  email?: string;
  licenseKey?: string;
  plan?: string;
}

type ActivationError =
  | { kind: "message"; value: string }
  | { kind: "translation"; value: "success.checkoutFailed" | "success.sessionMissing" };

interface SuccessPageProps {
  sessionId: string;
}

export function SuccessPage({ sessionId }: SuccessPageProps) {
  const { t } = useServerI18n();
  const [activation, setActivation] = useState<Activation | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<ActivationError | null>(null);

  useEffect(() => {
    async function activateCheckout() {
      const response = await fetch(`/api/stripe/success?session_id=${encodeURIComponent(sessionId)}`);
      const data: unknown = await response.json();
      if (response.ok && isRecord(data)) {
        setActivation({
          email: typeof data.email === "string" ? data.email : undefined,
          licenseKey: typeof data.licenseKey === "string" ? data.licenseKey : undefined,
          plan: typeof data.plan === "string" ? data.plan : undefined,
        });
      } else {
        setError(
          isRecord(data) && typeof data.error === "string"
            ? { kind: "message", value: data.error }
            : { kind: "translation", value: "success.checkoutFailed" },
        );
      }
    }
    if (sessionId) void activateCheckout();
    else setError({ kind: "translation", value: "success.sessionMissing" });
  }, [sessionId]);

  async function copyLicense() {
    if (!activation?.licenseKey) return;
    await navigator.clipboard.writeText(activation.licenseKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <ServerShell activePage="pricing" className="bg-muted/40">
      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto flex min-h-full w-full max-w-6xl flex-col p-6">
          <div className="flex flex-1 items-center justify-center py-8">
            <Card className="w-full max-w-lg">
          <CardHeader className="items-center text-center">
            <CheckCircleIcon className="size-10 text-emerald-500" />
            <Badge variant="pro">Pinar Pro</Badge>
            <CardTitle>{t("success.confirmed")}</CardTitle>
            <CardDescription>{t("success.ready")}</CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                {error.kind === "message" ? error.value : t(error.value)}
              </p>
            ) : activation ? (
              <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
                <p className="text-xs font-medium text-muted-foreground">{t("success.licenseKey")}</p>
                <code className="block break-all text-sm font-semibold">{activation.licenseKey}</code>
                {activation.email && (
                  <p className="text-xs text-muted-foreground">{t("success.issuedTo", { email: activation.email })}</p>
                )}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("success.activating")}</p>
            )}
          </CardContent>
          <CardFooter className="justify-center gap-2">
            <Button disabled={!activation?.licenseKey} variant="outline" onClick={() => void copyLicense()}>
              <CopyIcon data-icon="inline-start" />
              {copied ? t("common.copied") : t("success.copyLicense")}
            </Button>
            <Button render={<Link preload="intent" to="/history" />}>
              <HistoryIcon data-icon="inline-start" />
              {t("success.openHistory")}
            </Button>
          </CardFooter>
            </Card>
          </div>
          <ServerFooter />
        </main>
      </ScrollArea>
    </ServerShell>
  );
}
