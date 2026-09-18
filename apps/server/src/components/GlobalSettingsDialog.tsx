import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type ProjectTreeProject,
  SUPPORTED_LANGUAGES,
} from "@pinar/shared";
import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
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
} from "@pinar/ui";
import { isProjectTreeProject, isRecord } from "@/lib/api-data";
import { isPaidAuthSession, useAuthSession } from "@/lib/auth-session";
import { flattenCollections } from "@/lib/collection-tree";
import { useDeliveryPreferences } from "@/lib/delivery-preferences";
import { useServerI18n } from "@/lib/i18n";
import { isSupportedLanguage } from "@/lib/language";
import { findProductRelease, loadReleaseContent, type ProductRelease } from "@/lib/release-content";
import { pinarRuntime } from "@/lib/server-header";
import { SERVER_BUILD, SERVER_VERSION, SERVER_VERSION_LABEL } from "@/lib/version";
import InfoIcon from "~icons/lucide/info";
import ExternalLinkIcon from "~icons/lucide/external-link";
import HistoryIcon from "~icons/lucide/history";
import LaptopIcon from "~icons/lucide/laptop";
import MonitorIcon from "~icons/lucide/monitor";
import MoonIcon from "~icons/lucide/moon";
import ShieldCheckIcon from "~icons/lucide/shield-check";
import SlidersHorizontalIcon from "~icons/lucide/sliders-horizontal";
import SunIcon from "~icons/lucide/sun";
import XIcon from "~icons/lucide/x";

type SettingsSection = "about" | "aiUsage" | "capture" | "general" | "interface";
type ThemeMode = "dark" | "light" | "system";
type AiUsageStatus = "idle" | "loading" | "ready" | "unavailable";
type AiUsageFeature = "component_export" | "design_system" | "reproduction" | "session_summary" | "voice_pin";

interface AiUsageHistoryEntry {
  completedAt: string | null;
  createdAt: string;
  credits: number;
  feature: AiUsageFeature;
  status: "refunded" | "reserved" | "succeeded";
}

interface GlobalSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GlobalSettingsContext = createContext<(() => void) | null>(null);

const THEME_STORAGE_KEY = "pinar-theme";
const DEFAULT_DESTINATION = "__default__";
const PINAR_GITHUB_URL = "https://github.com/djalmajr/pinar";
const PINAR_WEBSITE_URL = "https://pinar.dev";
const AI_USAGE_FEATURES = new Set<AiUsageFeature>([
  "component_export",
  "design_system",
  "reproduction",
  "session_summary",
  "voice_pin",
]);
const AI_USAGE_FEATURE_LABELS = {
  component_export: "settings.aiUsageComponentExport",
  design_system: "settings.aiUsageDesignSystem",
  reproduction: "settings.aiUsageReproduction",
  session_summary: "settings.aiUsageSessionSummary",
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

export function GlobalSettingsDialog({ open, onOpenChange }: GlobalSettingsDialogProps) {
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
  const [aiUsage, setAiUsage] = useState<AiUsageHistoryEntry[]>([]);
  const [aiUsageStatus, setAiUsageStatus] = useState<AiUsageStatus>("idle");
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [projects, setProjects] = useState<ProjectTreeProject[]>([]);
  const [sensitiveQueryKeysDraft, setSensitiveQueryKeysDraft] = useState("");
  const runtime = pinarRuntime();
  const authSession = useAuthSession();
  const showPaidAi = runtime === "cloud" && isPaidAuthSession(authSession);
  const [currentRelease, setCurrentRelease] = useState<ProductRelease | null>();

  useEffect(() => {
    if (!open) return;
    setSection("general");
    setTheme(currentThemeMode());
    setSensitiveQueryKeysDraft(sensitiveQueryKeys);
  }, [open, sensitiveQueryKeys]);

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

  const selectedProject = projects.find((project) => project.id === captureDestination?.projectId);
  const collectionEntries = useMemo(
    () => selectedProject ? flattenCollections(selectedProject.collections) : [],
    [selectedProject],
  );
  const projectItems = useMemo(
    () => [
      { label: t("settings.captureDestinationDefault"), value: DEFAULT_DESTINATION },
      ...projects.map((project) => ({ label: project.name, value: project.id })),
    ],
    [projects, t],
  );
  const collectionItems = useMemo(
    () => collectionEntries.map(({ collection }) => ({ label: collection.name, value: collection.id })),
    [collectionEntries],
  );

  const sectionLabel = section === "about"
    ? t("settings.aboutTitle")
    : section === "aiUsage"
      ? t("settings.aiUsage")
    : section === "capture"
      ? t("settings.capture")
      : section === "interface"
        ? t("settings.interface")
        : t("settings.general");
  const sectionDescription = section === "about"
    ? t("settings.aboutDescription")
    : section === "aiUsage"
      ? t("settings.aiUsageDescription")
    : section === "capture"
      ? t("settings.captureDescription")
      : section === "interface"
        ? t("settings.interfaceDescription")
        : t("settings.generalDescription");

  function selectTheme(nextTheme: ThemeMode) {
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  function selectCaptureProject(value: string | null) {
    if (!value || value === DEFAULT_DESTINATION) {
      void patch({ captureDestination: null });
      return;
    }
    const project = projects.find((item) => item.id === value);
    if (!project) return;
    const inbox = project.collections.find((collection) => collection.isProtected) ?? project.collections[0];
    if (!inbox) return;
    void patch({ captureDestination: { collectionId: inbox.id, projectId: project.id } });
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
              <Button
                aria-current={section === "interface" ? "page" : undefined}
                className={settingsNavButtonClass(section === "interface")}
                variant="ghost"
                onClick={() => setSection("interface")}
              >
                <MonitorIcon />
                {t("settings.interfaceNav")}
              </Button>
              {showPaidAi ? (
                <Button
                  aria-current={section === "aiUsage" ? "page" : undefined}
                  className={settingsNavButtonClass(section === "aiUsage")}
                  variant="ghost"
                  onClick={() => setSection("aiUsage")}
                >
                  <HistoryIcon />
                  {t("settings.aiUsage")}
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
            <header className="flex min-h-20 shrink-0 items-center justify-between gap-4 border-b p-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">{sectionLabel}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{sectionDescription}</p>
              </div>
              <DialogClose
                aria-label={t("settings.close")}
                className="flex size-8 items-center justify-center rounded-lg border-0 bg-transparent text-muted-foreground shadow-none outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <XIcon className="size-4" />
              </DialogClose>
            </header>
            <nav aria-label={t("settings.title")} className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:hidden">
              <Button size="sm" variant={section === "general" ? "secondary" : "ghost"} onClick={() => setSection("general")}>{t("settings.general")}</Button>
              <Button size="sm" variant={section === "capture" ? "secondary" : "ghost"} onClick={() => setSection("capture")}>{t("settings.captureNav")}</Button>
              <Button size="sm" variant={section === "interface" ? "secondary" : "ghost"} onClick={() => setSection("interface")}>{t("settings.interfaceNav")}</Button>
              {showPaidAi ? <Button size="sm" variant={section === "aiUsage" ? "secondary" : "ghost"} onClick={() => setSection("aiUsage")}>{t("settings.aiUsage")}</Button> : null}
              <Button size="sm" variant={section === "about" ? "secondary" : "ghost"} onClick={() => setSection("about")}>{t("settings.about")}</Button>
            </nav>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <section className={cn("flex flex-col gap-5", section !== "general" && "hidden")}>
                <SettingRow controlClassName="w-52" description={t("settings.languageDescription")} title={t("common.language")}>
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
                  <SettingRow controlClassName="w-52" description={t("settings.captureDestinationDescription")} title={t("settings.captureDestination")}>
                    <div className="flex w-full flex-col gap-2">
                      <Select
                        disabled={!available}
                        items={projectItems}
                        value={captureDestination?.projectId ?? DEFAULT_DESTINATION}
                        onValueChange={selectCaptureProject}
                      >
                        <SelectTrigger aria-label={t("settings.project")} className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent align="end">
                          <SelectGroup>
                            <SelectItem value={DEFAULT_DESTINATION}>{t("settings.captureDestinationDefault")}</SelectItem>
                            {projects.map((project) => (
                              <SelectItem disabled={project.collections.length === 0} key={project.id} value={project.id}>
                                {project.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      {captureDestination ? (
                        // Only meaningful once a project is chosen; an empty
                        // second box under "server default" reads as broken.
                        <Select
                          disabled={!available}
                          items={collectionItems}
                          value={captureDestination.collectionId}
                          onValueChange={(value) => {
                            if (!value) return;
                            if (!collectionEntries.some(({ collection }) => collection.id === value)) return;
                            void patch({ captureDestination: { collectionId: value, projectId: captureDestination.projectId } });
                          }}
                        >
                          <SelectTrigger aria-label={t("settings.collection")} className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent align="end">
                            <SelectGroup>
                              {collectionEntries.map(({ collection, depth }) => (
                                <SelectItem key={collection.id} value={collection.id}>
                                  <span className="block truncate" style={{ paddingInlineStart: `${depth * 12}px` }}>
                                    {collection.name}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      ) : null}
                    </div>
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
              {showPaidAi ? <section className={cn("flex flex-col gap-3", section !== "aiUsage" && "hidden")}>
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
              </section> : null}
              <section className={cn("flex flex-col gap-5", section !== "about" && "hidden")}>
                <div className="flex flex-col gap-5">
                  <SectionHeading>{t("settings.versionHeading")}</SectionHeading>
                  <SettingRow controlClassName="w-52" title={t("settings.productName")}>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span className="text-sm tabular-nums">{SERVER_VERSION_LABEL}</span>
                      <Badge variant="secondary">
                        {runtime === "local" ? t("settings.runtimeLocal") : t("settings.runtimeCloud")}
                      </Badge>
                    </div>
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
  const openSettings = useCallback(() => setOpen(true), []);

  return (
    <GlobalSettingsContext.Provider value={openSettings}>
      {children}
      <GlobalSettingsDialog open={open} onOpenChange={setOpen} />
    </GlobalSettingsContext.Provider>
  );
}

export function useGlobalSettings() {
  const openSettings = useContext(GlobalSettingsContext);
  if (!openSettings) throw new Error("useGlobalSettings must be used within GlobalSettingsProvider");
  return openSettings;
}
