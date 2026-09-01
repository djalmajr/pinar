import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  type AuthSession,
  type CaptureDestination,
  type CopyOnFinishBatch,
  getBestLanguage,
  type HandoffMode,
  macosDesktopDmgUrl,
  type PinarSettings,
  type ProjectTree,
  type ProjectTreeCollection,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
  type ThemeMode,
  type TranslationDictionary,
  translations,
} from "@pinar/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
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
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toaster,
  toast,
  cn,
} from "@pinar/ui";
import IconCheck from "~icons/lucide/check";
import IconCoffee from "~icons/lucide/coffee";
import IconCopy from "~icons/lucide/copy";
import IconExternalLink from "~icons/lucide/external-link";
import IconFolder from "~icons/lucide/folder";
import IconGithub from "~icons/radix-icons/github-logo";
import IconHeart from "~icons/lucide/heart";
import IconInbox from "~icons/lucide/inbox";
import IconInfo from "~icons/lucide/info";
import IconKeyRound from "~icons/lucide/key-round";
import IconLaptop from "~icons/lucide/laptop";
import IconLogOut from "~icons/lucide/log-out";
import IconMail from "~icons/lucide/mail";
import IconMoon from "~icons/lucide/moon";
import IconSave from "~icons/lucide/save";
import IconSparkles from "~icons/lucide/sparkles";
import IconSun from "~icons/lucide/sun";
import extensionPackage from "../../package.json";
import {
  acceptedRemoteLegalAcceptance,
  createRemoteLegalAcceptance,
  parseLegalBundle,
  type LegalBundle,
} from "../../../../extension/legal-consent.js";
import {
  type ExtensionResponseBase,
  withExtensionResponseFallback,
} from "./extension-response";

const LANGUAGE_OPTIONS = SUPPORTED_LANGUAGES.map((code) => ({ code, label: translations[code].name }));

const SECTION_HEADER = "text-[11px] font-semibold uppercase tracking-wider";

const OVERLAY_SHORTCUTS = [
  { keys: "Enter", label: "shortcut_pin_element" },
  { keys: "↑ / ↓", label: "shortcut_walk_dom" },
  { keys: "M", label: "shortcut_mask" },
  { keys: "Esc", label: "shortcut_cancel" },
  { keys: "⌘/Ctrl + Enter", label: "shortcut_copy" },
] as const satisfies ReadonlyArray<{ keys: string; label: keyof TranslationDictionary }>;

function ShortcutRow({ editLabel, keys, label, onEdit }: { editLabel?: string; keys: string; label: string; onEdit?: () => void }) {
  const chip = <kbd className="block rounded border bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors group-hover/shortcut:border-primary group-hover/shortcut:text-foreground">{keys}</kbd>;
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
      <span className="min-w-0 text-xs">{label}</span>
      {onEdit ? (
        <button aria-label={editLabel} className="group/shortcut shrink-0 cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/30" title={editLabel} type="button" onClick={onEdit}>{chip}</button>
      ) : (
        <span className="shrink-0">{chip}</span>
      )}
    </li>
  );
}

const COMMAND_LABELS = {
  _execute_action: "shortcuts_toggle_label",
  "finish-batch": "shortcuts_finish_batch_label",
  "open-panel": "shortcuts_open_panel_label",
} as const satisfies Record<string, keyof TranslationDictionary>;

function commandLabel(command: chrome.commands.Command, t: TranslationDictionary) {
  const key = COMMAND_LABELS[command.name as keyof typeof COMMAND_LABELS];
  // Chrome only knows the English manifest description; our own UI must not.
  return key ? t[key] : command.description || command.name || "";
}

function ShortcutsTab({ t }: { t: TranslationDictionary }) {
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
      <section className="flex flex-col gap-2.5">
        <span className={SECTION_HEADER}>{t.shortcuts_browser_title}</span>
        <p className="text-xs leading-relaxed text-muted-foreground">{t.shortcuts_browser_desc}</p>
        <ul className="flex flex-col gap-1.5">
          {commands.map((command) => (
            <ShortcutRow editLabel={t.shortcuts_customize} key={command.name} keys={command.shortcut || t.shortcuts_unassigned} label={commandLabel(command, t)} onEdit={() => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" })} />
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2.5">
        <span className={SECTION_HEADER}>{t.shortcuts_overlay_title}</span>
        <p className="text-xs leading-relaxed text-muted-foreground">{t.shortcuts_overlay_desc}</p>
        <ul className="flex flex-col gap-1.5">
          {OVERLAY_SHORTCUTS.map((item) => <ShortcutRow key={item.keys} keys={item.keys} label={t[item.label]} />)}
        </ul>
      </section>
    </div>
  );
}

function formatBytes(value: number, locale: string) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = value > 0 ? Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1) : 0;
  const scaled = value / 1024 ** index;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: index > 0 && scaled < 10 ? 1 : 0 }).format(scaled)} ${units[index]}`;
}

function StorageStatusPanel({ mode, t }: { mode: PinarSettings["storageMode"]; t: TranslationDictionary }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    setChecking(true);
    const response = await extensionMessage({ type: "storage:status" }, t.account_unavailable);
    setStatus(response.ok ? (response as unknown as Record<string, unknown>) : null);
    setChecking(false);
  }, [t.account_unavailable]);

  useEffect(() => { void refresh(); }, [mode, refresh]);

  if (mode === "cloud") {
    const used = Number(status?.usedBytes ?? 0);
    const quota = Number(status?.quotaBytes ?? 0);
    const paused = status ? status.uploadAllowed === false : false;
    return (
      <div className="flex flex-col gap-2 py-1">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-xs font-semibold">{quota > 0 ? t.storage_cloud_usage.replace("{used}", formatBytes(used, "en")).replace("{quota}", formatBytes(quota, "en")) : "—"}</span>
            <span className={cn("block text-xs", paused ? "text-destructive" : "text-muted-foreground")}>{paused ? t.storage_cloud_paused : t.storage_status_desc}</span>
          </span>
          <Button className="h-7 shrink-0 text-xs" disabled={checking} size="sm" variant="outline" onClick={() => void refresh()}>{t.storage_recheck}</Button>
        </div>
        {quota > 0 ? <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", paused ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.min(100, Math.round((used / quota) * 100))}%` }} /></div> : null}
      </div>
    );
  }

  const reachable = status?.reachable === true;
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="min-w-0">
        <span className={cn("block text-xs font-semibold", reachable ? "text-foreground" : "text-destructive")}>
          {reachable ? t.storage_local_connected.replace("{port}", String(status?.port ?? "")) : t.storage_local_missing}
        </span>
        <span className="block text-xs text-muted-foreground">{t.storage_status_desc}</span>
      </span>
      <Button className="h-7 shrink-0 text-xs" disabled={checking} size="sm" variant="outline" onClick={() => void refresh()}>{t.storage_recheck}</Button>
    </div>
  );
}

const DEFAULT_LANGUAGE: SupportedLanguage = "en";
const DEFAULT_PROJECT_OPTION = { label: "Personal", value: "__pinar_default_project__" };
const DEFAULT_COLLECTION_OPTION = { label: "Inbox", value: "__pinar_default_collection__" };
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
};

interface ExtensionResponse extends ExtensionResponseBase {
  code?: string;
  destination?: CaptureDestination;
  error?: string;
  expiresAt?: string;
  handoffMode?: HandoffMode;
  includeScreenshot?: boolean;
  ok?: boolean;
  session?: AuthSession;
  tree?: ProjectTree;
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

function hostedPricingUrl(cloudUrl: string, language: SupportedLanguage) {
  const url = new URL(`${(cloudUrl || "https://pinar.dev").replace(/\/+$/, "")}/pricing`);
  if (language) url.searchParams.set("lang", language);
  return url.toString();
}

function hostedSignInUrl(cloudUrl: string, language: SupportedLanguage) {
  const url = new URL(`${(cloudUrl || "https://pinar.dev").replace(/\/+$/, "")}/sign-in`);
  url.searchParams.set("extensionCode", "");
  url.searchParams.set("returnTo", "/app");
  if (language) url.searchParams.set("lang", language);
  return url.toString();
}

function accountSessionError(message: string, unavailable: string, legalRequired: string) {
  if (/Accept the current Pinar Terms/i.test(message)) return legalRequired;
  return message || unavailable;
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

function flattenDestinationCollections(collections: ProjectTreeCollection[]) {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const children = new Map<string | null, ProjectTreeCollection[]>();
  for (const collection of collections) {
    const parentId = collection.parentId && byId.has(collection.parentId) ? collection.parentId : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(collection);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((left, right) => left.position - right.position);
  const result: Array<{ collection: ProjectTreeCollection; depth: number }> = [];
  const visited = new Set<string>();
  function visit(parentId: string | null, depth: number) {
    for (const collection of children.get(parentId) ?? []) {
      if (visited.has(collection.id)) continue;
      visited.add(collection.id);
      result.push({ collection, depth });
      visit(collection.id, depth + 1);
    }
  }
  visit(null, 0);
  for (const collection of collections) {
    if (!visited.has(collection.id)) result.push({ collection, depth: 0 });
  }
  return result;
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
  const [lang, setLang] = useState<SupportedLanguage>(DEFAULT_LANGUAGE);
  const [installPlatform, setInstallPlatform] = useState<"mac" | "win" | "other">("mac");
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [captureDestination, setCaptureDestination] = useState<CaptureDestination | null>(null);
  const [destinationTree, setDestinationTree] = useState<ProjectTree | null>(null);
  const [destinationProjectId, setDestinationProjectId] = useState("");
  const [destinationLoading, setDestinationLoading] = useState(true);
  const [destinationError, setDestinationError] = useState("");
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [temporaryCode, setTemporaryCode] = useState("");
  const [temporaryCodeExpiresAt, setTemporaryCodeExpiresAt] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [regenerateCodeOpen, setRegenerateCodeOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailCodeRequested, setEmailCodeRequested] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [legalBundle, setLegalBundle] = useState<LegalBundle | null>(null);
  const [legalError, setLegalError] = useState(false);
  const [savedLegalAccepted, setSavedLegalAccepted] = useState(false);

  const t = translations[lang] || translations.en;
  const hasUnsavedChanges = !areSettingsEqual(settings, savedSettings)
    || legalAccepted !== savedLegalAccepted;
  const destinationProjects = destinationTree?.projects ?? [];
  const destinationProject = destinationProjects.find((project) => project.id === destinationProjectId);
  const destinationCollections = destinationProject?.collections ?? [];
  const destinationCollectionTree = flattenDestinationCollections(destinationCollections);
  const destinationProjectIds = destinationProjects.length
    ? destinationProjects.map((project) => project.id)
    : [DEFAULT_PROJECT_OPTION.value];
  const destinationCollectionIds = destinationCollections.length
    ? destinationCollections.map((collection) => collection.id)
    : [DEFAULT_COLLECTION_OPTION.value];
  const selectedDestinationCollectionId = captureDestination?.projectId === destinationProjectId
    ? captureDestination.collectionId
    : DEFAULT_COLLECTION_OPTION.value;
  const installCommand = installPlatform === "win"
    ? "irm https://pinar.dev/install.ps1 | iex"
    : "curl -fsSL https://pinar.dev/install.sh | sh";

  async function loadLegalConsent(cloudUrl: string) {
    setLegalError(false);
    try {
      const [response, stored] = await Promise.all([
        fetch(`${cloudUrl.replace(/\/+$/, "")}/api/legal/current`),
        typeof chrome !== "undefined" && chrome.storage?.local
          ? chrome.storage.local.get({ remoteLegalAcceptance: null })
          : Promise.resolve({ remoteLegalAcceptance: null }),
      ]);
      const bundle = parseLegalBundle(await response.json().catch(() => null));
      if (!response.ok || !bundle) throw new Error("Legal bundle unavailable");
      const accepted = Boolean(acceptedRemoteLegalAcceptance(stored.remoteLegalAcceptance, bundle));
      setLegalAccepted(accepted);
      setLegalBundle(bundle);
      setSavedLegalAccepted(accepted);
    } catch {
      setLegalAccepted(false);
      setLegalBundle(null);
      setLegalError(true);
      setSavedLegalAccepted(false);
    }
  }

  async function syncDeliveryPreferences(current: PinarSettings): Promise<PinarSettings> {
    const response = await extensionMessage({ type: "preferences:get" }, "");
    if (!response.ok || typeof response.includeScreenshot !== "boolean") return current;
    const handoffMode: HandoffMode = response.handoffMode === "full" ? "full" : "compact";
    if (response.includeScreenshot === current.includeScreenshot && handoffMode === current.handoffMode) return current;
    const next = { ...current, handoffMode, includeScreenshot: response.includeScreenshot };
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      await chrome.storage.sync.set({ handoffMode, includeScreenshot: response.includeScreenshot });
    }
    return next;
  }

  async function loadCaptureDestination() {
    setDestinationLoading(true);
    setDestinationError("");
    try {
      const response = await extensionMessage({ type: "destination:get" }, t.destination_unavailable);
      if (!response.ok || !response.destination || !response.tree) {
        throw new Error(response.error || t.destination_unavailable);
      }
      setCaptureDestination(response.destination);
      setDestinationProjectId(response.destination.projectId);
      setDestinationTree(response.tree);
    } catch {
      setCaptureDestination(null);
      setDestinationProjectId("");
      setDestinationTree(null);
      setDestinationError(t.destination_unavailable);
    } finally {
      setDestinationLoading(false);
    }
  }

  async function loadAuthSession() {
    setAuthLoading(true);
    setAuthError("");
    try {
      const response = await extensionMessage({ type: "auth:get" }, t.account_unavailable);
      if (!response.ok || !response.session) throw new Error(response.error || t.account_unavailable);
      setAuthSession(response.session);
    } catch (cause) {
      setAuthSession(null);
      setAuthError(accountSessionError(
        cause instanceof Error ? cause.message : t.account_unavailable,
        t.account_unavailable,
        t.legal_acceptance_required,
      ));
    } finally {
      setAuthLoading(false);
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
        const cloudUrl = !items.cloudUrl || items.cloudUrl.includes("workers.dev") || items.cloudUrl.includes("djalmajr.dev")
          ? "https://pinar.dev"
          : items.cloudUrl;
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
        };
        if (cloudUrl !== items.cloudUrl) await chrome.storage.sync.set({ cloudUrl });
      }
      loaded = await syncDeliveryPreferences(loaded);
      applyTheme(loaded.theme || "system");
      setLang(loaded.language as SupportedLanguage);
      setSettings(loaded);
      setSavedSettings(loaded);
      await loadLegalConsent(loaded.cloudUrl || DEFAULT_SETTINGS.cloudUrl);
      await Promise.all([loadCaptureDestination(), loadAuthSession()]);
    }
    void initialize();
  }, []);

  async function saveSettings() {
    if (!hasUnsavedChanges) return;
    if (settings.storageMode === "cloud" && (!legalBundle || !legalAccepted)) {
      toast.error(t.legal_acceptance_required);
      return;
    }
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      if (legalAccepted && legalBundle && !savedLegalAccepted) {
        const acceptance = createRemoteLegalAcceptance(legalBundle, settings.language || lang);
        if (acceptance) await chrome.storage.local.set({ remoteLegalAcceptance: acceptance });
      } else if (!legalAccepted && savedLegalAccepted) {
        await chrome.storage.local.remove("remoteLegalAcceptance");
      }
    }
    if (typeof chrome !== "undefined" && chrome.storage?.sync) await chrome.storage.sync.set(settings);
    const prefs = await extensionMessage(
      { handoffMode: settings.handoffMode, includeScreenshot: settings.includeScreenshot, type: "preferences:set" },
      "",
    );
    const saved = prefs.ok && typeof prefs.includeScreenshot === "boolean"
      ? {
          ...settings,
          handoffMode: prefs.handoffMode === "full" ? "full" as const : "compact" as const,
          includeScreenshot: prefs.includeScreenshot,
        }
      : settings;
    if ((saved.includeScreenshot !== settings.includeScreenshot || saved.handoffMode !== settings.handoffMode)
      && typeof chrome !== "undefined" && chrome.storage?.sync) {
      await chrome.storage.sync.set({ handoffMode: saved.handoffMode, includeScreenshot: saved.includeScreenshot });
    }
    setSavedLegalAccepted(legalAccepted);
    setSettings(saved);
    setSavedSettings(saved);
    toast.success(t.status_saved);
    await Promise.all([loadCaptureDestination(), loadAuthSession()]);
  }

  async function saveCaptureDestination(collectionId: string) {
    setDestinationLoading(true);
    setDestinationError("");
    try {
      const response = await extensionMessage(
        { collectionId, type: "destination:set" },
        t.destination_unavailable,
      );
      if (!response.ok || !response.destination || !response.tree) {
        throw new Error(response.error || t.destination_unavailable);
      }
      setCaptureDestination(response.destination);
      setDestinationProjectId(response.destination.projectId);
      setDestinationTree(response.tree);
      toast.success(t.status_saved);
    } catch {
      setDestinationError(t.destination_unavailable);
      toast.error(t.destination_unavailable);
      await loadCaptureDestination();
    } finally {
      setDestinationLoading(false);
    }
  }

  function changeDestinationProject(projectId: string) {
    const project = destinationProjects.find((item) => item.id === projectId);
    const collection = project?.collections.find((item) => item.isProtected) ?? project?.collections[0];
    if (!collection) return;
    setDestinationProjectId(projectId);
    void saveCaptureDestination(collection.id);
  }

  async function openApp() {
    setAuthError("");
    const response = await extensionMessage({ type: "app:open" }, t.account_unavailable);
    if (!response.ok) setAuthError(response.error || t.account_unavailable);
  }

  async function generateTemporaryCode() {
    setAuthLoading(true);
    setAuthError("");
    try {
      const response = await extensionMessage({ type: "auth:extension-code" }, t.account_unavailable);
      if (!response.ok || !response.code) throw new Error(response.error || t.account_unavailable);
      setTemporaryCode(response.code);
      setTemporaryCodeExpiresAt(response.expiresAt || "");
      setCopiedCode(false);
      return true;
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setAuthLoading(false);
    }
  }

  async function copyTemporaryCode() {
    if (!temporaryCode) return;
    setAuthError("");
    try {
      await navigator.clipboard.writeText(temporaryCode);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 2_000);
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function regenerateTemporaryCode() {
    if (await generateTemporaryCode()) setRegenerateCodeOpen(false);
  }

  async function requestEmailCode(event: FormEvent) {
    event.preventDefault();
    setAuthLoading(true);
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
      setAuthLoading(false);
    }
  }

  async function verifyEmailCode(event: FormEvent) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      const response = await extensionMessage(
        { code: emailCode, email, type: "auth:email-code:verify" },
        t.account_code_invalid,
      );
      if (!response.ok || !response.session) throw new Error(response.error || t.account_code_invalid);
      setAuthSession(response.session);
      setEmailCode("");
      setEmailCodeRequested(false);
      await loadCaptureDestination();
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    setAuthLoading(true);
    setAuthError("");
    try {
      const response = await extensionMessage({ type: "auth:logout" }, t.account_unavailable);
      if (!response.ok || !response.session) throw new Error(response.error || t.account_unavailable);
      setAuthSession(response.session);
      setTemporaryCode("");
      await loadCaptureDestination();
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAuthLoading(false);
    }
  }

  async function openBilling() {
    const response = await extensionMessage({ type: "auth:billing" }, t.account_unavailable);
    if (!response.ok) setAuthError(response.error || t.account_unavailable);
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

            <Tabs className="gap-4" defaultValue="storage">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="storage">{t.tab_storage}</TabsTrigger>
                <TabsTrigger value="preferences">{t.tab_preferences}</TabsTrigger>
                <TabsTrigger value="shortcuts">{t.tab_shortcuts}</TabsTrigger>
                <TabsTrigger value="account">{t.tab_account}</TabsTrigger>
              </TabsList>

              <TabsContent className="flex flex-col gap-5" value="storage">
                <section className="flex flex-col gap-2.5">
                  <span className={SECTION_HEADER}>{t.storage_title}</span>
                  <label className="-mx-2 flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 hover:bg-muted/50">
                    <input checked={settings.storageMode === "local"} className="mt-0.5 accent-primary" name="storageMode" type="radio" onChange={() => setSettings((current) => ({ ...current, storageMode: "local" }))} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold">{t.local_title}</span>
                      <span className="block text-xs text-muted-foreground">{t.local_desc}</span>
                      {installPlatform === "mac" ? null : (
                        <span className="mt-2 flex items-center gap-1.5 rounded-lg border bg-muted/60 p-1.5 font-mono text-[11px]">
                          <ScrollArea className="min-w-0 flex-1"><code className="block whitespace-nowrap px-1 text-muted-foreground">{installCommand}</code><ScrollBar orientation="horizontal" /></ScrollArea>
                          <button className="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground" title={t.btn_copy} type="button" onClick={async (event) => { event.preventDefault(); await navigator.clipboard.writeText(installCommand); setCopiedInstall(true); window.setTimeout(() => setCopiedInstall(false), 2_000); }}>
                            {copiedInstall ? <IconCheck className="size-3.5 text-emerald-500" /> : <IconCopy className="size-3.5" />}
                          </button>
                        </span>
                      )}
                    </span>
                    {installPlatform === "mac" ? <Button className="h-7 shrink-0 self-center text-xs" render={<a href={macosDesktopDmgUrl()} rel="noopener noreferrer" target="_blank" />} size="sm" variant="outline" onClick={(event) => event.stopPropagation()}>{t.btn_download_macos}<IconExternalLink data-icon="inline-end" /></Button> : null}
                  </label>
                  <label className="-mx-2 flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 hover:bg-muted/50">
                    <input checked={settings.storageMode === "cloud"} className="mt-0.5 accent-primary" name="storageMode" type="radio" onChange={() => setSettings((current) => ({ ...current, storageMode: "cloud" }))} />
                    <span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{t.remote_title}</span><span className="block text-xs text-muted-foreground">{t.remote_desc}</span></span>
                  </label>
                  {settings.storageMode === "cloud" ? (
                    <div className="ml-4 rounded-lg border bg-muted/40 p-3">
                      <label className="flex cursor-pointer items-start gap-2 text-xs">
                        <input checked={legalAccepted} className="mt-0.5 accent-primary" disabled={!legalBundle} type="checkbox" onChange={(event) => setLegalAccepted(event.target.checked)} />
                        <span>{t.legal_acceptance_label}</span>
                      </label>
                      {legalBundle ? (
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-5 text-xs">
                          <a className="external-link text-primary underline underline-offset-4" href={`${(settings.cloudUrl || DEFAULT_SETTINGS.cloudUrl).replace(/\/+$/, "")}${legalBundle.termsUrl}`} rel="noopener noreferrer" target="_blank">{t.legal_terms}</a>
                          <a className="external-link text-primary underline underline-offset-4" href={`${(settings.cloudUrl || DEFAULT_SETTINGS.cloudUrl).replace(/\/+$/, "")}${legalBundle.privacyUrl}`} rel="noopener noreferrer" target="_blank">{t.legal_privacy}</a>
                          <a className="external-link text-primary underline underline-offset-4" href={`${(settings.cloudUrl || DEFAULT_SETTINGS.cloudUrl).replace(/\/+$/, "")}${legalBundle.acceptableUseUrl}`} rel="noopener noreferrer" target="_blank">{t.legal_acceptable_use}</a>
                          <span className="text-muted-foreground">v{legalBundle.version}</span>
                        </div>
                      ) : null}
                      {legalError ? <p className="mt-2 pl-5 text-xs text-destructive">{t.legal_acceptance_required}</p> : null}
                    </div>
                  ) : null}
                </section>

                <section className="flex flex-col gap-2.5">
                  <span className={SECTION_HEADER}>{t.storage_status_title}</span>
                  <StorageStatusPanel mode={settings.storageMode} t={t} />
                  <label className={cn("flex items-center justify-between gap-3 py-1", settings.storageMode !== "cloud" && "opacity-50")}><span className="min-w-0"><span className="block text-xs font-semibold">{t.history_label}</span><span className="block text-xs text-muted-foreground">{t.history_desc}</span></span><Switch checked={settings.storageMode === "cloud" ? settings.enableHistory : true} className="shrink-0" disabled={settings.storageMode !== "cloud"} onCheckedChange={(value) => setSettings((current) => ({ ...current, enableHistory: value }))} /></label>
                </section>

                <section className="flex flex-col gap-2.5">
                  <span className={SECTION_HEADER}>{t.capture_destination_label}</span>
                  <Card className="gap-3 overflow-visible rounded-none py-0 ring-0" size="sm">
                    <CardContent className="grid gap-3 px-0 sm:grid-cols-2">
                      <label className="flex min-w-0 flex-col gap-1.5">
                        <span className="text-xs font-semibold">{t.project_label}</span>
                        <Combobox autoHighlight disabled={destinationLoading || !destinationProjects.length} itemToStringLabel={(projectId) => destinationProjects.find((project) => project.id === String(projectId))?.name ?? DEFAULT_PROJECT_OPTION.label} itemToStringValue={(projectId) => String(projectId)} items={destinationProjectIds} value={destinationProjectId || DEFAULT_PROJECT_OPTION.value} onValueChange={(value) => changeDestinationProject(String(value ?? ""))}>
                          <ComboboxInput aria-label={t.project_label} className="w-full" placeholder={destinationLoading ? "…" : t.project_label} />
                          <ComboboxContent><ComboboxEmpty>{t.no_projects_found}</ComboboxEmpty><ComboboxList>{(projectId) => { const project = destinationProjects.find((item) => item.id === String(projectId)); return project ? <ComboboxItem disabled={!project.collections.length} key={project.id} value={project.id}>{project.name}</ComboboxItem> : null; }}</ComboboxList></ComboboxContent>
                        </Combobox>
                      </label>
                      <label className="flex min-w-0 flex-col gap-1.5">
                        <span className="text-xs font-semibold">{t.collection_label}</span>
                        <Combobox
                          autoHighlight
                          disabled={destinationLoading || !destinationCollections.length}
                          itemToStringLabel={(collectionId) => destinationCollections.find((collection) => collection.id === String(collectionId))?.name ?? DEFAULT_COLLECTION_OPTION.label}
                          itemToStringValue={(collectionId) => String(collectionId)}
                          items={destinationCollectionIds}
                          value={selectedDestinationCollectionId}
                          onValueChange={(value) => {
                            const collectionId = String(value ?? "");
                            if (destinationCollections.some((collection) => collection.id === collectionId)) {
                              void saveCaptureDestination(collectionId);
                            }
                          }}
                        >
                          <ComboboxInput aria-label={t.collection_label} className="w-full" placeholder={destinationLoading ? "…" : t.collection_label} />
                          <ComboboxContent>
                            <ComboboxEmpty>{t.no_collections_found}</ComboboxEmpty>
                            <ComboboxList>
                              {(collectionId) => {
                                const entry = destinationCollectionTree.find(({ collection }) => collection.id === String(collectionId));
                                return entry ? (
                                  <ComboboxItem key={entry.collection.id} value={entry.collection.id}>
                                    <span
                                      className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"
                                      style={{ paddingInlineStart: `${entry.depth * 16}px` }}
                                    >
                                      {entry.collection.isProtected ? <IconInbox /> : <IconFolder />}
                                      <span className="min-w-0 flex-1 truncate">{entry.collection.name}</span>
                                    </span>
                                  </ComboboxItem>
                                ) : (
                                  <ComboboxItem disabled key={String(collectionId)} value={String(collectionId)}>
                                    <IconInbox />
                                    Inbox
                                  </ComboboxItem>
                                );
                              }}
                            </ComboboxList>
                          </ComboboxContent>
                        </Combobox>
                      </label>
                      {destinationError && <p className="text-xs text-destructive sm:col-span-2">{t.destination_unavailable}</p>}
                    </CardContent>
                  </Card>
                </section>
              </TabsContent>

              <TabsContent className="flex flex-col gap-5" value="account">
                <section className="flex flex-col gap-2.5">
                  <span className={SECTION_HEADER}>{t.account_title}</span>
                  <p className="text-xs leading-relaxed text-muted-foreground">{t.account_description}</p>
                  <div className="space-y-4">
                    {!authReady ? <p className="text-xs text-muted-foreground">…</p> : authSession?.kind === "account" ? (
                      <div className="space-y-3">
                        <div className="rounded-lg border bg-muted/40 p-3"><p className="truncate text-sm font-semibold">{authSession.email}</p><p className="mt-1 text-xs capitalize text-muted-foreground">{authSession.plan}</p></div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => void openBilling()}>{t.btn_manage_sub}</Button>
                          <Button size="sm" variant="ghost" onClick={() => void logout()}><IconLogOut data-icon="inline-start" />{t.btn_sign_out}</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <section aria-labelledby="account-free-title" className="space-y-3 rounded-lg border bg-background p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0"><p className="text-sm font-semibold" id="account-free-title">{t.account_free_title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.account_free_description}</p></div>
                            <Badge className="shrink-0 bg-muted text-muted-foreground" variant="outline">{t.account_free_badge}</Badge>
                          </div>
                          <div className="flex items-stretch gap-2">
                            {temporaryCode ? <><div className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2"><code className="text-base font-bold tracking-[0.16em]">{temporaryCode}</code>{temporaryCodeExpiresAt && <p className="mt-1 text-[11px] text-muted-foreground">{t.account_code_expires}</p>}</div><Button className="shrink-0" variant="outline" onClick={() => void copyTemporaryCode()}><IconCopy data-icon="inline-start" />{copiedCode ? t.status_copied : t.btn_copy_code}</Button></> : <Button disabled={authLoading} variant="outline" onClick={() => void generateTemporaryCode()}><IconKeyRound data-icon="inline-start" />{t.btn_generate_code}</Button>}
                          </div>
                          {temporaryCode && <Button className="h-auto px-0" size="xs" variant="link" onClick={() => setRegenerateCodeOpen(true)}>{t.btn_generate_another_code}</Button>}
                          <div className="rounded-lg bg-muted/60 p-3"><p className="text-xs font-semibold">{t.account_code_entry_title}</p><a className="external-link mt-2 text-xs font-semibold text-primary" href={hostedSignInUrl(settings.cloudUrl, lang)} rel="noopener noreferrer" target="_blank">{t.btn_open_code_entry}</a></div>
                          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground"><IconInfo className="mt-0.5 size-3.5 shrink-0" />{t.account_code_regeneration_note}</p>
                        </section>
                        <AlertDialog open={regenerateCodeOpen} onOpenChange={setRegenerateCodeOpen}>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>{t.account_code_regeneration_title}</AlertDialogTitle><AlertDialogDescription>{t.account_code_regeneration_description.replace("{code}", temporaryCode)}</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>{t.btn_cancel}</AlertDialogCancel><AlertDialogAction disabled={authLoading} onClick={() => void regenerateTemporaryCode()}>{t.btn_invalidate_and_generate}</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <section aria-labelledby="account-email-title" className="space-y-3 rounded-lg border bg-background p-3">
                          <div><p className="text-sm font-semibold" id="account-email-title">{t.account_email_title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{emailCodeRequested ? t.account_email_sent : t.account_email_description}</p></div>
                          {!emailCodeRequested ? (
                            <form className="flex gap-2" onSubmit={requestEmailCode}><Input autoComplete="email" placeholder="you@example.com" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /><Button disabled={authLoading} type="submit" variant="outline"><IconMail data-icon="inline-start" />{t.btn_send_code}</Button></form>
                          ) : (
                            <form className="space-y-2" onSubmit={verifyEmailCode}><label className="block text-xs font-semibold" htmlFor="account-email-code">{t.account_email_code_label}</label><div className="flex gap-2"><Input autoComplete="one-time-code" id="account-email-code" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" placeholder="000000" required value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, ""))} /><Button disabled={authLoading || emailCode.length !== 6} type="submit">{t.btn_verify_code}</Button></div><Button size="xs" type="button" variant="link" onClick={() => setEmailCodeRequested(false)}>{t.btn_change_email}</Button></form>
                          )}
                          <div aria-label={t.account_subscription_prompt_title} className="flex items-center justify-between gap-3 rounded-lg bg-muted/60 p-3" role="group">
                            <div className="min-w-0"><p className="text-xs font-semibold">{t.account_subscription_prompt_title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.account_subscription_prompt_description}</p></div>
                            <Button className="shrink-0" render={<a href={hostedPricingUrl(settings.cloudUrl, lang)} rel="noopener noreferrer" target="_blank" />} variant="pro"><IconSparkles data-icon="inline-start" />{t.btn_upgrade_pro}</Button>
                          </div>
                        </section>
                      </div>
                    )}
                    {authError && <p className="text-xs font-medium text-destructive" role="alert">{authError}</p>}
                  </div>
                </section>
              </TabsContent>

              <TabsContent className="flex flex-col gap-5" value="preferences">
                <section className="flex flex-col gap-2.5">
                  <span className={SECTION_HEADER}>{t.section_interface}</span>
                  <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex min-w-0 flex-col gap-1.5">
                        <span className="text-xs font-semibold">{t.language_label}</span>
                        <Select items={LANGUAGE_OPTIONS.map((option) => ({ label: option.label, value: option.code }))} value={lang} onValueChange={(value) => { const next = value as SupportedLanguage; setLang(next); setSettings((current) => ({ ...current, language: next })); }}><SelectTrigger aria-label={t.language_label} className="w-full" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{LANGUAGE_OPTIONS.map((option) => <SelectItem key={option.code} value={option.code}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select>
                      </label>
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <span className="text-xs font-semibold" id="options-theme-label">{t.theme_label}</span>
                        <Tabs value={settings.theme || "system"} onValueChange={(value) => { const theme = value as ThemeMode; applyTheme(theme); setSettings((current) => ({ ...current, theme })); }}><TabsList aria-labelledby="options-theme-label" className="group-data-horizontal/tabs:h-7 w-full p-0.5 [&>button]:text-xs"><TabsTrigger className="flex-1" value="system"><IconLaptop data-icon="inline-start" />{t.theme_system}</TabsTrigger><TabsTrigger className="flex-1" value="light"><IconSun className="text-amber-500" data-icon="inline-start" />{t.theme_light}</TabsTrigger><TabsTrigger className="flex-1" value="dark"><IconMoon className="text-blue-400" data-icon="inline-start" />{t.theme_dark}</TabsTrigger></TabsList></Tabs>
                      </div>
                  </div>
                </section>

                <section className="flex flex-col gap-2.5">
                  <span className={SECTION_HEADER}>{t.section_handoff}</span>
                  <label className="flex items-center justify-between gap-3 py-1">
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold">
                          {t.handoff_mode_label} · {settings.handoffMode === "full" ? t.handoff_mode_full : t.handoff_mode_compact}
                        </span>
                        <span className="block text-xs text-muted-foreground">{t.handoff_mode_desc}</span>
                      </span>
                      <Switch
                        aria-label={t.handoff_mode_label}
                        checked={settings.handoffMode === "full"}
                        className="shrink-0"
                        onCheckedChange={(checked) => setSettings((current) => ({
                          ...current,
                          handoffMode: checked ? "full" : "compact",
                        }))}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 py-1"><span className="min-w-0"><span className="block text-xs font-semibold">{t.viewer_label}</span><span className="block text-xs text-muted-foreground">{t.viewer_desc}</span></span><Switch checked={settings.includeViewer} className="shrink-0" onCheckedChange={(value) => setSettings((current) => ({ ...current, includeViewer: value }))} /></label>
                    <label className="flex items-center justify-between gap-3 py-1"><span className="min-w-0"><span className="block text-xs font-semibold">{t.viewer_content_label}</span><span className="block text-xs text-muted-foreground">{t.viewer_content_desc}</span></span><Switch checked={settings.copyViewerContent} className="shrink-0" disabled={!settings.includeViewer} onCheckedChange={(value) => setSettings((current) => ({ ...current, copyViewerContent: value }))} /></label>
                    <label className="flex items-center justify-between gap-3 py-1"><span className="min-w-0"><span className="block text-xs font-semibold">{t.screenshot_label}</span><span className="block text-xs text-muted-foreground">{t.screenshot_desc}</span></span><Switch checked={settings.includeScreenshot} className="shrink-0" onCheckedChange={(value) => setSettings((current) => ({ ...current, includeScreenshot: value }))} /></label>
                    <label className="flex items-center justify-between gap-3 py-1"><span className="min-w-0"><span className="block text-xs font-semibold">{t.copy_on_finish_batch_label}</span><span className="block text-xs text-muted-foreground">{t.copy_on_finish_batch_desc}</span></span><Select items={[{ label: t.copy_on_finish_batch_prompt, value: "prompt" }, { label: t.copy_on_finish_batch_link, value: "link" }, { label: t.copy_on_finish_batch_off, value: "off" }]} value={settings.copyOnFinishBatch || "prompt"} onValueChange={(value) => setSettings((current) => ({ ...current, copyOnFinishBatch: (value === "off" || value === "link" ? value : "prompt") as CopyOnFinishBatch }))}><SelectTrigger aria-label={t.copy_on_finish_batch_label} className="w-32 shrink-0" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="prompt">{t.copy_on_finish_batch_prompt}</SelectItem><SelectItem value="link">{t.copy_on_finish_batch_link}</SelectItem><SelectItem value="off">{t.copy_on_finish_batch_off}</SelectItem></SelectGroup></SelectContent></Select></label>
                </section>

                <section className="flex flex-col gap-2.5">
                  <span className={SECTION_HEADER}>{t.section_privacy}</span>
                  <label className="flex items-center justify-between gap-3 py-1"><span className="min-w-0"><span className="block text-xs font-semibold">{t.loop_metrics_label}</span><span className="block text-xs text-muted-foreground">{t.loop_metrics_desc}</span></span><Switch checked={settings.loopMetricsOptIn === true} className="shrink-0" onCheckedChange={(value) => setSettings((current) => ({ ...current, loopMetricsOptIn: value }))} /></label>
                  <label className="flex flex-col gap-1.5 py-1">
                    <span className="text-xs font-semibold">{t.privacy_query_keys_label}</span>
                    <Input
                      value={settings.sensitiveQueryKeys || ""}
                      onChange={(event) => setSettings((current) => ({ ...current, sensitiveQueryKeys: event.target.value }))}
                    />
                    <span className="text-xs text-muted-foreground">{t.privacy_query_keys_desc}</span>
                  </label>
                </section>

              </TabsContent>

              <TabsContent value="shortcuts">
                <ShortcutsTab t={t} />
              </TabsContent>
            </Tabs>

            <footer className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2"><Button className="h-8 text-xs" disabled={!hasUnsavedChanges || (settings.storageMode === "cloud" && (!legalBundle || !legalAccepted))} size="sm" onClick={() => void saveSettings()}><IconSave className="size-3.5" />{t.btn_save}</Button><Button className="h-8 text-xs" size="sm" variant="outline" onClick={() => void openApp()}>{t.btn_open_app}<IconExternalLink data-icon="inline-end" /></Button></div>
              <div className="flex gap-2"><Button className="h-8 text-xs" render={<a href="https://buymeacoffee.com/djalmajr" rel="noopener noreferrer" target="_blank" />} size="sm" variant="coffee"><IconCoffee />{t.btn_coffee}</Button><Button className="h-8 text-xs" render={<a href="https://github.com/sponsors/djalmajr" rel="noopener noreferrer" target="_blank" />} size="sm" variant="sponsor"><IconHeart className="fill-current" />{t.btn_sponsor}</Button></div>
            </footer>
          </div>
        </div>
      </ScrollArea>
      <Toaster position="bottom-center" theme={settings.theme} />
    </div>
  );
}
