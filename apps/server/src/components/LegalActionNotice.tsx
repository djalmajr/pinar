import { useServerI18n } from "@/lib/i18n";
import { CURRENT_LEGAL_VERSION } from "@/lib/legal-documents";

interface CurrentLegalAcceptance {
  acceptableUseVersion: string;
  accepted: true;
  locale: "en" | "pt";
  privacyVersion: string;
  termsVersion: string;
}

export function currentLegalAcceptance(locale: "en" | "pt"): CurrentLegalAcceptance {
  return {
    acceptableUseVersion: CURRENT_LEGAL_VERSION,
    accepted: true,
    locale,
    privacyVersion: CURRENT_LEGAL_VERSION,
    termsVersion: CURRENT_LEGAL_VERSION,
  };
}

export function LegalActionNotice() {
  const { t } = useServerI18n();
  return (
    <p className="text-xs leading-5 text-muted-foreground">
      {t("pricing.legalNoticePrefix")}{" "}
      <a
        className="font-medium underline underline-offset-4"
        href="/legal/terms"
        rel="noopener noreferrer"
        target="_blank"
      >
        {t("pricing.legalTerms")}
      </a>
      {", "}
      <a
        className="font-medium underline underline-offset-4"
        href="/legal/privacy"
        rel="noopener noreferrer"
        target="_blank"
      >
        {t("pricing.legalPrivacy")}
      </a>
      {" "}{t("pricing.legalAnd")}{" "}
      <a
        className="font-medium underline underline-offset-4"
        href="/legal/acceptable-use"
        rel="noopener noreferrer"
        target="_blank"
      >
        {t("pricing.legalAcceptableUse")}
      </a>
      .
      <span className="mt-1 block">
        {t("pricing.legalNoticeVersion", { version: CURRENT_LEGAL_VERSION })}
      </span>
    </p>
  );
}
