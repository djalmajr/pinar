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
import { useGlobalSettings } from "@/components/GlobalSettingsDialog";
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
import { pinarHomeLink } from "@/lib/pinar-home-menu";
import { pinarRuntime } from "@/lib/server-header";
import CalendarClockIcon from "~icons/lucide/calendar-clock";
import ChevronsUpDownIcon from "~icons/lucide/chevrons-up-down";
import CoinsIcon from "~icons/lucide/coins";
import CreditCardIcon from "~icons/lucide/credit-card";
import ExternalLinkIcon from "~icons/lucide/external-link";
import HardDriveIcon from "~icons/lucide/hard-drive";
import HouseIcon from "~icons/lucide/house";
import LogOutIcon from "~icons/lucide/log-out";
import RefreshCwIcon from "~icons/lucide/refresh-cw";
import SettingsIcon from "~icons/lucide/settings";
import SparklesIcon from "~icons/lucide/sparkles";

function PinarHomeMenuItem() {
  const { t } = useServerI18n();
  const link = pinarHomeLink(pinarRuntime());
  return (
    <DropdownMenuItem
      data-testid="pinar-home-menu"
      render={<a href={link.href} rel="noopener noreferrer" target="_blank" />}
    >
      <HouseIcon />
      {t("app.homepage")}
      <ExternalLinkIcon className="ml-auto" />
    </DropdownMenuItem>
  );
}

type UsageStatus = "error" | "loading" | "ready";

function planName(plan: AccountUsageSummary["plan"], t: ReturnType<typeof useServerI18n>["t"]) {
  if (plan === "founder") return t("app.founderPlan");
  if (plan === "pro") return t("app.proPlan");
  return t("app.freePlan");
}

export function AppAccountMenu() {
  const { language, t } = useServerI18n();
  const openSettings = useGlobalSettings();
  const session = useAuthSession();
  const { isMobile } = useSidebar();
  const localRuntime = pinarRuntime() === "local";
  const [usage, setUsage] = useState<AccountUsageSummary | null>(null);
  const [usageStatus, setUsageStatus] = useState<UsageStatus>("loading");

  const cloudSession = session && session.kind !== "local" ? session : null;

  useEffect(() => {
    if (!cloudSession) return;
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
  }, [cloudSession]);

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

  if (!localRuntime && !session) {
    return <SidebarMenu />;
  }

  const identity = cloudSession
    ? accountMenuIdentity(cloudSession, "Pinar Free", t("app.freePlan"))
    : { detail: t("app.local"), initials: "PL", name: "Pinar Local" };
  const currentPlan = cloudSession
    ? planName(usage?.plan ?? cloudSession.plan, t)
    : t("app.local");

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
            className="w-80 max-w-[calc(100vw-1rem)] rounded-xl p-1.5"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-start gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar>
                    <AvatarFallback>{identity.initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{identity.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{identity.detail}</span>
                  </div>
                  <span
                    className="ml-auto shrink-0 rounded-full border bg-muted/50 px-2 py-0.5 text-xs font-semibold"
                    data-testid="account-plan"
                  >
                    {currentPlan}
                  </span>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {cloudSession ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
              <DropdownMenuLabel className="p-1.5 font-normal" data-testid="account-usage">
                {usageStatus === "ready" && usage ? (
                  <div className="space-y-3">
                    {usage.plan !== "free" ? (
                    <div className="rounded-lg border bg-card px-3 py-3" data-testid="account-credits">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="flex items-center gap-2 font-medium"><CoinsIcon className="size-4 text-muted-foreground" />{t("app.aiCredits")}</span>
                        <span className="shrink-0 font-semibold tabular-nums">{t("app.creditsAvailable", { count: usage.aiCredits })}</span>
                      </div>
                      {(usage.aiCreditsRefillAt || usage.aiCreditsExpireAt) && (
                        <div className="mt-3 space-y-2 border-t pt-3 text-xs leading-4 text-muted-foreground">
                          {usage.aiCreditsRefillAt && (
                            <p className="flex items-start gap-2">
                              <RefreshCwIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                              <span>{t("app.creditsRefill", {
                                date: formatEntitlementDate(usage.aiCreditsRefillAt, language),
                              })}</span>
                            </p>
                          )}
                          {usage.aiCreditsExpireAt && (
                            <p className="flex items-start gap-2">
                              <CalendarClockIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                              <span>{t("app.creditsExpire", {
                                date: formatEntitlementDate(usage.aiCreditsExpireAt, language),
                              })}</span>
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    ) : null}
                    <div className="rounded-lg border bg-card px-3 py-3" data-testid="account-storage">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="flex items-center gap-2 font-medium"><HardDriveIcon className="size-4 text-muted-foreground" />{t("app.storage")}</span>
                        <span className="shrink-0 font-semibold tabular-nums">{t("app.storageUsage", {
                          quota: formatByteSize(usage.storageQuotaBytes, language),
                          used: formatByteSize(usage.storageUsedBytes, language),
                        })}</span>
                      </div>
                      <div
                        aria-label={t("app.storage")}
                        aria-valuemax={usage.storageQuotaBytes}
                        aria-valuemin={0}
                        aria-valuenow={Math.min(usage.storageUsedBytes, usage.storageQuotaBytes)}
                        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                      >
                        <div className="h-full bg-primary" style={{ width: `${storageUsagePercent(usage)}%` }} />
                      </div>
                      {usage.storageExpireAt && (
                        <p className="mt-3 flex items-start gap-2 border-t pt-3 text-xs leading-4 text-muted-foreground">
                          <CalendarClockIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                          <span>{t("app.storageExpires", {
                            date: formatEntitlementDate(usage.storageExpireAt, language),
                          })}</span>
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="rounded-lg border bg-card px-3 py-3 text-xs text-muted-foreground">
                    {usageStatus === "loading" ? t("app.usageLoading") : t("app.usageUnavailable")}
                  </p>
                )}
              </DropdownMenuLabel>
                </DropdownMenuGroup>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {cloudSession?.kind === "installation" ? (
                <DropdownMenuItem onClick={() => { window.location.href = "/pricing"; }}>
                  <SparklesIcon />
                  {t("app.upgradeToPro")}
                </DropdownMenuItem>
              ) : cloudSession ? (
                <DropdownMenuItem onClick={() => void openBilling()}>
                  <CreditCardIcon />
                  {t("app.billing")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={openSettings}>
                <SettingsIcon />
                {t("settings.title")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <PinarHomeMenuItem />
            {cloudSession ? (
              <DropdownMenuItem onClick={() => void logout()}>
                <LogOutIcon />
                {t("app.signOut")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
