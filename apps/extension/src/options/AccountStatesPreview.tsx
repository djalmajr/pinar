import { useEffect } from "react";
import { translations } from "@pinar/shared";
import { AccountPreviewCard } from "./AccountPreviewCard";
import { ACCOUNT_TAB_STATES } from "./account-tab-states";

const HOSTED_SIGN_IN = "https://pinar.dev/sign-in?extensionCode=&returnTo=%2Fapp&lang=pt";
const HOSTED_PRICING = "https://pinar.dev/pricing?lang=pt";

export function AccountStatesPreview() {
  const t = translations.pt;

  useEffect(() => {
    document.documentElement.classList.add("light");
    document.documentElement.classList.remove("dark");
    document.documentElement.dataset.theme = "light";
    document.title = "Pinar — Conta · estados";
  }, []);

  return (
    <div className="min-h-screen bg-muted/50 px-6 py-8 font-sans text-foreground">
      <header className="mx-auto mb-8 flex max-w-[1400px] flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Conta · estados
        </p>
        <h1 className="text-lg font-semibold tracking-tight">Todos os estados da aba Conta</h1>
        <p className="text-sm text-muted-foreground">
          Dados mocados. Layout A. A extensão real continua com o layout atual até a A ser aplicada.
        </p>
      </header>
      <div className="mx-auto grid max-w-[1400px] gap-10 lg:grid-cols-2">
        {ACCOUNT_TAB_STATES.map((state) => (
          <figure className="flex flex-col gap-3" key={state.id}>
            <figcaption className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {state.label}
            </figcaption>
            <AccountPreviewCard
              hostedPricingHref={HOSTED_PRICING}
              hostedSignInHref={HOSTED_SIGN_IN}
              state={state}
              t={t}
            />
          </figure>
        ))}
      </div>
    </div>
  );
}
