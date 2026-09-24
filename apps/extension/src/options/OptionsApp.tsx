import { type FormEvent, useEffect, useState } from "react";
import {
  type AuthSession,
  type CopyOnFinishBatch,
  getBestLanguage,
  type HandoffMode,
  macosDesktopDmgUrl,
  mergeDeliveryPreferences,
  type PinarSettings,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
  type ThemeMode,
  type TranslationDictionary,
  translations,
  windowsDesktopSetupUrl,
} from "@pinar/shared";
import {
  Button,
  Input,
  PinarMark,
  ScrollArea,
  ScrollBar,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  SettingRow,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toaster,
  toast,
} from "@pinar/ui";
import IconCheck from "~icons/lucide/check";
import IconCoffee from "~icons/lucide/coffee";
import IconCopy from "~icons/lucide/copy";
import IconExternalLink from "~icons/lucide/external-link";
import IconGithub from "~icons/radix-icons/github-logo";
import IconHeart from "~icons/lucide/heart";
import IconLaptop from "~icons/lucide/laptop";
import IconLoaderCircle from "~icons/lucide/loader-circle";
import IconLogOut from "~icons/lucide/log-out";
import IconMail from "~icons/lucide/mail";
import IconMoon from "~icons/lucide/moon";
import IconSave from "~icons/lucide/save";
import IconSun from "~icons/lucide/sun";
import extensionPackage from "../../package.json";
import "../../../../extension/keyboard.js";
import {
  cloudEnvironment,
  resolveCloudUrl,
} from "../../../../extension/environment.js";
import {
  type ExtensionResponseBase,
  withExtensionResponseFallback,
} from "./extension-response";

const LANGUAGE_OPTIONS = SUPPORTED_LANGUAGES.map((code) => ({ code, label: translations[code].name }));

const SECTION_HEADER = "text-[11px] font-semibold uppercase leading-none tracking-wider text-muted-foreground";
const SECTION_DESC = "mt-0.5 mb-5 text-xs text-muted-foreground";

const OVERLAY_SHORTCUTS = [
  { description: "shortcut_pin_element_desc", keys: "Enter", label: "shortcut_pin_element" },
  { description: "shortcut_walk_dom_desc", keys: "↑ / ↓", label: "shortcut_walk_dom" },
  { description: "shortcut_mask_desc", keys: "M", label: "shortcut_mask" },
  { description: "shortcut_toggle_regions_desc", keys: "R", label: "shortcut_toggle_regions" },
  { description: "shortcut_cancel_desc", keys: "Esc", label: "shortcut_cancel" },
  { description: "shortcut_copy_desc", keys: "copy", label: "shortcut_copy" },
] as const satisfies ReadonlyArray<{ description: keyof TranslationDictionary; keys: string; label: keyof TranslationDictionary }>;

function ShortcutRow({ description, editLabel, keys, label, onEdit }: { description: string; editLabel?: string; keys: string; label: string; onEdit?: () => void }) {
  const chip = <kbd className="block rounded border bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors group-hover/shortcut:border-primary group-hover/shortcut:text-foreground">{keys}</kbd>;
  return (
    <li>
      <SettingRow description={description} size="xs" title={label}>
        {onEdit ? (
          <button aria-label={editLabel} className="group/shortcut shrink-0 cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/30" title={editLabel} type="button" onClick={onEdit}>{chip}</button>
        ) : (
          chip
        )}
      </SettingRow>
    </li>
  );
}

const COMMAND_TEXT = {
  _execute_action: { description: "shortcuts_toggle_desc", label: "shortcuts_toggle_label" },
  "finish-batch": { description: "shortcuts_finish_batch_desc", label: "shortcuts_finish_batch_label" },
  "cancel-batch": { description: "shortcuts_cancel_batch_desc", label: "shortcuts_cancel_batch_label" },
  "open-panel": { description: "shortcuts_open_panel_desc", label: "shortcuts_open_panel_label" },
} as const satisfies Record<string, { description: keyof TranslationDictionary; label: keyof TranslationDictionary }>;

function commandText(command: chrome.commands.Command, t: TranslationDictionary) {
  const keys = COMMAND_TEXT[command.name as keyof typeof COMMAND_TEXT];
  // Chrome only knows the English manifest description; our own UI must not.
  if (!keys) return { description: "", label: command.description || command.name || "" };
  return { description: t[keys.description], label: t[keys.label] };
}

function ShortcutsTab({ platform, t }: { platform: "mac" | "win" | "other"; t: TranslationDictionary }) {
  const [commands, setCommands] = useState<chrome.commands.Command[]>([]);

  useEffect(() => {
    const read = () => chrome.commands?.getAll?.((all) => setCommands(all ?? []));
    read();
    // Chrome fires no event when a binding changes on chrome://extensions/shortcuts,
    // so re-read whenever the user comes back to this page.
    const onVisibility = () => { if (document.visibilityState === "visible") read(); };
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col">
        <span className={SECTION_HEADER}>{t.shortcuts_browser_title}</span>
        <p className={SECTION_DESC}>{t.shortcuts_browser_desc}</p>
        <ul className="flex flex-col gap-2">
          {commands.map((command) => (
            <ShortcutRow editLabel={t.shortcuts_customize} key={command.name} keys={command.shortcut || t.shortcuts_unassigned} {...commandText(command, t)} onEdit={() => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" })} />
          ))}
        </ul>
      </section>
      <Separator />
      <section className="flex flex-col">
        <span className={SECTION_HEADER}>{t.shortcuts_overlay_title}</span>
        <p className={SECTION_DESC}>{t.shortcuts_overlay_desc}</p>
        <ul className="flex flex-col gap-2">
          {OVERLAY_SHORTCUTS.map((item) => (
            <ShortcutRow
              description={t[item.description]}
              key={item.keys}
              keys={item.keys === "copy" ? globalThis.__pinarKeyboardEvents.copyShortcutLabel(platform === "mac") : item.keys}
              label={t[item.label]}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

const DEFAULT_LANGUAGE: SupportedLanguage = "en";
const SETTINGS_KEYS: (keyof PinarSettings)[] = [
  "cloudUrl",
  "copyOnFinishBatch",
  "copyViewerContent",
  "enableHistory",
  "handoffMode",
  "includeScreenshot",
  "includeViewer",
  "language",
  "loopMetricsOptIn",
  "sensitiveQueryKeys",
  "storageMode",
  "theme",
  "voicePostProcessing",
];

const DEFAULT_SETTINGS: PinarSettings = {
  cloudUrl: "https://pinar.dev",
  copyOnFinishBatch: "prompt",
  copyViewerContent: false,
  enableHistory: true,
  handoffMode: "compact",
  includeScreenshot: true,
  includeViewer: true,
  language: DEFAULT_LANGUAGE,
  loopMetricsOptIn: false,
  sensitiveQueryKeys: "",
  storageMode: "local",
  theme: "system",
  voicePostProcessing: false,
};

interface ExtensionResponse extends ExtensionResponseBase {
  code?: string;
  copyOnFinishBatch?: CopyOnFinishBatch;
  copyViewerContent?: boolean;
  error?: string;
  handoffMode?: HandoffMode;
  includeScreenshot?: boolean;
  includeViewer?: boolean;
  language?: SupportedLanguage | null;
  ok?: boolean;
  sensitiveQueryKeys?: string;
  voicePostProcessing?: boolean;
  session?: AuthSession;
  url?: string;
}

function extensionVersion() {
  return typeof chrome !== "undefined" && chrome.runtime?.getManifest
    ? chrome.runtime.getManifest().version
    : extensionPackage.version;
}

function isExtensionContext() {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id) && Boolean(chrome.runtime?.sendMessage);
}

function hostedSignInUrl(cloudUrl: string, language: SupportedLanguage) {
  const url = new URL(`${(cloudUrl || "https://pinar.dev").replace(/\/+$/, "")}/sign-in`);
  url.searchParams.set("returnTo", "/app");
  if (language) url.searchParams.set("lang", language);
  return url.toString();
}

async function extensionMessage(
  message: Record<string, unknown>,
  unavailableMessage: string,
): Promise<ExtensionResponse> {
  if (!isExtensionContext()) return { error: unavailableMessage, ok: false };
  const response: ExtensionResponse | undefined = await chrome.runtime.sendMessage(message).catch(() => undefined);
  return withExtensionResponseFallback(response, unavailableMessage);
}

function areSettingsEqual(left: PinarSettings, right: PinarSettings) {
  return SETTINGS_KEYS.every((key) => left[key] === right[key]);
}

function applyDeliveryResponse(current: PinarSettings, patch: unknown): PinarSettings {
  const language = (SUPPORTED_LANGUAGES as readonly string[]).includes(current.language)
    ? current.language as SupportedLanguage
    : null;
  const merged = mergeDeliveryPreferences({
    captureDestination: null,
    componentTarget: null,
    copyOnFinishBatch: current.copyOnFinishBatch,
    copyViewerContent: Boolean(current.copyViewerContent),
    handoffMode: current.handoffMode === "full" ? "full" : "compact",
    includeScreenshot: current.includeScreenshot !== false,
    includeViewer: current.includeViewer !== false,
    language,
    sensitiveQueryKeys: typeof current.sensitiveQueryKeys === "string" ? current.sensitiveQueryKeys : "",
    voicePostProcessing: current.voicePostProcessing === true,
  }, patch);
  return {
    ...current,
    copyOnFinishBatch: merged.copyOnFinishBatch,
    copyViewerContent: merged.copyViewerContent,
    handoffMode: merged.handoffMode,
    includeScreenshot: merged.includeScreenshot,
    includeViewer: merged.includeViewer,
    language: merged.language ?? current.language,
    sensitiveQueryKeys: merged.sensitiveQueryKeys,
    voicePostProcessing: merged.voicePostProcessing,
  };
}

function applyTheme(mode: ThemeMode) {
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function OptionsApp() {
  const [settings, setSettings] = useState<PinarSettings>(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<PinarSettings>(DEFAULT_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [lang, setLang] = useState<SupportedLanguage>(DEFAULT_LANGUAGE);
  const [installPlatform, setInstallPlatform] = useState<"mac" | "win" | "other">("mac");
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailCodeRequested, setEmailCodeRequested] = useState(false);
  const [emailCodeRequestLoading, setEmailCodeRequestLoading] = useState(false);
  const [emailCodeVerificationLoading, setEmailCodeVerificationLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);

  const t = translations[lang] || translations.en;
  const manifest = isExtensionContext() ? chrome.runtime.getManifest() : {};
  const environment = cloudEnvironment(manifest, settings.cloudUrl);
  const hasUnsavedChanges = !areSettingsEqual(settings, savedSettings);
  const installCommand = "curl -fsSL https://pinar.dev/install.sh | sh";
  const desktopInstallUrl =
    installPlatform === "win" ? windowsDesktopSetupUrl() : macosDesktopDmgUrl();
  const localStorageDescription = installPlatform === "win" ? t.local_desc_windows : t.local_desc;
  const voiceAvailable = settings.storageMode === "cloud"
    && authSession?.kind === "account"
    && authSession.plan === "pro";

  async function syncDeliveryPreferences(current: PinarSettings): Promise<PinarSettings> {
    const response = await extensionMessage({ type: "preferences:get" }, "");
    if (!response.ok || typeof response.includeScreenshot !== "boolean") return current;
    const next = applyDeliveryResponse(current, response);
    if (areSettingsEqual(next, current)) return current;
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      await chrome.storage.sync.set({
        copyOnFinishBatch: next.copyOnFinishBatch,
        copyViewerContent: next.copyViewerContent,
        handoffMode: next.handoffMode,
        includeScreenshot: next.includeScreenshot,
        includeViewer: next.includeViewer,
        language: next.language,
        sensitiveQueryKeys: next.sensitiveQueryKeys,
        voicePostProcessing: next.voicePostProcessing,
      });
    }
    return next;
  }

  async function loadAuthSession() {
    setAuthError("");
    try {
      const response = await extensionMessage({ type: "auth:get" }, t.account_unavailable);
      if (!response.ok) throw new Error(response.error || t.account_unavailable);
      setAuthSession(response.session ?? null);
    } catch {
      setAuthSession(null);
    } finally {
      setAuthReady(true);
    }
  }

  useEffect(() => {
    async function initialize() {
      setInstallPlatform(typeof chrome !== "undefined" && chrome.runtime?.getPlatformInfo
        ? ((os) => (os === "win" ? "win" : os === "mac" ? "mac" : "other"))((await chrome.runtime.getPlatformInfo()).os)
        : /win/i.test(navigator.userAgent) ? "win" : /mac/i.test(navigator.userAgent) ? "mac" : "other");
      let loaded: PinarSettings = DEFAULT_SETTINGS;
      if (typeof chrome !== "undefined" && chrome.storage?.sync) {
        const items = await chrome.storage.sync.get(DEFAULT_SETTINGS);
        const cloudUrl = resolveCloudUrl(chrome.runtime.getManifest(), items.cloudUrl);
        loaded = {
          cloudUrl,
          copyOnFinishBatch: items.copyOnFinishBatch === "off" || items.copyOnFinishBatch === "link" ? items.copyOnFinishBatch : "prompt",
          copyViewerContent: Boolean(items.copyViewerContent),
          enableHistory: Boolean(items.enableHistory),
          handoffMode: items.handoffMode === "full" ? "full" : "compact",
          includeScreenshot: items.includeScreenshot !== false,
          includeViewer: Boolean(items.includeViewer),
          language: getBestLanguage(items.language || DEFAULT_LANGUAGE, []),
          loopMetricsOptIn: items.loopMetricsOptIn === true,
          sensitiveQueryKeys: typeof items.sensitiveQueryKeys === "string" ? items.sensitiveQueryKeys : "",
          storageMode: items.storageMode === "cloud" ? "cloud" : "local",
          theme: items.theme === "dark" || items.theme === "light" ? items.theme : "system",
          voicePostProcessing: items.voicePostProcessing === true,
        };
        if (cloudUrl !== items.cloudUrl) await chrome.storage.sync.set({ cloudUrl });
      }
      loaded = await syncDeliveryPreferences(loaded);
      applyTheme(loaded.theme || "system");
      setLang(loaded.language as SupportedLanguage);
      setSettings(loaded);
      setSavedSettings(loaded);
      await loadAuthSession();
    }
    void initialize();
  }, []);

  async function saveSettings() {
    if (!hasUnsavedChanges || settingsSaving) return;
    setSettingsSaving(true);
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.sync) await chrome.storage.sync.set(settings);
      const prefs = await extensionMessage({
        copyOnFinishBatch: settings.copyOnFinishBatch,
        copyViewerContent: settings.copyViewerContent,
        handoffMode: settings.handoffMode,
        includeScreenshot: settings.includeScreenshot,
        includeViewer: settings.includeViewer,
        language: settings.language,
        sensitiveQueryKeys: settings.sensitiveQueryKeys,
        voicePostProcessing: settings.storageMode === "cloud" && settings.voicePostProcessing,
        type: "preferences:set",
      }, "");
      const saved = prefs.ok && typeof prefs.includeScreenshot === "boolean"
        ? applyDeliveryResponse(settings, prefs)
        : settings;
      if (!areSettingsEqual(saved, settings) && typeof chrome !== "undefined" && chrome.storage?.sync) {
        await chrome.storage.sync.set({
          copyOnFinishBatch: saved.copyOnFinishBatch,
          copyViewerContent: saved.copyViewerContent,
          handoffMode: saved.handoffMode,
          includeScreenshot: saved.includeScreenshot,
          includeViewer: saved.includeViewer,
          language: saved.language,
          sensitiveQueryKeys: saved.sensitiveQueryKeys,
          voicePostProcessing: saved.voicePostProcessing,
        });
      }
      setSettings(saved);
      setSavedSettings(saved);
      toast.success(t.status_saved);
      await loadAuthSession();
    } finally {
      setSettingsSaving(false);
    }
  }

  async function openApp() {
    setAuthError("");
    const response = await extensionMessage({ type: "app:open" }, t.account_unavailable);
    if (!response.ok) setAuthError(response.error || t.account_unavailable);
  }

  async function requestEmailCode(event: FormEvent) {
    event.preventDefault();
    setEmailCodeRequestLoading(true);
    setAuthError("");
    try {
      const response = await extensionMessage(
        { email, type: "auth:email-code:request" },
        t.account_unavailable,
      );
      if (!response.ok) throw new Error(response.error || t.account_unavailable);
      setEmailCodeRequested(true);
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setEmailCodeRequestLoading(false);
    }
  }

  async function verifyEmailCode(event: FormEvent) {
    event.preventDefault();
    setEmailCodeVerificationLoading(true);
    setAuthError("");
    try {
      const response = await extensionMessage(
        { code: emailCode, email, type: "auth:email-code:verify" },
        t.account_code_invalid,
      );
      if (!response.ok || !response.session) {
        if (response.code === "account_registration_required") throw new Error(t.account_registration_required);
        if (response.code === "legal_acceptance_required") throw new Error(t.account_legal_update_required);
        throw new Error(response.error || t.account_code_invalid);
      }
      setAuthSession(response.session);
      setEmailCode("");
      setEmailCodeRequested(false);
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setEmailCodeVerificationLoading(false);
    }
  }

  async function logout() {
    setLogoutLoading(true);
    setAuthError("");
    try {
      const response = await extensionMessage({ type: "auth:logout" }, t.account_unavailable);
      if (!response.ok) throw new Error(response.error || t.account_unavailable);
      setAuthSession(null);
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLogoutLoading(false);
    }
  }

  return (
    <div className="h-screen w-full overflow-hidden bg-muted/50 font-sans text-foreground dark:bg-background">
      <ScrollArea className="h-full w-full">
        <div className="flex min-h-full items-center justify-center p-4">
          <div className="relative flex w-full max-w-[640px] flex-col gap-5 rounded-2xl border border-border bg-card p-6">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <PinarMark />
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
                    {t.header_title}
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                      v{extensionVersion()}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{t.header_desc}</div>
                </div>
              </div>
              <Button render={<a href="https://github.com/djalmajr/pinar" rel="noopener noreferrer" target="_blank" />} size="icon" title="GitHub" variant="outline">
                <IconGithub className="size-4" />
              </Button>
            </header>

            <Tabs className="gap-4" defaultValue="preferences">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="preferences">{t.tab_preferences}</TabsTrigger>
                <TabsTrigger value="capture">{t.tab_capture}</TabsTrigger>
                <TabsTrigger value="shortcuts">{t.tab_shortcuts}</TabsTrigger>
              </TabsList>

              <TabsContent className="flex flex-col gap-5" value="preferences">
                <section className="flex flex-col">
                  <span className={SECTION_HEADER}>{t.storage_title}</span>
                  <p className={SECTION_DESC}>{t.storage_title_desc}</p>
                  <div className="flex flex-col gap-2">
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 hover:bg-muted/50">
                      <input checked={settings.storageMode === "local"} className="mt-0.5 accent-primary" name="storageMode" type="radio" onChange={() => setSettings((current) => ({ ...current, storageMode: "local" }))} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold">{t.local_title}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{localStorageDescription}</span>
                        {installPlatform === "other" ? (
                          <span className="mt-2 flex items-center gap-1.5 rounded-lg border bg-muted/60 p-1.5 font-mono text-[11px]">
                            <ScrollArea className="min-w-0 flex-1"><code className="block whitespace-nowrap px-1 text-muted-foreground">{installCommand}</code><ScrollBar orientation="horizontal" /></ScrollArea>
                            <button className="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground" title={t.btn_copy} type="button" onClick={async (event) => { event.preventDefault(); await navigator.clipboard.writeText(installCommand); setCopiedInstall(true); window.setTimeout(() => setCopiedInstall(false), 2_000); }}>
                              {copiedInstall ? <IconCheck className="size-3.5 text-emerald-500" /> : <IconCopy className="size-3.5" />}
                            </button>
                          </span>
                        ) : null}
                      </span>
                      {installPlatform === "other" ? null : <Button className="h-7 shrink-0 self-center text-xs" render={<a href={desktopInstallUrl} rel="noopener noreferrer" target="_blank" />} size="sm" variant="outline" onClick={(event) => event.stopPropagation()}>{t.btn_download_macos}<IconExternalLink data-icon="inline-end" /></Button>}
                    </label>
                    <div className="overflow-hidden rounded-lg border">
                      <label className="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-muted/50">
                        <input checked={settings.storageMode === "cloud"} className="mt-0.5 accent-primary" name="storageMode" type="radio" onChange={() => setSettings((current) => ({ ...current, storageMode: "cloud" }))} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-xs font-semibold">
                            {environment === "staging" ? t.staging_title : t.remote_title}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">{environment === "staging" ? t.staging_desc : t.remote_desc}</span>
                        </span>
                        <Button className="h-7 shrink-0 self-center text-xs" render={<a href={hostedSignInUrl(settings.cloudUrl, lang)} rel="noopener noreferrer" target="_blank" />} size="sm" variant="outline" onClick={(event) => event.stopPropagation()}>{t.account_create_on_web}<IconExternalLink data-icon="inline-end" /></Button>
                      </label>
                      {settings.storageMode === "cloud" ? (
                        <div className="flex flex-col gap-4 border-t p-3">
                          <SettingRow size="xs" description={t.history_desc} title={t.history_label}>
                            <Switch aria-label={t.history_label} checked={settings.enableHistory} onCheckedChange={(value) => setSettings((current) => ({ ...current, enableHistory: value }))} />
                          </SettingRow>
                    {!authReady ? <p className="text-xs text-muted-foreground">…</p> : authSession?.kind === "account" ? (
                      <section className="flex flex-col">
                        <span className={SECTION_HEADER}>{t.account_title}</span>
                        <p className={SECTION_DESC}>{t.account_title_desc}</p>
                        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold">{authSession.email}</p>
                            <p className="mt-1 text-xs capitalize text-muted-foreground">{authSession.plan}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Button disabled={logoutLoading} size="sm" type="button" variant="outline" onClick={() => void logout()}>
                              <IconLogOut data-icon="inline-start" />
                              {t.btn_sign_out}
                            </Button>
                          </div>
                        </div>
                      </section>
                    ) : (
                        <section className="flex flex-col gap-0.5">
                          {!emailCodeRequested ? (
                            <>
                              <label className="text-xs font-semibold" htmlFor="account-email">{t.account_email_title}</label>
                              <form className="flex flex-wrap gap-2" onSubmit={requestEmailCode}>
                                <Input autoComplete="email" className="h-8 min-w-[11rem] flex-1 text-xs" id="account-email" placeholder="you@example.com" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
                                <Button aria-busy={emailCodeRequestLoading || undefined} className="h-8 shrink-0 text-xs" disabled={emailCodeRequestLoading} size="sm" type="submit" variant="outline">{emailCodeRequestLoading ? <IconLoaderCircle className="animate-spin" data-icon="inline-start" /> : <IconMail data-icon="inline-start" />}{t.btn_send_code}</Button>
                              </form>
                            </>
                          ) : (
                            <>
                              <p className="text-xs text-muted-foreground">{t.account_email_sent}</p>
                              <form className="space-y-2" onSubmit={verifyEmailCode}>
                                <label className="block text-xs font-semibold" htmlFor="account-email-code">{t.account_email_code_label}</label>
                                <div className="flex gap-2">
                                  <Input autoComplete="one-time-code" className="h-8 text-xs" id="account-email-code" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" placeholder="000000" required value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, ""))} />
                                  <Button className="h-8 shrink-0 text-xs" disabled={emailCodeVerificationLoading} size="sm" type="button" variant="outline" onClick={() => { setEmailCode(""); setEmailCodeRequested(false); }}>{t.btn_cancel}</Button>
                                  <Button aria-busy={emailCodeVerificationLoading || undefined} className="h-8 shrink-0 text-xs" disabled={emailCodeVerificationLoading || emailCode.length !== 6} size="sm" type="submit">{emailCodeVerificationLoading ? <IconLoaderCircle className="animate-spin" data-icon="inline-start" /> : <IconCheck data-icon="inline-start" />}{t.btn_verify_code}</Button>
                                </div>
                              </form>
                            </>
                          )}
                        </section>
                    )}
                          {authError && <p className="text-xs font-medium text-destructive" role="alert">{authError}</p>}
                          {voiceAvailable ? <>
                            <Separator />
                            <section className="flex flex-col">
                              <span className={SECTION_HEADER}>{t.voice_settings_title}</span>
                              <p className={SECTION_DESC}>{t.voice_settings_desc}</p>
                              <SettingRow size="xs" description={t.voice_post_processing_desc} title={t.voice_post_processing_label}>
                                <Switch
                                  aria-label={t.voice_post_processing_label}
                                  checked={settings.voicePostProcessing}
                                  onCheckedChange={(value) => setSettings((current) => ({ ...current, voicePostProcessing: value }))}
                                />
                              </SettingRow>
                            </section>
                          </> : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </section>
                <Separator />
                <section className="flex flex-col">
                  <span className={SECTION_HEADER}>{t.section_interface}</span>
                  <p className={SECTION_DESC}>{t.section_interface_desc}</p>
                  <div className="flex flex-col gap-3">
                  <SettingRow size="xs" description={t.language_desc} title={t.language_label}>
                    <Select items={LANGUAGE_OPTIONS.map((option) => ({ label: option.label, value: option.code }))} value={lang} onValueChange={(value) => { const next = value as SupportedLanguage; setLang(next); setSettings((current) => ({ ...current, language: next })); }}><SelectTrigger aria-label={t.language_label}><SelectValue /></SelectTrigger><SelectContent align="end" alignItemWithTrigger={false} className="w-max min-w-min"><SelectGroup>{LANGUAGE_OPTIONS.map((option) => <SelectItem key={option.code} value={option.code}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select>
                  </SettingRow>
                  <SettingRow size="xs" description={t.theme_desc} title={t.theme_label}>
                    <Tabs value={settings.theme || "system"} onValueChange={(value) => { const theme = value as ThemeMode; applyTheme(theme); setSettings((current) => ({ ...current, theme })); }}><TabsList aria-label={t.theme_label} variant="segmented"><TabsTrigger aria-label={t.theme_system} title={t.theme_system} value="system"><IconLaptop /></TabsTrigger><TabsTrigger aria-label={t.theme_light} title={t.theme_light} value="light"><IconSun className="text-amber-500" /></TabsTrigger><TabsTrigger aria-label={t.theme_dark} title={t.theme_dark} value="dark"><IconMoon className="text-blue-500" /></TabsTrigger></TabsList></Tabs>
                  </SettingRow>
                  </div>
                </section>
              </TabsContent>

              <TabsContent className="flex flex-col gap-5" value="capture">
                <section className="flex flex-col">
                  <span className={SECTION_HEADER}>{t.section_handoff}</span>
                  <p className={SECTION_DESC}>{t.section_handoff_desc}</p>
                  <div className="flex flex-col gap-3">
                  <SettingRow size="xs" description={t.handoff_mode_desc} title={`${t.handoff_mode_label}: ${settings.handoffMode === "full" ? t.handoff_mode_full : t.handoff_mode_compact}`}>
                    <Switch aria-label={t.handoff_mode_label} checked={settings.handoffMode === "full"} onCheckedChange={(checked) => setSettings((current) => ({ ...current, handoffMode: checked ? "full" : "compact" }))} />
                  </SettingRow>
                  <SettingRow size="xs" description={t.viewer_desc} title={t.viewer_label}>
                    <Switch aria-label={t.viewer_label} checked={settings.includeViewer} onCheckedChange={(value) => setSettings((current) => ({ ...current, includeViewer: value }))} />
                  </SettingRow>
                  <SettingRow size="xs" description={t.viewer_content_desc} title={t.viewer_content_label}>
                    <Switch aria-label={t.viewer_content_label} checked={settings.copyViewerContent} disabled={!settings.includeViewer} onCheckedChange={(value) => setSettings((current) => ({ ...current, copyViewerContent: value }))} />
                  </SettingRow>
                  <SettingRow size="xs" description={t.screenshot_desc} title={t.screenshot_label}>
                    <Switch aria-label={t.screenshot_label} checked={settings.includeScreenshot} onCheckedChange={(value) => setSettings((current) => ({ ...current, includeScreenshot: value }))} />
                  </SettingRow>
                  </div>
                </section>
                <Separator />
                <section className="flex flex-col">
                  <span className={SECTION_HEADER}>{t.section_privacy}</span>
                  <p className={SECTION_DESC}>{t.section_privacy_desc}</p>
                  <div className="flex flex-col gap-3">
                  <SettingRow size="xs" description={t.loop_metrics_desc} title={t.loop_metrics_label}>
                    <Switch aria-label={t.loop_metrics_label} checked={settings.loopMetricsOptIn === true} onCheckedChange={(value) => setSettings((current) => ({ ...current, loopMetricsOptIn: value }))} />
                  </SettingRow>
                  <SettingRow layout="stack" size="xs" description={t.privacy_query_keys_desc} title={t.privacy_query_keys_label}>
                    <Input aria-label={t.privacy_query_keys_label} value={settings.sensitiveQueryKeys || ""} onChange={(event) => setSettings((current) => ({ ...current, sensitiveQueryKeys: event.target.value }))} />
                  </SettingRow>
                  </div>
                </section>

              </TabsContent>

              <TabsContent value="shortcuts">
                <ShortcutsTab platform={installPlatform} t={t} />
              </TabsContent>
            </Tabs>

            <footer className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2"><Button aria-busy={settingsSaving || undefined} className="h-8 text-xs" disabled={settingsSaving || !hasUnsavedChanges} size="sm" onClick={() => void saveSettings()}>{settingsSaving ? <IconLoaderCircle className="size-3.5 animate-spin" /> : <IconSave className="size-3.5" />}{t.btn_save}</Button><Button className="h-8 text-xs" size="sm" variant="outline" onClick={() => void openApp()}>{t.btn_open_app}<IconExternalLink data-icon="inline-end" /></Button></div>
              <div className="flex gap-2"><Button className="h-8 text-xs" render={<a href="https://buymeacoffee.com/djalmajr" rel="noopener noreferrer" target="_blank" />} size="sm" variant="coffee"><IconCoffee />{t.btn_coffee}</Button><Button className="h-8 text-xs" render={<a href="https://github.com/sponsors/djalmajr" rel="noopener noreferrer" target="_blank" />} size="sm" variant="sponsor"><IconHeart className="fill-current" />{t.btn_sponsor}</Button></div>
            </footer>
          </div>
        </div>
      </ScrollArea>
      <Toaster theme={settings.theme} />
    </div>
  );
}
