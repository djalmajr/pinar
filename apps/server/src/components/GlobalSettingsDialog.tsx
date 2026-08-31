import { type ReactNode, useEffect, useState } from "react";
import type { SupportedLanguage } from "@pinar/shared";
import {
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
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
import { ResizableSidebarPanel } from "@/components/ResizableSidebarPanel";
import { useDeliveryPreferences } from "@/lib/delivery-preferences";
import { SERVER_LANGUAGES, useServerI18n } from "@/lib/i18n";
import LaptopIcon from "~icons/lucide/laptop";
import MonitorIcon from "~icons/lucide/monitor";
import MoonIcon from "~icons/lucide/moon";
import SettingsIcon from "~icons/lucide/settings";
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

function currentThemeMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return "system";
}

function isSupportedLanguage(value: string): value is SupportedLanguage {
  return SERVER_LANGUAGES.some((candidate) => candidate === value);
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

function settingsNavButtonClass(compact: boolean, isActive: boolean) {
  return cn(
    "rounded-md font-normal hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    compact ? "size-8 justify-center p-0" : "w-full justify-start gap-2 px-2",
    isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
  );
}

function SettingRow({ children, description, title }: SettingRowProps) {
  return (
    <div className="flex min-h-24 items-center justify-between gap-6 border-b px-5 py-4 last:border-b-0">
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
    handoffMode,
    includeScreenshot,
    setHandoffMode,
    setIncludeScreenshot,
  } = useDeliveryPreferences();
  const { language, languageName, setLanguage, t } = useServerI18n();
  const [section, setSection] = useState<SettingsSection>("general");
  const [settingsSidebarOpen, setSettingsSidebarOpen] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>("system");

  useEffect(() => {
    if (!open) return;
    setSection("general");
    setSettingsSidebarOpen(true);
    setTheme(currentThemeMode());
  }, [open]);

  useEffect(() => {
    if (theme !== "system") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(44rem,calc(100dvh-2rem))] w-[min(68rem,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden rounded-xl p-0 sm:max-w-none">
        <DialogDescription className="sr-only">{t("settings.description")}</DialogDescription>
        <ResizablePanelGroup className="min-h-0 min-w-0 flex-1" orientation="horizontal">
          <ResizableSidebarPanel
            className="hidden min-w-0 sm:block"
            id="settings-sidebar"
            open={settingsSidebarOpen}
            onOpenChange={setSettingsSidebarOpen}
          >
            <aside className={cn("flex h-full min-w-0 flex-col bg-muted/20", settingsSidebarOpen ? "p-3" : "p-2")}>
              <div className={cn("flex items-center py-3", settingsSidebarOpen ? "gap-2.5 px-2" : "justify-center")}>
                <Button
                  aria-label={t("settings.title")}
                  size="icon-sm"
                  title={settingsSidebarOpen ? undefined : t("settings.title")}
                  onClick={() => setSettingsSidebarOpen((current) => !current)}
                >
                  <SettingsIcon />
                </Button>
                {settingsSidebarOpen ? (
                  <span>
                    <DialogTitle>{t("settings.title")}</DialogTitle>
                    <span className="block text-xs text-muted-foreground">Pinar</span>
                  </span>
                ) : null}
              </div>
              <nav aria-label={t("settings.title")} className="mt-2 flex flex-col gap-1">
                <Button
                  aria-label={t("settings.general")}
                  aria-current={section === "general" ? "page" : undefined}
                  className={settingsNavButtonClass(!settingsSidebarOpen, section === "general")}
                  title={settingsSidebarOpen ? undefined : t("settings.general")}
                  variant="ghost"
                  onClick={() => setSection("general")}
                >
                  <SlidersHorizontalIcon />
                  {settingsSidebarOpen ? t("settings.general") : null}
                </Button>
                <Button
                  aria-label={t("settings.capture")}
                  aria-current={section === "capture" ? "page" : undefined}
                  className={settingsNavButtonClass(!settingsSidebarOpen, section === "capture")}
                  title={settingsSidebarOpen ? undefined : t("settings.capture")}
                  variant="ghost"
                  onClick={() => setSection("capture")}
                >
                  <ShieldCheckIcon />
                  {settingsSidebarOpen ? t("settings.capture") : null}
                </Button>
                <Button
                  aria-label={t("settings.interface")}
                  aria-current={section === "interface" ? "page" : undefined}
                  className={settingsNavButtonClass(!settingsSidebarOpen, section === "interface")}
                  title={settingsSidebarOpen ? undefined : t("settings.interface")}
                  variant="ghost"
                  onClick={() => setSection("interface")}
                >
                  <MonitorIcon />
                  {settingsSidebarOpen ? t("settings.interface") : null}
                </Button>
              </nav>
            </aside>
          </ResizableSidebarPanel>
          <ResizableHandle className="hidden bg-sidebar-border sm:flex" withHandle />
          <ResizablePanel className="flex min-h-0 min-w-0" id="settings-content" minSize="20rem">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <header className="flex min-h-20 shrink-0 items-center justify-between gap-4 border-b px-5 py-3">
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
                  <div className="overflow-hidden rounded-xl border bg-card">
                    <SettingRow description={t("settings.languageDescription")} title={t("common.language")}>
                      <Select
                        items={SERVER_LANGUAGES.map((candidate) => ({ label: languageName(candidate), value: candidate }))}
                        value={language}
                        onValueChange={(value) => {
                          if (value && isSupportedLanguage(value)) setLanguage(value);
                        }}
                      >
                        <SelectTrigger aria-label={t("common.language")} className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent align="end">
                          <SelectGroup>
                            {SERVER_LANGUAGES.map((candidate) => <SelectItem key={candidate} value={candidate}>{languageName(candidate)}</SelectItem>)}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </SettingRow>
                  </div>
                </section>
                <section className={cn("flex flex-col gap-5", section !== "capture" && "hidden")}>
                  <div className="overflow-hidden rounded-xl border bg-card">
                    <SettingRow description={t("settings.handoffModeDescription")} title={t("settings.handoffMode")}>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">
                          {handoffMode === "full" ? t("settings.handoffModeFull") : t("settings.handoffModeCompact")}
                        </span>
                        <Switch
                          aria-label={t("settings.handoffMode")}
                          checked={handoffMode === "full"}
                          onCheckedChange={(checked) => void setHandoffMode(checked ? "full" : "compact")}
                        />
                      </div>
                    </SettingRow>
                    <SettingRow description={t("dashboard.includeScreenshotHint")} title={t("dashboard.includeScreenshot")}>
                      <Switch
                        aria-label={t("dashboard.includeScreenshot")}
                        checked={includeScreenshot}
                        disabled={!available}
                        onCheckedChange={(value) => void setIncludeScreenshot(value)}
                      />
                    </SettingRow>
                  </div>
                </section>
                <section className={cn("flex flex-col gap-5", section !== "interface" && "hidden")}>
                  <div className="overflow-hidden rounded-xl border bg-card">
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
                  </div>
                </section>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </DialogContent>
    </Dialog>
  );
}
