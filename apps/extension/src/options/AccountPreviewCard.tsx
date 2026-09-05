import type { TranslationDictionary } from "@pinar/shared";
import {
  Badge,
  Button,
  Input,
  PinarMark,
  Separator,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@pinar/ui";
import IconCoffee from "~icons/lucide/coffee";
import IconExternalLink from "~icons/lucide/external-link";
import IconGithub from "~icons/radix-icons/github-logo";
import IconHeart from "~icons/lucide/heart";
import IconLogOut from "~icons/lucide/log-out";
import IconMail from "~icons/lucide/mail";
import IconSave from "~icons/lucide/save";
import IconSparkles from "~icons/lucide/sparkles";
import { AccountCodeStrip } from "./AccountCodeStrip";
import type { AccountTabStateFixture } from "./account-tab-states";
import extensionPackage from "../../package.json";

const SECTION_HEADER = "text-[11px] font-semibold uppercase leading-none tracking-wider text-muted-foreground";
const SECTION_DESC = "mt-0.5 mb-5 text-xs text-muted-foreground";

interface AccountPreviewCardProps {
  hostedPricingHref: string;
  hostedSignInHref: string;
  state: AccountTabStateFixture;
  t: TranslationDictionary;
}

function ignoreSubmit(event: { preventDefault(): void }) {
  event.preventDefault();
}

function codeCaption(state: AccountTabStateFixture, t: TranslationDictionary) {
  if (!state.temporaryCode) return t.account_code_hint;
  if (state.expired) return t.account_code_expired;
  if (state.copiedCode) {
    return t.account_code_copied.replace("{time}", state.temporaryCodeCountdown);
  }
  return t.account_code_expires.replace("{time}", state.temporaryCodeCountdown);
}

function AccountBody({
  hostedPricingHref,
  hostedSignInHref,
  state,
  t,
}: AccountPreviewCardProps) {
  if (!state.authReady) {
    return (
      <div className="flex flex-col gap-2.5 py-1">
        <div className="h-2 w-20 rounded bg-slate-300" />
        <div className="h-9 w-full rounded-lg bg-muted" />
        <div className="h-2 w-2/3 rounded bg-muted" />
      </div>
    );
  }

  if (state.session?.kind === "account") {
    return (
      <section className="flex flex-col">
        <span className={SECTION_HEADER}>{t.account_title}</span>
        <p className={SECTION_DESC}>{t.account_title_desc}</p>
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{state.session.email}</p>
            <p className="mt-1 text-xs capitalize text-muted-foreground">{state.session.plan}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {state.session.plan === "pro" ? (
              <Button size="sm" type="button" variant="outline">{t.btn_manage_sub}</Button>
            ) : null}
            <Button size="sm" type="button" variant="outline">
              <IconLogOut data-icon="inline-start" />
              {t.btn_sign_out}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  const generating = state.id === "free-generating";
  const sendingEmail = state.id === "free-email-sending";
  const verifying = state.id === "free-email-verifying";
  const sendLabel = sendingEmail ? "Enviando…" : t.btn_send_code;
  const verifyLabel = verifying ? "Verificando…" : t.btn_verify_code;

  return (
    <>
      <section aria-labelledby="account-free-title" className="flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <span className={SECTION_HEADER} id="account-free-title">{t.account_free_title}</span>
          <Badge className="shrink-0 bg-muted text-muted-foreground" variant="outline">{t.account_free_badge}</Badge>
        </div>
        <p className={SECTION_DESC}>{t.account_free_description}</p>
        <div className="flex flex-col gap-2.5">
          <AccountCodeStrip
            caption={codeCaption(state, t)}
            copiedCode={state.copiedCode}
            expired={state.expired}
            generating={generating}
            hostedSignInHref={hostedSignInHref}
            t={t}
            temporaryCode={state.temporaryCode}
          />
        </div>
      </section>
      <Separator />
      <section aria-labelledby="account-email-title" className="flex flex-col">
        <span className={SECTION_HEADER} id="account-email-title">{t.account_email_title}</span>
        <p className={SECTION_DESC}>{state.emailCodeRequested ? t.account_email_sent : t.account_email_description}</p>
        <div className="flex flex-col gap-2.5">
          {state.emailCodeRequested ? (
            <form className="flex flex-col gap-2" onSubmit={ignoreSubmit}>
              <label className="block text-xs font-semibold" htmlFor={`${state.id}-email-code`}>{t.account_email_code_label}</label>
              <div className="flex gap-2">
                <Input
                  autoComplete="one-time-code"
                  className={state.emailCode ? undefined : "text-muted-foreground"}
                  id={`${state.id}-email-code`}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  readOnly
                  value={state.emailCode || "000000"}
                />
                <Button className="shrink-0" type="button" variant="outline">{t.btn_cancel}</Button>
                <Button className="shrink-0" disabled={state.authLoading || state.emailCode.length !== 6} type="submit">
                  {verifyLabel}
                </Button>
              </div>
            </form>
          ) : (
            <form className="flex gap-2" onSubmit={ignoreSubmit}>
              <Input autoComplete="email" placeholder="you@example.com" readOnly type="email" value={state.email} />
              <Button disabled={state.authLoading} type="submit" variant="outline">
                <IconMail data-icon="inline-start" />
                {sendLabel}
              </Button>
            </form>
          )}
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/60 p-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold">{t.account_subscription_prompt_title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t.account_subscription_prompt_description}</p>
            </div>
            <Button
              className="shrink-0"
              render={<a href={hostedPricingHref} rel="noopener noreferrer" target="_blank" />}
              variant="pro"
            >
              <IconSparkles data-icon="inline-start" />
              {t.btn_upgrade_pro}
            </Button>
          </div>
        </div>
      </section>
      {state.authError ? <p className="text-xs font-medium text-destructive" role="alert">{state.authError}</p> : null}
    </>
  );
}

export function AccountPreviewCard({
  hostedPricingHref,
  hostedSignInHref,
  state,
  t,
}: AccountPreviewCardProps) {
  return (
    <div className="relative flex w-full max-w-[640px] flex-col gap-5 overflow-hidden rounded-2xl border border-border bg-card p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <PinarMark />
          <div>
            <div className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
              {t.header_title}
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                v{extensionPackage.version}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{t.header_desc}</div>
          </div>
        </div>
        <Button size="icon" title="GitHub" type="button" variant="outline">
          <IconGithub className="size-4" />
        </Button>
      </header>

      <Tabs className="gap-4" value="account" onValueChange={() => undefined}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="storage">{t.tab_storage}</TabsTrigger>
          <TabsTrigger value="preferences">{t.tab_preferences}</TabsTrigger>
          <TabsTrigger value="shortcuts">{t.tab_shortcuts}</TabsTrigger>
          <TabsTrigger value="account">{t.tab_account}</TabsTrigger>
        </TabsList>
        <div className="flex flex-col gap-5">
          <AccountBody
            hostedPricingHref={hostedPricingHref}
            hostedSignInHref={hostedSignInHref}
            state={state}
            t={t}
          />
        </div>
      </Tabs>

      <footer className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button className="h-8 text-xs" disabled size="sm" type="button">
            <IconSave className="size-3.5" />
            {t.btn_save}
          </Button>
          <Button className="h-8 text-xs" size="sm" type="button" variant="outline">
            {t.btn_open_app}
            <IconExternalLink data-icon="inline-end" />
          </Button>
        </div>
        <div className="flex gap-2">
          <Button className="h-8 text-xs" size="sm" type="button" variant="coffee">
            <IconCoffee />
            {t.btn_coffee}
          </Button>
          <Button className="h-8 text-xs" size="sm" type="button" variant="sponsor">
            <IconHeart className="fill-current" />
            {t.btn_sponsor}
          </Button>
        </div>
      </footer>

      {state.regenerateCodeOpen ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/45 p-6">
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10">
            <div className="flex flex-col gap-1.5">
              <p className="text-base font-medium">{t.account_code_regeneration_title}</p>
              <p className="text-sm text-muted-foreground">
                {t.account_code_regeneration_description.replace("{code}", state.temporaryCode)}
              </p>
            </div>
            <div className="-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-t bg-muted/50 p-4">
              <Button type="button" variant="outline">{t.btn_cancel}</Button>
              <Button type="button">{t.btn_invalidate_and_generate}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
