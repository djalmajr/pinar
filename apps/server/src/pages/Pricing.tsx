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

export function pricingCheckoutMessage(
  status: number,
  data: unknown,
  copy: { addonRequiresPro: string; unavailable: string },
): string {
  if (status === 402 && isRecord(data) && data.code === "cloud_pro_required_for_addon") {
    return copy.addonRequiresPro;
  }
  if (isRecord(data) && data.code !== "checkout_unavailable" && typeof data.error === "string") {
    return data.error;
  }
  return copy.unavailable;
}

interface PricingAmountProps {
  compact?: boolean;
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
  legalNoteId: string;
  legalNoteMarker: string;
  loading: boolean;
  price: PublicPrice | undefined;
  title: string;
  onPurchase(): void;
}

function formatAmount(amount: number, currency: PricingCurrency, language: SupportedLanguage) {
  const locale = language === "pt" ? "pt-BR" : language;
  return new Intl.NumberFormat(locale, { currency, style: "currency" }).format(amount / 100);
}

function PricingAmount({ compact = false, currency, language, originalLabel, price, suffix }: PricingAmountProps) {
  const originalAmount = price?.originalAmount;
  const hasOriginalAmount = currency !== undefined && typeof originalAmount === "number";
  const originalText = hasOriginalAmount ? formatAmount(originalAmount, currency, language) : null;
  const priceText = currency && price ? formatAmount(price.amount, currency, language) : "—";
  return (
    <div className={compact ? "" : "pt-2"}>
      {hasOriginalAmount ? (
        <div
          aria-label={originalLabel}
          className="h-5 text-sm text-muted-foreground line-through"
        >
          {originalText}
        </div>
      ) : null}
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold">{priceText}</span>
        {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  );
}

function AddOnCard({
  buttonLabel,
  currency,
  description,
  language,
  legalNoteId,
  legalNoteMarker,
  loading,
  price,
  title,
  onPurchase,
}: AddOnCardProps) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>
          {description}<sup aria-hidden="true">{legalNoteMarker}</sup>
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <PricingAmount
          compact
          currency={currency}
          language={language}
          originalLabel=""
          price={price}
          suffix=""
        />
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2">
        <Button
          aria-describedby={`${legalNoteId} pricing-addons-validity`}
          className="w-full"
          disabled={loading || !price}
          variant="outline"
          onClick={onPurchase}
        >
          <span>
            {buttonLabel}
            <sup aria-hidden="true">{legalNoteMarker}</sup>
          </span>
        </Button>
      </CardFooter>
    </Card>
  );
}

export function PricingPage() {
  const { language, t } = useServerI18n();
  const [loadingOffer, setLoadingOffer] = useState<CheckoutOffer | null>(null);
  const [pricing, setPricing] = useState<PublicPricing | null>(null);
  const [freeHref, setFreeHref] = useState(() => freeInstallUrl());

  const trialEnabled = Boolean(
    pricing &&
      "trialEnabled" in pricing &&
      (pricing as { trialEnabled?: boolean }).trialEnabled === true,
  );

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

  const proOffer: CheckoutOffer = "pro_year";
  const proPrice = pricing?.prices.year;
  const proPriceText = pricing && proPrice
    ? formatAmount(proPrice.amount, pricing.currency, language)
    : "—";
  const proDescription = t("pricing.proYearlyDescription");
  const proPriceSuffix = t("pricing.perYear");
  const proTitle = t("pricing.proYearly");
  const proCheckoutLabel = loadingOffer === proOffer
    ? t("pricing.redirecting")
    : t("pricing.getYearly", { price: proPriceText });

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
        toast.error(pricingCheckoutMessage(res.status, data, {
          addonRequiresPro: t("pricing.addonRequiresPro"),
          unavailable: t("pricing.checkoutUnavailable"),
        }));
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
        <div className="mb-3 h-6">
          <Badge className={pricing?.regional ? "" : "invisible"} variant="proSoft">
            {t("pricing.regionalBrazil")}
          </Badge>
        </div>
        <div className="max-w-3xl w-full grid grid-cols-1 md:grid-cols-2 gap-6 mb-3 pt-3">
        {/* Free Card */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-xl">
              {trialEnabled ? t("pricing.freeLocalTitle") : t("pricing.free")}
            </CardTitle>
            <CardDescription className="min-h-[38px]">
              {trialEnabled
                ? t("pricing.freeLocalDescription")
                : t("pricing.freeDescription")}
            </CardDescription>
            <PricingAmount
              currency={pricing?.currency}
              language={language}
              originalLabel={t("pricing.originalPrice")}
              price={pricing?.prices.free}
              suffix={
                trialEnabled
                  ? t("pricing.freeLocalScope")
                  : t("pricing.freeScope")
              }
            />
          </CardHeader>
          <CardContent className="flex-1">
            <ul className="flex flex-col gap-2.5 text-xs">
              <li className="flex items-center gap-2">
                <IconCheck className="text-success w-4 h-4 shrink-0" />
                {t("pricing.freeLocal")}
              </li>
              {trialEnabled ? (
                <li className="flex items-center gap-2">
                  <IconCheck className="text-success w-4 h-4 shrink-0" />
                  {t("pricing.freeSelfHosted")}
                </li>
              ) : (
                <>
                  <li className="flex items-center gap-2">
                    <IconCheck className="text-success w-4 h-4 shrink-0" />
                    {t("pricing.freeRetention")}
                  </li>
                  <li className="flex items-center gap-2">
                    <IconCheck className="text-success w-4 h-4 shrink-0" />
                    {t("pricing.freeStorage")}
                  </li>
                </>
              )}
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
              {trialEnabled ? t("pricing.installLocal") : t("pricing.useFree")}
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
                {trialEnabled
                  ? t("pricing.everythingLocalPlus")
                  : t("pricing.everythingFreePlus")}
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
                  <span><strong>{t("pricing.storage2")}</strong></span>
                </li>
                <li className="flex items-center gap-2">
                  <IconCheck className="text-success w-4 h-4 shrink-0" />
                  <span><strong>{t("pricing.proAiCredits")}</strong></span>
                </li>
                <li className="flex items-center gap-2">
                  <IconCheck className="text-success w-4 h-4 shrink-0" />
                  <span>{t("pricing.searchHistory")}</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-2">
              <Button
                aria-describedby="pricing-legal-note"
                className="w-full"
                disabled={loadingOffer !== null || !pricing}
                onClick={() => startCheckout(proOffer)}
              >
                <span>
                  {proCheckoutLabel}
                  <sup aria-hidden="true">1</sup>
                </span>
              </Button>
              {trialEnabled ? (
                <div className="flex flex-col items-center gap-1.5 pt-1 text-center">
                  <Button
                    className="w-full"
                    render={<a href="/sign-in?returnTo=%2Fapp" />}
                    size="sm"
                    variant="outline"
                  >
                    {t("pricing.startTrial")}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    {t("pricing.trialDetails")}
                  </p>
                </div>
              ) : null}
            </CardFooter>
          </Card>
        </div>
        </div>

        <div className="mb-5 max-w-3xl text-center">
          <h2 className="text-2xl font-bold">{t("pricing.addOnsTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("pricing.addOnsDescription")}</p>
          {trialEnabled ? (
            <p className="mt-1 text-sm text-muted-foreground">{t("pricing.addOnsTrialNote")}</p>
          ) : null}
        </div>
        <div className="mb-3 grid w-full max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
          <AddOnCard
            buttonLabel={loadingOffer === "ai_credits_500" ? t("pricing.redirecting") : t("pricing.buyAddOn")}
            currency={pricing?.currency}
            description={t("pricing.aiCreditsDescription")}
            language={language}
            legalNoteId="pricing-legal-note"
            legalNoteMarker="2"
            loading={loadingOffer !== null}
            price={pricing?.prices.aiCredits500}
            title={t("pricing.aiCreditsTitle")}
            onPurchase={() => startCheckout("ai_credits_500")}
          />
          <AddOnCard
            buttonLabel={loadingOffer === "storage_1gb_12m" ? t("pricing.redirecting") : t("pricing.buyAddOn")}
            currency={pricing?.currency}
            description={t("pricing.storage1Description")}
            language={language}
            legalNoteId="pricing-legal-note"
            legalNoteMarker="2"
            loading={loadingOffer !== null}
            price={pricing?.prices.storage1Gb12M}
            title={t("pricing.storage1Title")}
            onPurchase={() => startCheckout("storage_1gb_12m")}
          />
          <AddOnCard
            buttonLabel={loadingOffer === "storage_5gb_12m" ? t("pricing.redirecting") : t("pricing.buyAddOn")}
            currency={pricing?.currency}
            description={t("pricing.storage5Description")}
            language={language}
            legalNoteId="pricing-legal-note"
            legalNoteMarker="2"
            loading={loadingOffer !== null}
            price={pricing?.prices.storage5Gb12M}
            title={t("pricing.storage5Title")}
            onPurchase={() => startCheckout("storage_5gb_12m")}
          />
        </div>
        <ServerFooter
          className="pt-4"
          beforeSupport={(
            <div className="mx-auto mb-4 flex w-full max-w-5xl flex-col gap-1 px-1">
              <LegalActionNotice id="pricing-legal-note" inlineVersion marker="1, 2" />
              <p className="text-xs leading-5 text-muted-foreground" id="pricing-addons-validity">
                <sup aria-hidden="true">2</sup> {t("pricing.valid12Months")}.
              </p>
            </div>
          )}
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
