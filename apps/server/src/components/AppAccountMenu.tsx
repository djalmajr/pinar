import { useEffect, useState } from "react";
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@pinar/ui";
import {
  type AccountUsageSummary,
  accountMenuIdentity,
  accountUsageSummary,
  formatByteSize,
  formatEntitlementDate,
  storageUsagePercent,
} from "@/lib/account-menu";
import { useAuthSession } from "@/lib/auth-session";
import { useServerI18n } from "@/lib/i18n";
import ChevronsUpDownIcon from "~icons/lucide/chevrons-up-down";
import CoinsIcon from "~icons/lucide/coins";
import CreditCardIcon from "~icons/lucide/credit-card";
import HardDriveIcon from "~icons/lucide/hard-drive";
import LogOutIcon from "~icons/lucide/log-out";
import SparklesIcon from "~icons/lucide/sparkles";

type UsageStatus = "error" | "loading" | "ready";

function planName(plan: AccountUsageSummary["plan"], t: ReturnType<typeof useServerI18n>["t"]) {
  if (plan === "founder") return t("app.founderPlan");
  if (plan === "lifetime") return t("app.lifetimePlan");
  if (plan === "pro") return t("app.proPlan");
  return t("app.freePlan");
}

export function AppAccountMenu() {
  const { language, t } = useServerI18n();
  const session = useAuthSession();
  const { isMobile } = useSidebar();
  const [usage, setUsage] = useState<AccountUsageSummary | null>(null);
  const [usageStatus, setUsageStatus] = useState<UsageStatus>("loading");

  useEffect(() => {
    if (!session || session.kind === "local") return;
    const controller = new AbortController();
    setUsage(null);
    setUsageStatus("loading");
    void fetch("/api/account/entitlements", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => response.ok ? response.json() as Promise<unknown> : null)
      .then((value) => {
        if (controller.signal.aborted) return;
        const summary = accountUsageSummary(value);
        setUsage(summary);
        setUsageStatus(summary ? "ready" : "error");
      })
      .catch(() => {
        if (!controller.signal.aborted) setUsageStatus("error");
      });
    return () => controller.abort();
  }, [session]);

  async function openBilling() {
    const response = await fetch("/api/stripe/portal", { method: "POST" });
    const data: unknown = await response.json();
    if (response.ok && typeof data === "object" && data !== null && "url" in data && typeof data.url === "string") {
      window.location.href = data.url;
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/sign-in";
  }

  if (!session || session.kind === "local") return null;

  const identity = accountMenuIdentity(session, "Pinar Free", t("app.freePlan"));
  const currentPlan = usage?.plan ?? session.plan;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(
              <SidebarMenuButton
                aria-label={t("app.accountMenu")}
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
                size="lg"
              />
            )}
          >
            <Avatar>
              <AvatarFallback>{identity.initials}</AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{identity.name}</span>
              <span className="truncate text-xs text-muted-foreground">{identity.detail}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-64 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar>
                    <AvatarFallback>{identity.initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{identity.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{identity.detail}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="space-y-2 font-normal" data-testid="account-usage">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">{t("app.plan")}</span>
                  <span className="font-medium">{planName(currentPlan, t)}</span>
                </div>
                {usageStatus === "ready" && usage ? (
                  <>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="flex items-center gap-1.5 text-muted-foreground"><CoinsIcon className="size-3.5" />{t("app.aiCredits")}</span>
                      <span className="font-medium">{t("app.creditsAvailable", { count: usage.aiCredits })}</span>
                    </div>
                    {usage.aiCreditsExpireAt && (
                      <p className="text-right text-[11px] text-muted-foreground">
                        {t("app.creditsExpire", {
                          date: formatEntitlementDate(usage.aiCreditsExpireAt, language),
                        })}
                      </p>
                    )}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground"><HardDriveIcon className="size-3.5" />{t("app.storage")}</span>
                        <span className="font-medium">{t("app.storageUsage", {
                          quota: formatByteSize(usage.storageQuotaBytes, language),
                          used: formatByteSize(usage.storageUsedBytes, language),
                        })}</span>
                      </div>
                      <div
                        aria-label={t("app.storage")}
                        aria-valuemax={usage.storageQuotaBytes}
                        aria-valuemin={0}
                        aria-valuenow={Math.min(usage.storageUsedBytes, usage.storageQuotaBytes)}
                        className="h-1.5 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                      >
                        <div className="h-full bg-primary" style={{ width: `${storageUsagePercent(usage)}%` }} />
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {usageStatus === "loading" ? t("app.usageLoading") : t("app.usageUnavailable")}
                  </p>
                )}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {session.kind === "installation" ? (
                <DropdownMenuItem onClick={() => { window.location.href = "/pricing"; }}>
                  <SparklesIcon />
                  {t("app.upgradeToPro")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => void openBilling()}>
                  <CreditCardIcon />
                  {t("app.billing")}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void logout()}>
              <LogOutIcon />
              {t("app.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
