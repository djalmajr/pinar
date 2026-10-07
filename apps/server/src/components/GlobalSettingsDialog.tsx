import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  captureDestinationOptions,
  captureDestinationPath,
  type ProjectTreeProject,
  SUPPORTED_LANGUAGES,
} from "@pinar/shared";
import {
  Badge,
  Button,
  Cascader,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  ProjectIconGlyph,
  SectionHeading,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingRow,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from "@pinar/ui";
import { AgentAccessSettings } from "@/components/AgentAccessSettings";
import { resolveSettingsSection, showsAiSection, showsAiSettings, type SettingsSection } from "@/components/global-settings-sections";
import { isProjectTreeProject, isRecord } from "@/lib/api-data";
import { isPaidAuthSession, useAuthSession } from "@/lib/auth-session";
import { useDeliveryPreferences } from "@/lib/delivery-preferences";
import { useServerI18n } from "@/lib/i18n";
import { collectionDisplayName } from "@pinar/shared";
import { isSupportedLanguage } from "@/lib/language";
import { importLocalExport, LocalImportStoppedError, type LocalImportProgress } from "@/lib/local-import";
import { findProductRelease, loadReleaseContent, type ProductRelease } from "@/lib/release-content";
import { pinarRuntime } from "@/lib/server-header";
import { SERVER_BUILD, SERVER_VERSION, SERVER_VERSION_LABEL } from "@/lib/version";
import DatabaseIcon from "~icons/lucide/database";
import InfoIcon from "~icons/lucide/info";
import ExternalLinkIcon from "~icons/lucide/external-link";
import FolderIcon from "~icons/lucide/folder";
import HistoryIcon from "~icons/lucide/history";
import InboxIcon from "~icons/lucide/inbox";
import KeyRoundIcon from "~icons/lucide/key-round";
import LaptopIcon from "~icons/lucide/laptop";
import MonitorIcon from "~icons/lucide/monitor";
import MoonIcon from "~icons/lucide/moon";
import ShieldCheckIcon from "~icons/lucide/shield-check";
import SlidersHorizontalIcon from "~icons/lucide/sliders-horizontal";
import SunIcon from "~icons/lucide/sun";
import XIcon from "~icons/lucide/x";

type ThemeMode = "dark" | "light" | "system";
type AiUsageStatus = "idle" | "loading" | "ready" | "unavailable";
type AiUsageFeature = "voice_pin";
type AiMode = "byok" | "disabled" | "local";
type AiSettingsStatus = "clearing" | "idle" | "loading" | "ready" | "saving" | "testing";

interface AiUsageHistoryEntry {
  completedAt: string | null;
  createdAt: string;
  credits: number;
  feature: AiUsageFeature;
  status: "refunded" | "reserved" | "succeeded";
}

interface LocalAiSettings {
  apiKey: string;
  apiKeyPreview: string;
  endpoint: string;
  hasApiKey: boolean;
  mode: AiMode;
  model: string;
  transcriptionModel: string;
}

interface GlobalSettingsDialogProps {
  initialSection?: SettingsSection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type OpenGlobalSettings = (section?: SettingsSection) => void;

const GlobalSettingsContext = createContext<OpenGlobalSettings | null>(null);

const THEME_STORAGE_KEY = "pinar-theme";
const PINAR_GITHUB_URL = "https://github.com/djalmajr/pinar";
const PINAR_WEBSITE_URL = "https://pinar.dev";
const AI_USAGE_FEATURES = new Set<AiUsageFeature>([
  "voice_pin",
]);
const AI_USAGE_FEATURE_LABELS = {
  voice_pin: "settings.aiUsageVoicePin",
} as const;

function aiUsageHistory(value: unknown): AiUsageHistoryEntry[] | null {
  if (!isRecord(value) || !Array.isArray(value.aiUsage)) return null;
  const entries: AiUsageHistoryEntry[] = [];
  for (const item of value.aiUsage) {
    if (!isRecord(item)
      || !AI_USAGE_FEATURES.has(item.feature as AiUsageFeature)
      || typeof item.credits !== "number"
      || !Number.isFinite(item.credits)
      || Number(item.credits) <= 0
      || typeof item.createdAt !== "string"
      || Number.isNaN(Date.parse(item.createdAt))
      || (item.status !== "refunded" && item.status !== "reserved" && item.status !== "succeeded")
      || (item.completedAt !== null && typeof item.completedAt !== "string")) continue;
    entries.push({
      completedAt: item.completedAt,
      createdAt: item.createdAt,
      credits: Number(item.credits),
      feature: item.feature as AiUsageFeature,
      status: item.status,
    });
  }
  return entries;
}

// Mirrors the extension's defaultDestination: the first project's inbox.
function serverDefaultDestination(projects: ProjectTreeProject[]) {
  const ordered = [...projects].sort((left, right) => left.position - right.position);
  for (const project of ordered) {
    const inbox = project.collections.find((collection) => collection.isProtected);
    if (inbox) return { collectionId: inbox.id, projectId: project.id };
  }
  return null;
}

function currentThemeMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return "system";
}

function resolveDarkTheme(theme: ThemeMode) {
  return theme === "dark"
    || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
}

function applyTheme(theme: ThemeMode) {
  const dark = resolveDarkTheme(theme);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  if (theme === "system") localStorage.removeItem(THEME_STORAGE_KEY);
  else localStorage.setItem(THEME_STORAGE_KEY, theme);
}

// Every link in About reads the same way the rest of the workspace shows a
// page URL: title, then the address itself as the link, with the new-tab mark.
function AboutLink({ description, href, title }: { description?: string; href: string; title: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-sm font-medium">{title}</span>
      {description ? <span className="text-sm leading-5 text-muted-foreground">{description}</span> : null}
      <a
        className="inline-flex max-w-full items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        href={href}
        rel="noopener noreferrer"
        target="_blank"
      >
        <span className="min-w-0 truncate">{href}</span>
        <ExternalLinkIcon className="size-3.5 shrink-0" />
      </a>
    </div>
  );
}

function absoluteUrl(path: string) {
  return typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();
}

function settingsNavButtonClass(isActive: boolean) {
  return cn(
    // The label is translated, so its length is unbounded: let it wrap instead of
    // spilling past the sidebar. `hyphens-auto` uses the dictionary for <html lang>.
    "h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left font-normal hyphens-auto whitespace-normal hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>span]:min-w-0",
    isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
  );
}

export function GlobalSettingsDialog({ initialSection = "general", open, onOpenChange }: GlobalSettingsDialogProps) {
  const {
    available,
    captureDestination,
    copyViewerContent,
    handoffMode,
    includeScreenshot,
    includeViewer,
    patch,
    sensitiveQueryKeys,
    voicePostProcessing,
  } = useDeliveryPreferences();
  const { language, languageName, setLanguage, t } = useServerI18n();
  const [section, setSection] = useState<SettingsSection>("general");
  const [aiSettings, setAiSettings] = useState<LocalAiSettings>({ apiKey: "", apiKeyPreview: "", endpoint: "", hasApiKey: false, mode: "disabled", model: "", transcriptionModel: "" });
  const [aiSettingsStatus, setAiSettingsStatus] = useState<AiSettingsStatus>("idle");
  const [importProgress, setImportProgress] = useState<LocalImportProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const aiFeedbackToastId = useRef<string | number | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const importFeedbackToastId = useRef<string | number | null>(null);
  const [aiUsage, setAiUsage] = useState<AiUsageHistoryEntry[]>([]);
  const [aiUsageStatus, setAiUsageStatus] = useState<AiUsageStatus>("idle");
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [projects, setProjects] = useState<ProjectTreeProject[]>([]);
  const [sensitiveQueryKeysDraft, setSensitiveQueryKeysDraft] = useState("");
  const runtime = pinarRuntime();
  const authSession = useAuthSession();
  const showPaidAi = runtime === "cloud" && isPaidAuthSession(authSession);
  const showAiSettings = showsAiSettings(runtime, isPaidAuthSession(authSession));
  const showLocalAi = showsAiSection(runtime);
  const showAgentAccess = runtime === "cloud";
  const [currentRelease, setCurrentRelease] = useState<ProductRelease | null>();

  useEffect(() => {
    if (!open) return;
    setSection(resolveSettingsSection(initialSection, { runtime, showAgentAccess }));
    setTheme(currentThemeMode());
    setSensitiveQueryKeysDraft(sensitiveQueryKeys);
  }, [initialSection, open, runtime, sensitiveQueryKeys, showAgentAccess]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/project-tree");
        const body: unknown = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !isRecord(body) || !isRecord(body.tree) || !Array.isArray(body.tree.projects)) {
          setProjects([]);
          return;
        }
        setProjects(body.tree.projects.filter(isProjectTreeProject));
      } catch {
        if (!cancelled) setProjects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !showPaidAi) return undefined;
    const controller = new AbortController();
    setAiUsage([]);
    setAiUsageStatus("loading");
    void fetch("/api/account/entitlements", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<unknown> : null)
      .then((value) => {
        if (controller.signal.aborted) return;
        const history = aiUsageHistory(value);
        if (history === null) {
          setAiUsageStatus("unavailable");
          return;
        }
        setAiUsage(history);
        setAiUsageStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setAiUsageStatus("unavailable");
      });
    return () => controller.abort();
  }, [open, showPaidAi]);

  useEffect(() => {
    if (!open || runtime !== "local") return undefined;
    const controller = new AbortController();
    setAiSettingsStatus("loading");
    void fetch("/api/ai/settings", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const value: unknown = await response.json().catch(() => null);
        if (!response.ok || !isRecord(value)) throw new Error(t("settings.aiUnavailable"));
        if (value.mode !== "disabled" && value.mode !== "local" && value.mode !== "byok") throw new Error(t("settings.aiUnavailable"));
        setAiSettings({
          apiKey: "",
          apiKeyPreview: typeof value.apiKeyPreview === "string" ? value.apiKeyPreview : "",
          endpoint: typeof value.endpoint === "string" ? value.endpoint : "",
          hasApiKey: value.hasApiKey === true,
          mode: value.mode,
          model: typeof value.model === "string" ? value.model : "",
          transcriptionModel: typeof value.transcriptionModel === "string" ? value.transcriptionModel : "",
        });
        setAiSettingsStatus("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        aiFeedbackToastId.current = toast.error(error instanceof Error ? error.message : t("settings.aiUnavailable"));
        setAiSettingsStatus("ready");
      });
    return () => controller.abort();
  }, [open, runtime, t]);

  // A closing dialog or an unmounted component stops a running import, so the
  // progress state cannot outlive the UI that shows it.
  useEffect(() => {
    return () => {
      importAbortRef.current?.abort();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadReleaseContent(language)
      .then((content) => {
        if (!cancelled) setCurrentRelease(findProductRelease(content, SERVER_VERSION));
      })
      .catch(() => {
        if (!cancelled) setCurrentRelease(null);
      });
    return () => {
      cancelled = true;
    };
  }, [language, open]);

  useEffect(() => {
    if (theme !== "system") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme]);

  const inboxLabel = t("dashboard.protectedInbox");
  const destinationOptions = useMemo(
    () => captureDestinationOptions({
      collectionIcon: (collection) => collection.isProtected ? <InboxIcon /> : <FolderIcon />,
      collectionLabel: (collection) => collectionDisplayName(collection, inboxLabel),
      projectIcon: (project) => <ProjectIconGlyph icon={project.icon} />,
      tree: { projects },
    }),
    [inboxLabel, projects],
  );
  // Without an explicit choice the server uses the first project's inbox;
  // show that path so the field never reads as empty.
  const destinationPath = useMemo(
    () => captureDestinationPath({ projects }, captureDestination ?? serverDefaultDestination(projects)),
    [captureDestination, projects],
  );

  const sectionLabel = section === "about"
    ? t("settings.aboutTitle")
    : section === "agentAccess"
      ? t("settings.agentAccess")
    : section === "ai" || section === "aiUsage"
      ? t("settings.ai")
    : section === "capture"
      ? t("settings.capture")
    : section === "data"
      ? t("settings.data")
      : section === "interface"
        ? t("settings.interface")
        : t("settings.general");
  const sectionDescription = section === "about"
    ? t("settings.aboutDescription")
    : section === "agentAccess"
      ? t("settings.agentAccessDescription")
    : section === "aiUsage"
      ? t("settings.aiUsageDescription")
    : section === "ai"
      ? t("settings.aiDescription")
    : section === "capture"
      ? t("settings.captureDescription")
      : section === "data"
        ? t("settings.dataDescription")
      : section === "interface"
        ? t("settings.interfaceDescription")
        : t("settings.generalDescription");
  // The form is locked while the initial load has not finished or a request is
  // in flight; the fields themselves stay editable while only the load is pending.
  const aiFormBusy = aiSettingsStatus !== "ready" && aiSettingsStatus !== "idle";
  const aiWriteBusy = aiSettingsStatus === "saving" || aiSettingsStatus === "clearing" || aiSettingsStatus === "testing";

  function aiSettingsPayload() {
    return {
      endpoint: aiSettings.endpoint,
      mode: aiSettings.mode,
      model: aiSettings.model,
      transcriptionModel: aiSettings.transcriptionModel,
      // The key is only sent when the user typed a new one; an empty field
      // keeps the stored key untouched.
      ...(aiSettings.apiKey ? { apiKey: aiSettings.apiKey } : {}),
    };
  }

  // Sonner deletes a toast by id in a later animation frame, so a new toast with the
  // same id created within that window is the one that gets deleted. Result toasts
  // therefore never reuse a fixed id; the previous id is tracked to clear stale feedback.
  function clearAiFeedback() {
    if (aiFeedbackToastId.current !== null) {
      toast.dismiss(aiFeedbackToastId.current);
      aiFeedbackToastId.current = null;
    }
  }
  function clearImportFeedback() {
    if (importFeedbackToastId.current !== null) {
      toast.dismiss(importFeedbackToastId.current);
      importFeedbackToastId.current = null;
    }
  }

  async function testAiConnection() {
    setAiSettingsStatus("testing");
    clearAiFeedback();
    try {
      const response = await fetch("/api/ai/settings/test", {
        body: JSON.stringify(aiSettingsPayload()),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(value) || value.ok !== true) {
        throw new Error(isRecord(value) && typeof value.error === "string" ? value.error : t("settings.aiUnavailable"));
      }
      const testedModel = typeof value.model === "string" ? value.model : aiSettings.model;
      aiFeedbackToastId.current = toast.success(t("settings.aiConnectionOk", { model: testedModel }));
    } catch (error) {
      aiFeedbackToastId.current = toast.error(error instanceof Error ? error.message : t("settings.aiUnavailable"));
    } finally {
      setAiSettingsStatus("ready");
    }
  }

  async function saveAiSettings() {
    setAiSettingsStatus("saving");
    clearAiFeedback();
    try {
      const response = await fetch("/api/ai/settings", {
        body: JSON.stringify(aiSettingsPayload()),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(value)) {
        throw new Error(isRecord(value) && typeof value.error === "string" ? value.error : t("settings.aiUnavailable"));
      }
      setAiSettings((current) => ({
        ...current,
        apiKey: "",
        apiKeyPreview: typeof value.apiKeyPreview === "string" ? value.apiKeyPreview : current.apiKeyPreview,
        hasApiKey: value.hasApiKey === true,
      }));
      const testedModel = isRecord(value.tested) && typeof value.tested.model === "string"
        ? value.tested.model
        : aiSettings.model;
      aiFeedbackToastId.current = toast.success(t("settings.aiSaved", { model: testedModel }));
    } catch (error) {
      aiFeedbackToastId.current = toast.error(error instanceof Error ? error.message : t("settings.aiUnavailable"));
    } finally {
      setAiSettingsStatus("ready");
    }
  }

  async function clearAiKey() {
    setAiSettingsStatus("clearing");
    clearAiFeedback();
    try {
      const response = await fetch("/api/ai/settings/key", { method: "DELETE" });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(value)) {
        throw new Error(isRecord(value) && typeof value.error === "string" ? value.error : t("settings.aiUnavailable"));
      }
      setAiSettings((current) => ({
        ...current,
        apiKey: "",
        apiKeyPreview: "",
        hasApiKey: false,
      }));
      aiFeedbackToastId.current = toast.success(t("settings.aiKeyRemoved"));
    } catch (error) {
      aiFeedbackToastId.current = toast.error(error instanceof Error ? error.message : t("settings.aiUnavailable"));
    } finally {
      setAiSettingsStatus("ready");
    }
  }

  // Cloud-only data row: the local export is a plain file, so the browser does
  // the whole job; the importer reports progress per session and stops on a
  // fatal answer (auth, trial, quota) or an invalid file.
  async function importLocalFile(file: File) {
    clearImportFeedback();
    setImportProgress({ done: 0, failed: 0, total: 0 });
    const controller = new AbortController();
    importAbortRef.current = controller;
    try {
      const result = await importLocalExport(file, { onProgress: (progress) => setImportProgress(progress), signal: controller.signal });
      if (result.failed.length > 0) {
        importFeedbackToastId.current = toast.error(t("settings.importPartial", { count: result.imported, failed: result.failed.length }));
      } else {
        importFeedbackToastId.current = toast.success(t("settings.importDone", { count: result.imported }));
      }
    } catch (error) {
      if (error instanceof LocalImportStoppedError && error.invalidFile) {
        importFeedbackToastId.current = toast.error(t("settings.importInvalid"));
      } else {
        importFeedbackToastId.current = toast.error(t("settings.importStopped", { error: error instanceof Error ? error.message : String(error) }));
      }
    } finally {
      setImportProgress(null);
      if (importAbortRef.current === controller) importAbortRef.current = null;
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function selectTheme(nextTheme: ThemeMode) {
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  function selectCaptureDestination(path: string[]) {
    const projectId = path[0];
    const collectionId = path.at(-1);
    if (!projectId || !collectionId || path.length < 2) return;
    if (captureDestination?.collectionId === collectionId && captureDestination.projectId === projectId) return;
    void patch({ captureDestination: { collectionId, projectId } });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(44rem,calc(100dvh-2rem))] w-[min(68rem,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden rounded-xl p-0 sm:max-w-none">
        <DialogDescription className="sr-only">{t("settings.description")}</DialogDescription>
        <div className="flex min-h-0 min-w-0 flex-1">
          <aside className="hidden h-full w-[210px] shrink-0 flex-col border-r border-sidebar-border bg-muted/20 p-2 sm:flex">
            <div className="px-2 py-3">
              <DialogTitle>{t("settings.title")}</DialogTitle>
              <span className="block text-xs text-muted-foreground">Pinar</span>
            </div>
            <nav aria-label={t("settings.title")} className="mt-2 flex flex-col gap-1">
              <Button
                aria-current={section === "general" ? "page" : undefined}
                className={settingsNavButtonClass(section === "general")}
                variant="ghost"
                onClick={() => setSection("general")}
              >
                <SlidersHorizontalIcon />
                {t("settings.general")}
              </Button>
              <Button
                aria-current={section === "capture" ? "page" : undefined}
                className={settingsNavButtonClass(section === "capture")}
                variant="ghost"
                onClick={() => setSection("capture")}
              >
                <ShieldCheckIcon />
                {t("settings.captureNav")}
              </Button>
              {showAgentAccess ? (
                <Button
                  aria-current={section === "agentAccess" ? "page" : undefined}
                  className={settingsNavButtonClass(section === "agentAccess")}
                  variant="ghost"
                  onClick={() => setSection("agentAccess")}
                >
                  <KeyRoundIcon />
                  {t("settings.agentAccess")}
                </Button>
              ) : null}
              <Button
                aria-current={section === "interface" ? "page" : undefined}
                className={settingsNavButtonClass(section === "interface")}
                variant="ghost"
                onClick={() => setSection("interface")}
              >
                <MonitorIcon />
                {t("settings.interfaceNav")}
              </Button>
              {showLocalAi ? (
                <Button
                  aria-current={section === "ai" ? "page" : undefined}
                  className={settingsNavButtonClass(section === "ai")}
                  variant="ghost"
                  onClick={() => setSection("ai")}
                >
                  <HistoryIcon />
                  {t("settings.ai")}
                </Button>
              ) : null}
              <Button
                aria-current={section === "data" ? "page" : undefined}
                className={settingsNavButtonClass(section === "data")}
                variant="ghost"
                onClick={() => setSection("data")}
              >
                <DatabaseIcon />
                {t("settings.data")}
              </Button>
              {showAiSettings ? (
                <Button
                  aria-current={section === "aiUsage" ? "page" : undefined}
                  className={settingsNavButtonClass(section === "aiUsage")}
                  variant="ghost"
                  onClick={() => setSection("aiUsage")}
                >
                  <HistoryIcon />
                  {t("settings.ai")}
                </Button>
              ) : null}
              <Button
                aria-current={section === "about" ? "page" : undefined}
                className={settingsNavButtonClass(section === "about")}
                variant="ghost"
                onClick={() => setSection("about")}
              >
                <InfoIcon />
                {t("settings.about")}
              </Button>
            </nav>
          </aside>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex min-h-20 shrink-0 items-start justify-between gap-4 border-b p-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">{sectionLabel}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{sectionDescription}</p>
              </div>
              <DialogClose
                aria-label={t("settings.close")}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-muted-foreground shadow-none outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <XIcon className="size-4" />
              </DialogClose>
            </header>
            <nav aria-label={t("settings.title")} className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:hidden">
              <Button size="sm" variant={section === "general" ? "secondary" : "ghost"} onClick={() => setSection("general")}>{t("settings.general")}</Button>
              <Button size="sm" variant={section === "capture" ? "secondary" : "ghost"} onClick={() => setSection("capture")}>{t("settings.captureNav")}</Button>
              {showAgentAccess ? <Button size="sm" variant={section === "agentAccess" ? "secondary" : "ghost"} onClick={() => setSection("agentAccess")}><KeyRoundIcon />{t("settings.agentAccess")}</Button> : null}
              <Button size="sm" variant={section === "interface" ? "secondary" : "ghost"} onClick={() => setSection("interface")}>{t("settings.interfaceNav")}</Button>
              {showLocalAi ? <Button size="sm" variant={section === "ai" ? "secondary" : "ghost"} onClick={() => setSection("ai")}><HistoryIcon />{t("settings.ai")}</Button> : null}
              <Button size="sm" variant={section === "data" ? "secondary" : "ghost"} onClick={() => setSection("data")}><DatabaseIcon />{t("settings.data")}</Button>
              {showAiSettings ? <Button size="sm" variant={section === "aiUsage" ? "secondary" : "ghost"} onClick={() => setSection("aiUsage")}>{t("settings.ai")}</Button> : null}
              <Button size="sm" variant={section === "about" ? "secondary" : "ghost"} onClick={() => setSection("about")}>{t("settings.about")}</Button>
            </nav>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <section className={cn("flex flex-col gap-5", section !== "general" && "hidden")}>
                <SettingRow controlClassName="w-36" description={t("settings.languageDescription")} title={t("common.language")}>
                  <Select
                    items={SUPPORTED_LANGUAGES.map((candidate) => ({ label: languageName(candidate), value: candidate }))}
                    value={language}
                    onValueChange={(value) => {
                      if (value && isSupportedLanguage(value)) {
                        setLanguage(value);
                        void patch({ language: value });
                      }
                    }}
                  >
                    <SelectTrigger aria-label={t("common.language")} className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent align="end">
                      <SelectGroup>
                        {SUPPORTED_LANGUAGES.map((candidate) => <SelectItem key={candidate} value={candidate}>{languageName(candidate)}</SelectItem>)}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </SettingRow>
              </section>
              <section className={cn("flex flex-col gap-5", section !== "capture" && "hidden")}>
                <div className="flex flex-col gap-5">
                  <SectionHeading>{t("settings.captureHeading")}</SectionHeading>
                  <SettingRow controlClassName="min-w-0 max-w-72" description={t("settings.captureDestinationDescription")} title={t("settings.captureDestination")}>
                    <Cascader
                      aria-label={t("settings.captureDestination")}
                      disabled={!available || destinationOptions.length === 0}
                      emptyText={t("dashboard.noCollectionsFound")}
                      options={destinationOptions}
                      placeholder={t("settings.collection")}
                      searchPlaceholder={t("dashboard.search")}
                      value={destinationPath}
                      onValueChange={selectCaptureDestination}
                    />
                  </SettingRow>
                </div>
                <div className="flex flex-col gap-5">
                  <SectionHeading>{t("settings.handoffHeading")}</SectionHeading>
                  <SettingRow description={t("settings.handoffModeDescription")} title={t("settings.handoffMode")}>
                    <Switch
                      aria-label={t("settings.handoffMode")}
                      checked={handoffMode === "full"}
                      disabled={!available}
                      onCheckedChange={(checked) => void patch({ handoffMode: checked ? "full" : "compact" })}
                    />
                  </SettingRow>
                  <SettingRow description={t("dashboard.includeScreenshotHint")} title={t("dashboard.includeScreenshot")}>
                    <Switch
                      aria-label={t("dashboard.includeScreenshot")}
                      checked={includeScreenshot}
                      disabled={!available}
                      onCheckedChange={(value) => void patch({ includeScreenshot: value })}
                    />
                  </SettingRow>
                  <SettingRow description={t("settings.includeViewerDescription")} title={t("settings.includeViewer")}>
                    <Switch
                      aria-label={t("settings.includeViewer")}
                      checked={includeViewer}
                      disabled={!available}
                      onCheckedChange={(value) => void patch({ includeViewer: value })}
                    />
                  </SettingRow>
                  <SettingRow description={t("settings.copyViewerContentDescription")} title={t("settings.copyViewerContent")}>
                    <Switch
                      aria-label={t("settings.copyViewerContent")}
                      checked={copyViewerContent}
                      disabled={!available || !includeViewer}
                      onCheckedChange={(value) => void patch({ copyViewerContent: value })}
                    />
                  </SettingRow>
                </div>
                <div className="flex flex-col gap-5">
                  <SectionHeading>{t("settings.privacyHeading")}</SectionHeading>
                  <SettingRow layout="stack" description={t("settings.privacyQueryKeysDescription")} title={t("settings.privacyQueryKeys")}>
                    <Input
                      aria-label={t("settings.privacyQueryKeys")}
                      disabled={!available}
                      maxLength={2000}
                      value={sensitiveQueryKeysDraft}
                      onBlur={() => {
                        if (sensitiveQueryKeysDraft !== sensitiveQueryKeys) {
                          void patch({ sensitiveQueryKeys: sensitiveQueryKeysDraft });
                        }
                      }}
                      onChange={(event) => setSensitiveQueryKeysDraft(event.target.value)}
                    />
                  </SettingRow>
                </div>
              </section>
              <section className={cn("flex flex-col gap-5", section !== "interface" && "hidden")}>
                <SettingRow description={t("settings.themeDescription")} title={t("settings.theme")}>
                  <Tabs
                    value={theme}
                    onValueChange={(value) => {
                      if (value === "system" || value === "light" || value === "dark") selectTheme(value);
                    }}
                  >
                    <TabsList aria-label={t("settings.theme")} variant="segmented">
                      <TabsTrigger aria-label={t("settings.themeSystem")} title={t("settings.themeSystem")} value="system"><LaptopIcon /></TabsTrigger>
                      <TabsTrigger aria-label={t("settings.themeLight")} title={t("settings.themeLight")} value="light"><SunIcon className="text-amber-500" /></TabsTrigger>
                      <TabsTrigger aria-label={t("settings.themeDark")} title={t("settings.themeDark")} value="dark"><MoonIcon className="text-blue-500" /></TabsTrigger>
                    </TabsList>
                  </Tabs>
                </SettingRow>
              </section>
              {showAgentAccess ? <section className={cn("flex flex-col gap-5", section !== "agentAccess" && "hidden")}>
                <AgentAccessSettings canCreate={showPaidAi} open={open && section === "agentAccess"} projects={projects} />
              </section> : null}
              {showLocalAi ? (
                <section className={cn("flex flex-col gap-5", section !== "ai" && "hidden")}>
                  <SettingRow controlClassName="w-72" description={t("settings.aiModeDescription")} title={t("settings.aiMode")}>
                    <Select
                      disabled={aiFormBusy}
                      items={[
                        { label: t("settings.aiDisabled"), value: "disabled" },
                        { label: t("settings.aiLocal"), value: "local" },
                        { label: t("settings.aiByok"), value: "byok" },
                      ]}
                      value={aiSettings.mode}
                      onValueChange={(value) => {
                        if (value !== "disabled" && value !== "local" && value !== "byok") return;
                        setAiSettings((current) => ({
                          ...current,
                          endpoint: value === "local" && !current.endpoint ? "http://127.0.0.1:11434/v1" : current.endpoint,
                          mode: value,
                        }));
                      }}
                    >
                      <SelectTrigger aria-label={t("settings.aiMode")} className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent align="end">
                        <SelectGroup>
                          <SelectItem value="disabled">{t("settings.aiDisabled")}</SelectItem>
                          <SelectItem value="local">{t("settings.aiLocal")}</SelectItem>
                          <SelectItem value="byok">{t("settings.aiByok")}</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </SettingRow>
                  {aiSettings.mode !== "disabled" ? (
                    <>
                      <SettingRow controlClassName="w-72" description={t("settings.aiEndpointDescription")} title={t("settings.aiEndpoint")}>
                        <Input
                          aria-label={t("settings.aiEndpoint")}
                          autoComplete="url"
                          disabled={aiWriteBusy}
                          placeholder="http://127.0.0.1:11434/v1"
                          value={aiSettings.endpoint}
                          onChange={(event) => {
                            setAiSettings((current) => ({ ...current, endpoint: event.target.value }));
                          }}
                        />
                      </SettingRow>
                      <SettingRow controlClassName="w-72" description={t("settings.aiModelDescription")} title={t("settings.aiModel")}>
                        <Input
                          aria-label={t("settings.aiModel")}
                          disabled={aiWriteBusy}
                          placeholder="llama3.2"
                          value={aiSettings.model}
                          onChange={(event) => {
                            setAiSettings((current) => ({ ...current, model: event.target.value }));
                          }}
                        />
                      </SettingRow>
                      <SettingRow controlClassName="w-72" description={t("settings.aiTranscriptionModelDescription")} title={t("settings.aiTranscriptionModel")}>
                        <Input
                          aria-label={t("settings.aiTranscriptionModel")}
                          disabled={aiWriteBusy}
                          value={aiSettings.transcriptionModel}
                          onChange={(event) => {
                            setAiSettings((current) => ({ ...current, transcriptionModel: event.target.value }));
                          }}
                        />
                      </SettingRow>
                      {aiSettings.mode === "byok" ? (
                        <SettingRow controlClassName="w-72" description={t("settings.aiKeyDescription")} title={t("settings.aiKey")}>
                          <div className="relative w-full">
                            <Input
                              aria-label={t("settings.aiKey")}
                              autoComplete="off"
                              className={cn("w-full", aiSettings.hasApiKey && "pr-9")}
                              disabled={aiWriteBusy}
                              placeholder={aiSettings.apiKeyPreview || (aiSettings.hasApiKey ? t("settings.aiKeyStored") : "sk-…")}
                              type="password"
                              value={aiSettings.apiKey}
                              onChange={(event) => {
                                setAiSettings((current) => ({ ...current, apiKey: event.target.value }));
                              }}
                            />
                            {aiSettings.hasApiKey ? (
                              <Button
                                aria-label={t("settings.aiKeyRemove")}
                                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                disabled={aiWriteBusy}
                                size="icon-xs"
                                title={t("settings.aiKeyRemove")}
                                type="button"
                                variant="ghost"
                                onClick={() => void clearAiKey()}
                              >
                                <XIcon className="size-3.5" />
                              </Button>
                            ) : null}
                          </div>
                        </SettingRow>
                      ) : null}
                    </>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <Button
                      disabled={aiFormBusy}
                      type="button"
                      variant="outline"
                      onClick={() => void testAiConnection()}
                    >
                      {aiSettingsStatus === "testing" ? t("settings.aiTesting") : t("settings.aiTestConnection")}
                    </Button>
                    <Button
                      disabled={aiFormBusy}
                      type="button"
                      onClick={() => void saveAiSettings()}
                    >
                      {aiSettingsStatus === "saving" ? t("settings.aiTesting") : t("settings.aiSave")}
                    </Button>
                  </div>
                </section>
              ) : null}
              <section className={cn("flex flex-col gap-5", section !== "data" && "hidden")}>
                {runtime === "local" ? (
                  <SettingRow controlClassName="w-72" description={t("settings.exportDataDescription")} title={t("settings.exportData")}>
                    <Button render={<a download href="/api/export" />}>{t("settings.exportData")}</Button>
                  </SettingRow>
                ) : (
                  <>
                    <SettingRow controlClassName="w-72" description={t("settings.importDataDescription")} title={t("settings.importData")}>
                      <Button disabled={importProgress !== null} type="button" onClick={() => fileInputRef.current?.click()}>
                        {t("settings.importChoose")}
                      </Button>
                      <input
                        accept=".zip,application/zip"
                        aria-hidden="true"
                        className="hidden"
                        ref={fileInputRef}
                        tabIndex={-1}
                        type="file"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void importLocalFile(file);
                        }}
                      />
                    </SettingRow>
                    {importProgress ? (
                      <div className="flex flex-col gap-1" role="status">
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${importProgress.total === 0 ? 0 : Math.min(100, Math.round((importProgress.done / importProgress.total) * 100))}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm text-muted-foreground">{t("settings.importProgress", { done: importProgress.done, total: importProgress.total })}</p>
                          <Button type="button" onClick={() => importAbortRef.current?.abort()}>
                            {t("settings.importCancel")}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </section>
              {showAiSettings ? <section className={cn("flex flex-col gap-3", section !== "aiUsage" && "hidden")}>
                  <div className="flex flex-col gap-3">
                    <SettingRow
                      description={t("settings.voicePostProcessingDescription")}
                      title={t("settings.voicePostProcessing")}
                    >
                      <Switch
                        aria-label={t("settings.voicePostProcessing")}
                        checked={voicePostProcessing}
                        disabled={!available}
                        onCheckedChange={(value) => void patch({ voicePostProcessing: value })}
                      />
                    </SettingRow>
                    {aiUsageStatus === "loading" || aiUsageStatus === "idle" ? (
                  <p className="rounded-lg border bg-card px-3 py-3 text-sm text-muted-foreground">{t("settings.aiUsageLoading")}</p>
                ) : aiUsageStatus === "unavailable" ? (
                  <p className="rounded-lg border bg-card px-3 py-3 text-sm text-muted-foreground">{t("settings.aiUsageUnavailable")}</p>
                ) : aiUsage.length === 0 ? (
                  <p className="rounded-lg border bg-card px-3 py-3 text-sm text-muted-foreground">{t("settings.aiUsageEmpty")}</p>
                ) : aiUsage.map((entry) => (
                  <div className="flex items-center justify-between gap-4 rounded-lg border bg-card px-3 py-3" key={`${entry.createdAt}-${entry.feature}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{t(AI_USAGE_FEATURE_LABELS[entry.feature])}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.completedAt || entry.createdAt))}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {entry.status === "reserved" ? <Badge variant="secondary">{t("settings.aiUsagePending")}</Badge> : null}
                      {entry.status === "refunded" ? <Badge variant="outline">{t("settings.aiUsageRefunded")}</Badge> : null}
                      <span className="text-sm font-medium tabular-nums">{t("settings.aiUsageCredits", { count: entry.credits })}</span>
                    </div>
                  </div>
                ))}
                  </div>
              </section> : null}
              <section className={cn("flex flex-col gap-5", section !== "about" && "hidden")}>
                <div className="flex flex-col gap-5">
                  <SectionHeading>{t("settings.versionHeading")}</SectionHeading>
                  <SettingRow controlClassName="w-52" title={t("settings.productName")}>
                    <span className="text-sm tabular-nums">{SERVER_VERSION_LABEL}</span>
                  </SettingRow>
                </div>
                <div className="flex flex-col gap-5">
                  <SectionHeading>{t("settings.linksHeading")}</SectionHeading>
                  <AboutLink
                    description={SERVER_BUILD
                      ? t("settings.whatsNewAhead", { version: SERVER_VERSION })
                      : currentRelease
                        ? `${currentRelease.title}. ${currentRelease.summary}`
                        : currentRelease === null
                          ? t("settings.whatsNewUnpublished")
                          : undefined}
                    href={absoluteUrl("/releases")}
                    title={t("settings.whatsNew")}
                  />
                  <AboutLink href={PINAR_WEBSITE_URL} title={t("settings.website")} />
                  <AboutLink href={PINAR_GITHUB_URL} title={t("settings.github")} />
                  <AboutLink href={absoluteUrl("/legal/terms")} title={t("settings.terms")} />
                  <AboutLink href={absoluteUrl("/legal/privacy")} title={t("settings.privacyPolicy")} />
                </div>
              </section>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function GlobalSettingsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [initialSection, setInitialSection] = useState<SettingsSection>("general");
  const openSettings = useCallback<OpenGlobalSettings>((section = "general") => {
    setInitialSection(section);
    setOpen(true);
  }, []);

  return (
    <GlobalSettingsContext.Provider value={openSettings}>
      {children}
      <GlobalSettingsDialog initialSection={initialSection} open={open} onOpenChange={setOpen} />
    </GlobalSettingsContext.Provider>
  );
}

export function useGlobalSettings() {
  const openSettings = useContext(GlobalSettingsContext);
  if (!openSettings) throw new Error("useGlobalSettings must be used within GlobalSettingsProvider");
  return openSettings;
}
