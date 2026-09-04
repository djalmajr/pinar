import type { SupportedLanguage } from "@pinar/shared";
import { freeInstallUrl } from "@pinar/shared";
import { useEffect, useState } from "react";
import { currentLegalAcceptance, LegalActionNotice } from "@/components/LegalActionNotice";
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
import type { CheckoutOffer } from "@/lib/entitlements";
import { useServerI18n } from "@/lib/i18n";
import {
  type PricingCurrency,
  type PublicPrice,
  type PublicPricing,
  isPublicPricing,
} from "@/lib/pricing";

type BillingInterval = "month" | "year";

interface PricingAmountProps {
  currency: PricingCurrency | undefined;
  language: SupportedLanguage;
  originalLabel: string;
  price: PublicPrice | undefined;
  suffix: string;
}

interface AddOnCardProps {
  buttonLabel: string;
  currency: PricingCurrency | undefined;
  description: string;
  language: SupportedLanguage;
  loading: boolean;
  price: PublicPrice | undefined;
  suffix: string;
  title: string;
  onPurchase(): void;
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

function AddOnCard({
  buttonLabel,
  currency,
  description,
  language,
  loading,
  price,
  suffix,
  title,
  onPurchase,
}: AddOnCardProps) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <PricingAmount
          currency={currency}
          language={language}
          originalLabel=""
          price={price}
          suffix={suffix}
        />
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2">
        <Button className="w-full" disabled={loading || !price} variant="outline" onClick={onPurchase}>
          {buttonLabel}
        </Button>
        <LegalActionNotice />
      </CardFooter>
    </Card>
  );
}

export function PricingPage() {
  const { language, t } = useServerI18n();
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("year");
  const [loadingOffer, setLoadingOffer] = useState<CheckoutOffer | null>(null);
  const [pricing, setPricing] = useState<PublicPricing | null>(null);
  const [freeHref, setFreeHref] = useState(() => freeInstallUrl());

  useEffect(() => {
    setFreeHref(freeInstallUrl(navigator.userAgent));
  }, []);

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
  const proOffer: CheckoutOffer = isYearly ? "pro_year" : "pro_month";
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
  const proCheckoutLabel = loadingOffer === proOffer
    ? t("pricing.redirecting")
    : isYearly
      ? t("pricing.getYearly", { price: proPriceText })
      : t("pricing.getMonthly", { price: proPriceText });
  const founderPriceText = pricing
    ? formatAmount(pricing.prices.founder.amount, pricing.currency, language)
    : "—";
  const founderAvailable = pricing?.founderState === "available";
  const founderCheckoutLabel = loadingOffer === "founder"
    ? t("pricing.redirecting")
    : pricing?.founderState === "sold_out"
      ? t("pricing.founderSoldOut")
      : pricing?.founderState === "closed"
        ? t("pricing.founderClosed")
        : t("pricing.getFounder", { price: founderPriceText });
  const yearlySavings = pricing
    ? Math.round((1 - pricing.prices.year.amount / (pricing.prices.month.amount * 12)) * 100)
    : 0;

  function selectBillingInterval(values: string[]) {
    const nextInterval = values[0];
    if (nextInterval !== "month" && nextInterval !== "year") return;
    setBillingInterval(nextInterval);
  }

  async function startCheckout(offer: CheckoutOffer) {
    setLoadingOffer(offer);
    try {
      const checkoutClaim = crypto.randomUUID();
      const legalLocale = language === "pt" ? "pt" : "en";
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkoutClaim,
          legalAcceptance: currentLegalAcceptance(legalLocale),
          locale: legalLocale,
          offer,
          requestId: crypto.randomUUID(),
        }),
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
      setLoadingOffer(null);
    }
  }

  return (
    <ServerShell activePage="pricing">
      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto flex min-h-full w-full max-w-6xl flex-col items-center px-5 py-10">
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
            {t("pricing.regionalBrazil")}
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
              suffix={t("pricing.localOnly")}
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
                {t("pricing.freeStorage")}
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
            <Button
              className="w-full"
              render={<a href={freeHref} rel="noopener noreferrer" target="_blank" />}
              variant="outline"
            >
              {t("pricing.useFree")}
            </Button>
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
                  <span><strong>{t("pricing.activePlanRetention")}</strong> ({t("pricing.retentionPolicy")})</span>
                </li>
                <li className="flex items-center gap-2">
                  <IconCheck className="text-success w-4 h-4 shrink-0" />
                  <span><strong>{t("pricing.activePlanViewers")}</strong> {t("pricing.forPrs")}</span>
                </li>
                <li className="flex items-center gap-2">
                  <IconCheck className="text-success w-4 h-4 shrink-0" />
                  <span><strong>{t("pricing.storage5")}</strong></span>
                </li>
                <li className="flex items-center gap-2">
                  <IconCheck className="text-success w-4 h-4 shrink-0" />
                  <span><strong>{t("pricing.proAiCredits")}</strong></span>
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
            <CardFooter className="flex-col items-stretch gap-2">
              <Button
                className="w-full"
                disabled={loadingOffer !== null || !pricing}
                onClick={() => startCheckout(proOffer)}
              >
                {proCheckoutLabel}
              </Button>
              <LegalActionNotice />
            </CardFooter>
          </Card>
          {isYearly && (
            <div className="absolute -top-3 right-6">
              <Badge variant="proSoft">{t("pricing.save45", { percent: yearlySavings })}</Badge>
            </div>
          )}
        </div>

        {/* Founder Card */}
        <div className="relative flex">
          <Card className="h-full w-full border-success/50 shadow-md">
            <CardHeader>
              <CardTitle className="text-xl">{t("pricing.founder")}</CardTitle>
              <CardDescription className="min-h-[38px]">
                {t("pricing.founderDescription")}
              </CardDescription>
              <PricingAmount
                currency={pricing?.currency}
                language={language}
                originalLabel={t("pricing.originalPrice")}
                price={pricing?.prices.founder}
                suffix={t("pricing.oneTime")}
              />
            </CardHeader>
            <CardContent className="flex-1">
              <p className="mb-3 text-xs text-muted-foreground">
                {t("pricing.founderIncludes")}
              </p>
              <ul className="flex flex-col gap-2.5 text-xs">
                <li className="flex items-center gap-2">
                  <IconCheck className="text-success w-4 h-4 shrink-0" />
                  <span><strong>{t("pricing.founderAccess")}</strong> ({t("pricing.withinPolicies")})</span>
                </li>
                <li className="flex items-center gap-2">
                  <IconCheck className="text-success w-4 h-4 shrink-0" />
                  <span><strong>{t("pricing.earlyAccess")}</strong></span>
                </li>
                <li className="flex items-center gap-2">
                  <IconCheck className="text-success w-4 h-4 shrink-0" />
                  <span><strong>{t("pricing.founderAiCredits")}</strong></span>
                </li>
              </ul>
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-2">
              <Button
                className="w-full bg-success text-success-foreground hover:bg-success/90"
                disabled={loadingOffer !== null || !founderAvailable}
                onClick={() => startCheckout("founder")}
              >
                {founderCheckoutLabel}
              </Button>
              <LegalActionNotice />
            </CardFooter>
          </Card>
          <div className="absolute -top-3 right-6">
            <Badge
              variant="successSoft"
              className="bg-emerald-50 text-[10px] font-extrabold tracking-wider dark:bg-emerald-950"
            >
              {t("pricing.limitedLaunch")}
            </Badge>
          </div>
        </div>
        </div>

        <div className="mb-5 max-w-3xl text-center">
          <h2 className="text-2xl font-bold">{t("pricing.addOnsTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("pricing.addOnsDescription")}</p>
        </div>
        <div className="mb-12 grid w-full max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
          <AddOnCard
            buttonLabel={loadingOffer === "ai_credits_1000" ? t("pricing.redirecting") : t("pricing.buyAddOn")}
            currency={pricing?.currency}
            description={t("pricing.aiCreditsDescription")}
            language={language}
            loading={loadingOffer !== null}
            price={pricing?.prices.aiCredits1000}
            suffix={t("pricing.valid12Months")}
            title={t("pricing.aiCreditsTitle")}
            onPurchase={() => startCheckout("ai_credits_1000")}
          />
          <AddOnCard
            buttonLabel={loadingOffer === "storage_5gb_12m" ? t("pricing.redirecting") : t("pricing.buyAddOn")}
            currency={pricing?.currency}
            description={t("pricing.storage5Description")}
            language={language}
            loading={loadingOffer !== null}
            price={pricing?.prices.storage5Gb12M}
            suffix={t("pricing.valid12Months")}
            title={t("pricing.storage5Title")}
            onPurchase={() => startCheckout("storage_5gb_12m")}
          />
          <AddOnCard
            buttonLabel={loadingOffer === "storage_20gb_12m" ? t("pricing.redirecting") : t("pricing.buyAddOn")}
            currency={pricing?.currency}
            description={t("pricing.storage20Description")}
            language={language}
            loading={loadingOffer !== null}
            price={pricing?.prices.storage20Gb12M}
            suffix={t("pricing.valid12Months")}
            title={t("pricing.storage20Title")}
            onPurchase={() => startCheckout("storage_20gb_12m")}
          />
        </div>

        <ServerFooter
          note={(
            <span className="inline-flex items-center gap-1.5">
              <IconLock className="size-3.5" />
              {t("pricing.secureCheckout")} • {t("pricing.billingNote")}
            </span>
          )}
        />
        </main>
      </ScrollArea>
    </ServerShell>
  );
}
