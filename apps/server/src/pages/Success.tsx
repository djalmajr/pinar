import { useEffect, useReducer } from "react";
import { Link } from "@tanstack/react-router";
import { Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, ScrollArea } from "@pinar/ui";
import { ServerShell } from "@/components/ServerShell";
import CheckCircleIcon from "~icons/lucide/circle-check";
import PanelsTopLeftIcon from "~icons/lucide/panels-top-left";
import { isRecord } from "@/lib/api-data";
import { refreshAuthSession } from "@/lib/auth-session";
import { useServerI18n } from "@/lib/i18n";
import { reduceCheckoutActivation } from "@/lib/success-state";

interface SuccessPageProps {
  checkoutClaim: string;
  sessionId: string;
}

export function SuccessPage({ checkoutClaim, sessionId }: SuccessPageProps) {
  const { t } = useServerI18n();
  const [state, dispatch] = useReducer(reduceCheckoutActivation, { status: "idle" });

  useEffect(() => {
    async function activateCheckout() {
      const response = await fetch(
        `/api/stripe/success?session_id=${encodeURIComponent(sessionId)}&claim=${encodeURIComponent(checkoutClaim)}`,
      );
      const data: unknown = await response.json();
      window.history.replaceState(null, "", "/success");
      if (response.ok && isRecord(data) && isRecord(data.account)) {
        dispatch({
          activation: {
            email: typeof data.account.email === "string" ? data.account.email : undefined,
            offer: typeof data.offer === "string" ? data.offer : undefined,
            plan: typeof data.account.plan === "string" ? data.account.plan : undefined,
          },
          type: "succeed",
        });
        void refreshAuthSession();
      } else {
        dispatch({
          error: isRecord(data) && typeof data.error === "string"
            ? { kind: "message", value: data.error }
            : { kind: "translation", value: "success.checkoutFailed" },
          type: "fail",
        });
      }
    }
    if (sessionId && checkoutClaim) {
      dispatch({ type: "activate" });
      void activateCheckout();
    } else {
      dispatch({ type: "missing" });
    }
  }, [checkoutClaim, sessionId]);

  const activation = state.status === "active" ? state.activation : null;
  const isAddOn = activation?.offer === "ai_credits_1000"
    || activation?.offer === "storage_20gb_12m"
    || activation?.offer === "storage_5gb_12m";

  return (
    <ServerShell activePage="pricing" className="bg-muted/40">
      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto flex min-h-full w-full max-w-6xl flex-col p-6">
          <div className="flex flex-1 items-center justify-center py-8">
            <Card className="w-full max-w-lg">
          <CardHeader className="items-center text-center">
            <CheckCircleIcon className="size-10 text-emerald-500" />
            <Badge variant="pro">{isAddOn ? t("success.addOnLabel") : "Pinar Pro"}</Badge>
            <CardTitle>{t("success.confirmed")}</CardTitle>
            <CardDescription>{t("success.ready")}</CardDescription>
          </CardHeader>
          <CardContent>
            {state.status === "error" ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                {state.error.kind === "message" ? state.error.value : t(state.error.value)}
              </p>
            ) : activation ? (
              <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
                <p className="text-sm font-semibold capitalize">
                  {isAddOn
                    ? t("success.addOnReady")
                    : t("success.planReady", { plan: activation.plan || "pro" })}
                </p>
                {activation.email && (
                  <p className="text-xs text-muted-foreground">{t("success.accountFor", { email: activation.email })}</p>
                )}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("success.activating")}</p>
            )}
          </CardContent>
          <CardFooter className="justify-center gap-2">
            <Button disabled={state.status !== "active"} render={<Link preload="intent" to="/app" />}>
              <PanelsTopLeftIcon data-icon="inline-start" />
              {t("common.openApp")}
            </Button>
          </CardFooter>
            </Card>
          </div>
        </main>
      </ScrollArea>
    </ServerShell>
  );
}
