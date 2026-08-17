import type { SupportedLanguage } from "@pinar/shared";
import { useEffect, useState } from "react";
import { ServerFooter } from "@/components/ServerFooter";
import { ServerShell } from "@/components/ServerShell";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ScrollArea,
  toast,
  ToggleGroup,
  ToggleGroupItem,
} from "@pinar/ui";
import IconCheck from "~icons/lucide/check";
import IconLock from "~icons/lucide/lock";
import { isRecord, readResponseRecord } from "@/lib/api-data";
import { useServerI18n } from "@/lib/i18n";
import {
  type PricingCurrency,
  type PublicPrice,
  type PublicPricing,
  isPublicPricing,
} from "@/lib/pricing";

type BillingInterval = "month" | "year";
type CheckoutInterval = BillingInterval | "lifetime";

interface PricingAmountProps {
  currency: PricingCurrency | undefined;
  language: SupportedLanguage;
  originalLabel: string;
  price: PublicPrice | undefined;
  suffix: string;
}

function formatAmount(amount: number, currency: PricingCurrency, language: SupportedLanguage) {
  const locale = language === "pt" ? "pt-BR" : language;
  return new Intl.NumberFormat(locale, { currency, style: "currency" }).format(amount / 100);
}

function PricingAmount({ currency, language, originalLabel, price, suffix }: PricingAmountProps) {
  const originalAmount = price?.originalAmount;
  const hasOriginalAmount = currency !== undefined && typeof originalAmount === "number";
  const originalText = hasOriginalAmount ? formatAmount(originalAmount, currency, language) : "\u00a0";
  const priceText = currency && price ? formatAmount(price.amount, currency, language) : "—";
  return (
    <div className="pt-4">
      <div
        aria-hidden={!hasOriginalAmount}
        aria-label={hasOriginalAmount ? originalLabel : undefined}
        className={`h-5 text-sm text-muted-foreground line-through ${hasOriginalAmount ? "" : "invisible"}`}
      >
        {originalText}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold">{priceText}</span>
        <span className="text-sm text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}

export function PricingPage() {
  const { language, t } = useServerI18n();
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("year");
  const [loadingInterval, setLoadingInterval] = useState<CheckoutInterval | null>(null);
  const [pricing, setPricing] = useState<PublicPricing | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadPricing() {
      const response = await fetch("/api/pricing", { signal: controller.signal });
      const data = await readResponseRecord(response);
      if (response.ok && isPublicPricing(data)) setPricing(data);
    }
    loadPricing().catch(() => undefined);
    return () => controller.abort();
  }, []);

  const isYearly = billingInterval === "year";
  const proPrice = pricing?.prices[billingInterval];
  const proPriceText = pricing && proPrice
    ? formatAmount(proPrice.amount, pricing.currency, language)
    : "—";
  const yearlyMonthlyPrice = pricing
    ? formatAmount(Math.round(pricing.prices.year.amount / 12), pricing.currency, language)
    : "—";
  const proDescription = isYearly
    ? t("pricing.proYearlyDescription", { price: yearlyMonthlyPrice })
    : t("pricing.proMonthlyDescription");
  const proPriceSuffix = isYearly ? t("pricing.perYear") : t("pricing.perMonth");
  const proTitle = isYearly ? t("pricing.proYearly") : t("pricing.proMonthly");
  const proCheckoutLabel = loadingInterval === billingInterval
    ? t("pricing.redirecting")
    : isYearly
      ? t("pricing.getYearly", { price: proPriceText })
      : t("pricing.getMonthly", { price: proPriceText });
  const lifetimePriceText = pricing
    ? formatAmount(pricing.prices.lifetime.amount, pricing.currency, language)
    : "—";

  function selectBillingInterval(values: string[]) {
    const nextInterval = values[0];
    if (nextInterval !== "month" && nextInterval !== "year") return;
    setBillingInterval(nextInterval);
  }

  async function startCheckout(interval: CheckoutInterval) {
    setLoadingInterval(interval);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval }),
      });
      const data = await readResponseRecord(res);
      if (res.ok && isRecord(data) && typeof data.url === "string") {
        window.location.href = data.url;
      } else {
        const message = isRecord(data)
          && data.code !== "checkout_unavailable"
          && typeof data.error === "string"
          ? data.error
          : t("pricing.checkoutUnavailable");
        toast.error(message);
      }
    } catch {
      toast.error(t("pricing.networkError"));
    } finally {
      setLoadingInterval(null);
    }
  }

  return (
    <ServerShell activePage="pricing">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-full flex-col items-center px-4 py-10">
        <div className="max-w-4xl w-full flex flex-col items-center text-center mb-6">
          <Badge className="mb-4" variant="proSoft">{t("pricing.badge")}</Badge>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-3">
            {t("pricing.title")}
          </h1>
          <p className="text-muted-foreground text-base max-w-xl">
            {t("pricing.description")}
          </p>
        </div>
        <ToggleGroup
          aria-label={t("pricing.billingInterval")}
          className="mb-6 bg-background"
          spacing={0}
          value={[billingInterval]}
          variant="outline"
          onValueChange={selectBillingInterval}
        >
          <ToggleGroupItem value="month">{t("pricing.monthly")}</ToggleGroupItem>
          <ToggleGroupItem value="year">{t("pricing.yearly")}</ToggleGroupItem>
        </ToggleGroup>
        <div className="mb-3 h-6">
          <Badge className={pricing?.regional ? "" : "invisible"} variant="proSoft">
            {t("pricing.regionalBrazil", { discount: pricing?.discountPercent ?? 35 })}
          </Badge>
        </div>
        <div className="max-w-5xl w-full grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 pt-3">
        {/* Free Card */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-xl">{t("pricing.free")}</CardTitle>
            <CardDescription className="min-h-[38px]">
              {t("pricing.freeDescription")}
            </CardDescription>
            <PricingAmount
              currency={pricing?.currency}
              language={language}
              originalLabel={t("pricing.originalPrice")}
              price={pricing?.prices.free}
              suffix={t("pricing.forever")}
            />
          </CardHeader>
          <CardContent className="flex-1">
            <ul className="flex flex-col gap-2.5 text-xs">
              <li className="flex items-center gap-2">
                <IconCheck className="text-success w-4 h-4 shrink-0" />
                {t("pricing.freeLocal")}
              </li>
              <li className="flex items-center gap-2">
                <IconCheck className="text-success w-4 h-4 shrink-0" />
                {t("pricing.freeRetention")}
              </li>
              <li className="flex items-center gap-2">
                <IconCheck className="text-success w-4 h-4 shrink-0" />
                {t("pricing.standardViewer")}
              </li>
              <li className="flex items-center gap-2">
                <IconCheck className="text-success w-4 h-4 shrink-0" />
                {t("pricing.clipboardPrompts")}
              </li>
              <li className="flex items-center gap-2">
                <IconCheck className="text-success w-4 h-4 shrink-0" />
                {t("pricing.projectsCollections")}
              </li>
            </ul>
          </CardContent>
          <CardFooter>
            <a href="https://github.com/djalmajr/pinar" target="_blank" className="w-full">
              <Button variant="outline" className="w-full">
                {t("pricing.useFree")}
              </Button>
            </a>
          </CardFooter>
        </Card>

        {/* Pro Card */}
        <div className="relative flex">
          <Card className="h-full w-full border-primary bg-card/80 shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl">{proTitle}</CardTitle>
              <CardDescription className="min-h-[38px]">
                {proDescription}
              </CardDescription>
              <PricingAmount
                currency={pricing?.currency}
                language={language}
                originalLabel={t("pricing.originalPrice")}
                price={proPrice}
                suffix={proPriceSuffix}
              />
            </CardHeader>
            <CardContent className="flex-1">
              <p className="mb-3 text-xs text-muted-foreground">
                {t("pricing.everythingFreePlus")}
              </p>
              <ul className="flex flex-col gap-2.5 text-xs">
                <li className="flex items-center gap-2">
                  <IconCheck className="text-success w-4 h-4 shrink-0" />
                  <span><strong>{t("pricing.permanentRetention")}</strong> ({t("pricing.neverDeleted")})</span>
                </li>
                <li className="flex items-center gap-2">
                  <IconCheck className="text-success w-4 h-4 shrink-0" />
                  <span><strong>{t("pricing.permanentViewers")}</strong> {t("pricing.forPrs")}</span>
                </li>
                <li className="flex items-center gap-2">
                  <IconCheck className="text-success w-4 h-4 shrink-0" />
                  <span><strong>{t("pricing.storage5")}</strong></span>
                </li>
                <li className="flex items-center gap-2">
                  <IconCheck className="text-success w-4 h-4 shrink-0" />
                  <span>{t("pricing.searchHistory")}</span>
                </li>
                <li className="flex items-center gap-2">
                  <IconCheck className="text-success w-4 h-4 shrink-0" />
                  <span>{t("pricing.unbrandedViewers")}</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                disabled={loadingInterval !== null || !pricing}
                onClick={() => startCheckout(billingInterval)}
              >
                {proCheckoutLabel}
              </Button>
            </CardFooter>
          </Card>
          {isYearly && (
            <div className="absolute -top-3 right-6">
              <Badge variant="proSoft">{t("pricing.save45")}</Badge>
            </div>
          )}
        </div>

        {/* Lifetime Deal Card */}
        <div className="relative flex">
          <Card className="h-full w-full border-success/50 shadow-md">
            <CardHeader>
              <CardTitle className="text-xl">{t("pricing.lifetime")}</CardTitle>
              <CardDescription className="min-h-[38px]">
                {t("pricing.lifetimeDescription")}
              </CardDescription>
              <PricingAmount
                currency={pricing?.currency}
                language={language}
                originalLabel={t("pricing.originalPrice")}
                price={pricing?.prices.lifetime}
                suffix={t("pricing.oneTime")}
              />
            </CardHeader>
            <CardContent className="flex-1">
              <p className="mb-3 text-xs text-muted-foreground">
                {t("pricing.everythingProPlus")}
              </p>
              <ul className="flex flex-col gap-2.5 text-xs">
                <li className="flex items-center gap-2">
                  <IconCheck className="text-success w-4 h-4 shrink-0" />
                  <span><strong>{t("pricing.lifetimeAccess")}</strong> ({t("pricing.noSubscriptions")})</span>
                </li>
                <li className="flex items-center gap-2">
                  <IconCheck className="text-success w-4 h-4 shrink-0" />
                  <span><strong>{t("pricing.earlyAccess")}</strong></span>
                </li>
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full bg-success text-success-foreground hover:bg-success/90"
                disabled={loadingInterval !== null || !pricing}
                onClick={() => startCheckout("lifetime")}
              >
                {loadingInterval === "lifetime"
                  ? t("pricing.redirecting")
                  : t("pricing.getLifetime", { price: lifetimePriceText })}
              </Button>
            </CardFooter>
          </Card>
          <div className="absolute -top-3 right-6">
            <Badge
              variant="successSoft"
              className="bg-emerald-50 text-[10px] font-extrabold tracking-wider dark:bg-emerald-950"
            >
              {t("pricing.earlyBird")}
            </Badge>
          </div>
        </div>
        </div>

        <ServerFooter
          note={(
            <span className="inline-flex items-center gap-1.5">
              <IconLock className="size-3.5" />
              {t("pricing.secureCheckout")} • {t("pricing.cancelAnytime")}
            </span>
          )}
        />
        </div>
      </ScrollArea>
    </ServerShell>
  );
}
