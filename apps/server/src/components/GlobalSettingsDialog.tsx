import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  type ProjectTreeProject,
  SUPPORTED_LANGUAGES,
} from "@pinar/shared";
import {
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@pinar/ui";
import { isProjectTreeProject, isRecord } from "@/lib/api-data";
import { flattenCollections } from "@/lib/collection-tree";
import { useDeliveryPreferences } from "@/lib/delivery-preferences";
import { useServerI18n } from "@/lib/i18n";
import { isSupportedLanguage } from "@/lib/language";
import LaptopIcon from "~icons/lucide/laptop";
import MonitorIcon from "~icons/lucide/monitor";
import MoonIcon from "~icons/lucide/moon";
import ShieldCheckIcon from "~icons/lucide/shield-check";
import SlidersHorizontalIcon from "~icons/lucide/sliders-horizontal";
import SunIcon from "~icons/lucide/sun";
import XIcon from "~icons/lucide/x";

type SettingsSection = "capture" | "general" | "interface";
type ThemeMode = "dark" | "light" | "system";

interface GlobalSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SettingRowProps {
  children: ReactNode;
  description: string;
  title: string;
}

const THEME_STORAGE_KEY = "pinar-theme";
const DEFAULT_DESTINATION = "__default__";
const SECTION_HEADER = "text-[11px] font-semibold uppercase tracking-wider";

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

function settingsNavButtonClass(isActive: boolean) {
  return cn(
    // The label is translated, so its length is unbounded: let it wrap instead of
    // spilling past the sidebar. `hyphens-auto` uses the dictionary for <html lang>.
    "h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left font-normal hyphens-auto whitespace-normal hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>span]:min-w-0",
    isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
  );
}

function SettingRow({ children, description, title }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="flex w-52 shrink-0 justify-end">{children}</div>
    </div>
  );
}

export function GlobalSettingsDialog({ open, onOpenChange }: GlobalSettingsDialogProps) {
  const {
    available,
    captureDestination,
    copyOnFinishBatch,
    copyViewerContent,
    handoffMode,
    includeScreenshot,
    includeViewer,
    patch,
    sensitiveQueryKeys,
  } = useDeliveryPreferences();
  const { language, languageName, setLanguage, t } = useServerI18n();
  const [section, setSection] = useState<SettingsSection>("general");
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [projects, setProjects] = useState<ProjectTreeProject[]>([]);
  const [sensitiveQueryKeysDraft, setSensitiveQueryKeysDraft] = useState("");

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
  const copyOnFinishItems = [
    { label: t("settings.copyOnFinishBatchPrompt"), value: "prompt" },
    { label: t("settings.copyOnFinishBatchLink"), value: "link" },
    { label: t("settings.copyOnFinishBatchOff"), value: "off" },
  ];

  const sectionLabel = section === "capture"
    ? t("settings.capture")
    : section === "interface"
      ? t("settings.interface")
      : t("settings.general");
  const sectionDescription = section === "capture"
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
          <aside className="hidden h-full w-[210px] shrink-0 flex-col border-r border-sidebar-border bg-muted/20 p-4 sm:flex">
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
                {t("settings.capture")}
              </Button>
              <Button
                aria-current={section === "interface" ? "page" : undefined}
                className={settingsNavButtonClass(section === "interface")}
                variant="ghost"
                onClick={() => setSection("interface")}
              >
                <MonitorIcon />
                {t("settings.interface")}
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
              <Button size="sm" variant={section === "capture" ? "secondary" : "ghost"} onClick={() => setSection("capture")}>{t("settings.capture")}</Button>
              <Button size="sm" variant={section === "interface" ? "secondary" : "ghost"} onClick={() => setSection("interface")}>{t("settings.interface")}</Button>
            </nav>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <section className={cn("flex flex-col gap-5", section !== "general" && "hidden")}>
                <SettingRow description={t("settings.languageDescription")} title={t("common.language")}>
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
                  <span className={SECTION_HEADER}>{t("settings.captureHeading")}</span>
                  <SettingRow description={t("settings.captureDestinationDescription")} title={t("settings.captureDestination")}>
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
                  <SettingRow description={t("settings.copyOnFinishBatchDescription")} title={t("settings.copyOnFinishBatch")}>
                    <Select
                      disabled={!available}
                      items={copyOnFinishItems}
                      value={copyOnFinishBatch}
                      onValueChange={(value) => {
                        if (value === "off" || value === "link" || value === "prompt") void patch({ copyOnFinishBatch: value });
                      }}
                    >
                      <SelectTrigger aria-label={t("settings.copyOnFinishBatch")} className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent align="end">
                        <SelectGroup>
                          {copyOnFinishItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </SettingRow>
                </div>
                <div className="flex flex-col gap-5">
                  <span className={SECTION_HEADER}>{t("settings.handoffHeading")}</span>
                  <SettingRow description={t("settings.handoffModeDescription")} title={t("settings.handoffMode")}>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">
                        {handoffMode === "full" ? t("settings.handoffModeFull") : t("settings.handoffModeCompact")}
                      </span>
                      <Switch
                        aria-label={t("settings.handoffMode")}
                        checked={handoffMode === "full"}
                        disabled={!available}
                        onCheckedChange={(checked) => void patch({ handoffMode: checked ? "full" : "compact" })}
                      />
                    </div>
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
                  <span className={SECTION_HEADER}>{t("settings.privacyHeading")}</span>
                  <SettingRow description={t("settings.privacyQueryKeysDescription")} title={t("settings.privacyQueryKeys")}>
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
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
