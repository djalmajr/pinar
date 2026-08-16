import { useState, useEffect } from "react";
import {
  Button,
  Badge,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  Switch,
  Input,
  Select,
  SelectGroup,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toaster,
  toast,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PinarMark,
  ScrollArea,
  ScrollBar,
} from "@pinar/ui";
import {
  translations,
  getBestLanguage,
  type CaptureDestination,
  type ProjectTree,
  type ProjectTreeCollection,
  type SupportedLanguage,
  type PinarSettings,
  type ThemeMode,
} from "@pinar/shared";
import IconCopy from "~icons/lucide/copy";
import IconCheck from "~icons/lucide/check";
import IconSparkles from "~icons/lucide/sparkles";
import IconGithub from "~icons/radix-icons/github-logo";
import IconHeart from "~icons/lucide/heart";
import IconExternalLink from "~icons/lucide/external-link";
import IconCoffee from "~icons/lucide/coffee";
import IconSave from "~icons/lucide/save";
import IconSun from "~icons/lucide/sun";
import IconMoon from "~icons/lucide/moon";
import IconLaptop from "~icons/lucide/laptop";
import IconRefreshCw from "~icons/lucide/refresh-cw";
import IconFolder from "~icons/lucide/folder";
import IconInbox from "~icons/lucide/inbox";
import extensionPackage from "../../package.json";

const LANGUAGE_OPTIONS: { code: SupportedLanguage; label: string }[] = [
  { code: "pt", label: "Português" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "zh", label: "简体中文" },
  { code: "ja", label: "日本語" },
];

const PREVIEW_INSTALLATION_ID_KEY = "pinar.preview.installationId";
const INSTALLATION_ID_PATTERN = /^ins_[A-Za-z0-9_-]{24}$/;
const DEFAULT_LANGUAGE = getBestLanguage();
const DEFAULT_PROJECT_OPTION = { label: "Personal", value: "__pinar_default_project__" };
const DEFAULT_COLLECTION_OPTION = { label: "Inbox", value: "__pinar_default_collection__" };

function flattenDestinationCollections(collections: ProjectTreeCollection[]) {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const children = new Map<string | null, ProjectTreeCollection[]>();
  for (const collection of collections) {
    const parentId = collection.parentId && byId.has(collection.parentId)
      ? collection.parentId
      : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(collection);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.position - right.position);
  }

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

function extensionVersion() {
  if (typeof chrome !== "undefined" && chrome.runtime?.getManifest) {
    return chrome.runtime.getManifest().version;
  }
  return extensionPackage.version;
}

const DEFAULT_SETTINGS: PinarSettings = {
  cloudToken: "",
  cloudUrl: "https://pinar.dev",
  copyViewerContent: false,
  enableHistory: true,
  includeViewer: true,
  language: DEFAULT_LANGUAGE,
  licenseKey: "",
  storageMode: "local",
  theme: "system",
  userEmail: "",
  userPlan: "free",
};

const SETTINGS_KEYS: (keyof PinarSettings)[] = [
  "cloudToken",
  "cloudUrl",
  "copyViewerContent",
  "enableHistory",
  "includeViewer",
  "language",
  "licenseKey",
  "storageMode",
  "theme",
  "userEmail",
  "userPlan",
];

type IdentityMessage = "identity:get" | "identity:regenerate";
type IdentityResponse = { error?: string; id?: string; ok?: boolean };
type DestinationMessage = "destination:get" | "destination:set";
type DestinationResponse = {
  destination?: CaptureDestination;
  error?: string;
  ok?: boolean;
  tree?: ProjectTree;
};

function areSettingsEqual(left: PinarSettings, right: PinarSettings) {
  return SETTINGS_KEYS.every((key) => left[key] === right[key]);
}

function isExtensionContext() {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id) && Boolean(chrome.runtime?.sendMessage);
}

function isLocalPreview() {
  return (
    typeof window !== "undefined" &&
    ["127.0.0.1", "localhost"].includes(window.location.hostname) &&
    ["http:", "https:"].includes(window.location.protocol)
  );
}

function createPreviewInstallationId() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `ins_${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
}

async function requestInstallationIdentity(type: IdentityMessage): Promise<IdentityResponse> {
  if (isExtensionContext()) return chrome.runtime.sendMessage({ type });
  if (!isLocalPreview()) return { error: "Installation identity is unavailable", ok: false };

  try {
    let id = localStorage.getItem(PREVIEW_INSTALLATION_ID_KEY) || "";
    if (type === "identity:regenerate" || !INSTALLATION_ID_PATTERN.test(id)) {
      id = createPreviewInstallationId();
      localStorage.setItem(PREVIEW_INSTALLATION_ID_KEY, id);
    }
    return { id, ok: true };
  } catch (error) {
    return { error: String(error instanceof Error ? error.message : error), ok: false };
  }
}

async function requestCaptureDestination(
  type: DestinationMessage,
  collectionId?: string,
): Promise<DestinationResponse> {
  if (!isExtensionContext()) return { error: "Capture destination is unavailable", ok: false };
  return chrome.runtime.sendMessage({ collectionId, type });
}

export function OptionsApp() {
  const [settings, setSettings] = useState<PinarSettings>(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<PinarSettings>(DEFAULT_SETTINGS);
  const [lang, setLang] = useState<SupportedLanguage>(DEFAULT_LANGUAGE);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [showLicenseInput, setShowLicenseInput] = useState(false);
  const [inputKey, setInputKey] = useState("");
  const [activating, setActivating] = useState(false);
  const [isWindows, setIsWindows] = useState(false);
  const [installationId, setInstallationId] = useState("");
  const [identityLoading, setIdentityLoading] = useState(true);
  const [identityDialogOpen, setIdentityDialogOpen] = useState(false);
  const [identityError, setIdentityError] = useState("");
  const [regeneratingIdentity, setRegeneratingIdentity] = useState(false);
  const [historyOpening, setHistoryOpening] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [captureDestination, setCaptureDestination] = useState<CaptureDestination | null>(null);
  const [destinationTree, setDestinationTree] = useState<ProjectTree | null>(null);
  const [destinationProjectId, setDestinationProjectId] = useState("");
  const [destinationLoading, setDestinationLoading] = useState(true);
  const [destinationError, setDestinationError] = useState("");

  const t = translations[lang] || translations.pt || translations.en;
  const hasUnsavedChanges = !areSettingsEqual(settings, savedSettings);
  const destinationProjects = destinationTree?.projects ?? [];
  const destinationProject = destinationProjects.find((project) => project.id === destinationProjectId);
  const destinationCollections = destinationProject?.collections ?? [];
  const destinationCollectionTree = flattenDestinationCollections(destinationCollections);
  const destinationProjectIds = destinationProjects.length > 0
    ? destinationProjects.map((project) => project.id)
    : [DEFAULT_PROJECT_OPTION.value];
  const destinationCollectionOptions = destinationCollections.length > 0
    ? destinationCollections.map((collection) => ({ label: collection.name, value: collection.id }))
    : [DEFAULT_COLLECTION_OPTION];
  const selectedDestinationProjectId = destinationProjectId || DEFAULT_PROJECT_OPTION.value;
  const selectedDestinationCollectionId = captureDestination?.projectId === destinationProjectId
    ? captureDestination.collectionId
    : DEFAULT_COLLECTION_OPTION.value;

  const MAC_LINUX_CMD = "curl -fsSL https://pinar.dev/install.sh | sh";
  const WIN_CMD = "irm https://pinar.dev/install.ps1 | iex";

  function applyTheme(mode: ThemeMode) {
    const isDark =
      mode === "dark" ||
      (mode === "system" &&
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    if (isDark) {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
      document.documentElement.setAttribute("data-theme", "light");
    }
  }

  async function loadCaptureDestination() {
    setDestinationLoading(true);
    setDestinationError("");
    try {
      const response = await requestCaptureDestination("destination:get");
      if (!response.ok || !response.destination || !response.tree) {
        throw new Error(response.error || t.destination_unavailable);
      }
      setCaptureDestination(response.destination);
      setDestinationProjectId(response.destination.projectId);
      setDestinationTree(response.tree);
    } catch (error) {
      setCaptureDestination(null);
      setDestinationTree(null);
      setDestinationProjectId("");
      setDestinationError(String(error instanceof Error ? error.message : error));
    } finally {
      setDestinationLoading(false);
    }
  }

  async function saveCaptureDestination(collectionId: string) {
    setDestinationLoading(true);
    setDestinationError("");
    try {
      const response = await requestCaptureDestination("destination:set", collectionId);
      if (!response.ok || !response.destination || !response.tree) {
        throw new Error(response.error || t.destination_unavailable);
      }
      setCaptureDestination(response.destination);
      setDestinationProjectId(response.destination.projectId);
      setDestinationTree(response.tree);
      toast.success(t.status_saved);
    } catch (error) {
      setDestinationError(String(error instanceof Error ? error.message : error));
      toast.error(t.destination_unavailable);
      await loadCaptureDestination();
    } finally {
      setDestinationLoading(false);
    }
  }

  function handleDestinationProjectChange(projectId: string) {
    const project = destinationProjects.find((item) => item.id === projectId);
    const collection = project?.collections.find((item) => item.isProtected) ?? project?.collections[0];
    if (!collection) return;
    setDestinationProjectId(projectId);
    void saveCaptureDestination(collection.id);
  }

  useEffect(() => {
    // Detect OS
    if (typeof chrome !== "undefined" && chrome.runtime?.getPlatformInfo) {
      chrome.runtime.getPlatformInfo((info) => {
        setIsWindows(info?.os === "win");
      });
    } else {
      setIsWindows(/win/i.test(navigator.userAgent || ""));
    }

    // Load chrome settings
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      chrome.storage.sync.get(
        {
          cloudToken: "",
          cloudUrl: "https://pinar.dev",
          copyViewerContent: false,
          enableHistory: true,
          includeViewer: true,
          language: "",
          licenseKey: "",
          storageMode: "local",
          userEmail: "",
          userPlan: "free",
          theme: "system",
        },
        (items) => {
          let cloudUrl = items.cloudUrl || "https://pinar.dev";
          if (cloudUrl.includes("workers.dev") || cloudUrl.includes("djalmajr.dev")) {
            cloudUrl = "https://pinar.dev";
            chrome.storage.sync.set({ cloudUrl: "https://pinar.dev" });
          }
          const resolvedLang = getBestLanguage(items.language);
          const resolvedTheme: ThemeMode = (items.theme as ThemeMode) || "system";
          const loadedSettings: PinarSettings = {
            ...(items as PinarSettings),
            cloudUrl,
            language: resolvedLang,
            theme: resolvedTheme,
          };
          applyTheme(resolvedTheme);
          setLang(resolvedLang);
          setSettings(loadedSettings);
          setSavedSettings(loadedSettings);

          // Verify license key if present
          if (items.storageMode === "cloud" && items.licenseKey) {
            fetch(`${cloudUrl}/api/auth/verify?key=${encodeURIComponent(items.licenseKey)}`)
              .then((res) => res.json())
              .then((data) => {
                const updateVerifiedPlan = (current: PinarSettings): PinarSettings => ({
                  ...current,
                  userEmail: data.ok && data.plan === "pro" ? data.email || current.userEmail : current.userEmail,
                  userPlan: data.ok && data.plan === "pro" ? "pro" : "free",
                });
                if (data.ok && data.plan === "pro") {
                  setSettings(updateVerifiedPlan);
                  setSavedSettings(updateVerifiedPlan);
                } else if (!data.ok) {
                  setSettings(updateVerifiedPlan);
                  setSavedSettings(updateVerifiedPlan);
                }
              })
              .catch(() => {});
          }
        }
      );
    }

    requestInstallationIdentity("identity:get")
      .then((response) => {
        if (response?.ok && response.id) setInstallationId(response.id);
        else if (response?.error) setIdentityError(String(response.error));
      })
      .catch((error) => setIdentityError(String(error)))
      .finally(() => setIdentityLoading(false));

    void loadCaptureDestination();
  }, []);

  const handleCopyInstall = async () => {
    const cmd = isWindows ? WIN_CMD : MAC_LINUX_CMD;
    await navigator.clipboard.writeText(cmd);
    setCopiedInstall(true);
    setTimeout(() => setCopiedInstall(false), 2000);
  };

  const handleLanguageChange = (newLang: SupportedLanguage) => {
    setLang(newLang);
    setSettings((s) => ({ ...s, language: newLang }));
  };

  const handleThemeChange = (newTheme: ThemeMode) => {
    applyTheme(newTheme);
    setSettings((s) => ({ ...s, theme: newTheme }));
  };

  const handleSave = () => {
    if (!hasUnsavedChanges) return;
    const nextSettings = settings;
    const completeSave = () => {
      setSavedSettings(nextSettings);
      toast.success(t.status_saved);
      void loadCaptureDestination();
    };

    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      chrome.storage.sync.set(settings, () => {
        if (chrome.runtime.lastError) {
          toast.error(chrome.runtime.lastError.message);
          return;
        }
        completeSave();
      });
    } else {
      completeSave();
    }
  };

  const handleActivateLicense = async () => {
    if (!inputKey.trim()) return;
    setActivating(true);
    try {
      const endpoint = settings.cloudUrl || "https://pinar.dev";
      const res = await fetch(`${endpoint}/api/auth/verify?key=${encodeURIComponent(inputKey.trim())}`);
      const data = await res.json();
      if (data.ok && data.plan === "pro") {
        const next: PinarSettings = {
          ...settings,
          licenseKey: inputKey.trim(),
          userEmail: data.email || settings.userEmail,
          userPlan: "pro",
        };
        setSettings(next);
        setSavedSettings(next);
        chrome.storage?.sync?.set(next);
        setShowLicenseInput(false);
        setInputKey("");
        toast.success(t.status_saved);
      } else {
        alert(t.license_invalid);
      }
    } catch (err: any) {
      alert("Error verifying license: " + err.message);
    } finally {
      setActivating(false);
    }
  };

  const handleDeactivateLicense = () => {
    const next: PinarSettings = {
      ...settings,
      licenseKey: "",
      userPlan: "free",
    };
    setSettings(next);
    setSavedSettings(next);
    chrome.storage?.sync?.set(next);
  };

  const handleRegenerateIdentity = async () => {
    setRegeneratingIdentity(true);
    setIdentityError("");
    try {
      const response = await requestInstallationIdentity("identity:regenerate");
      if (!response?.ok || !response.id) throw new Error(response?.error || "Identity regeneration failed");
      setInstallationId(response.id);
      setIdentityDialogOpen(false);
      toast.success(t.identity_regenerated);
    } catch (error) {
      setIdentityError(String(error instanceof Error ? error.message : error));
    } finally {
      setRegeneratingIdentity(false);
    }
  };

  const handleOpenHistory = async () => {
    setHistoryOpening(true);
    setHistoryError("");
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        const response = await chrome.runtime.sendMessage({ type: "history:open" });
        if (!response?.ok) throw new Error(response?.error || "History is unavailable");
      } else {
        const historyUrl = settings.storageMode === "cloud"
          ? `${settings.cloudUrl}/history`
          : "http://127.0.0.1:17373/history";
        const localizedHistoryUrl = new URL(historyUrl);
        localizedHistoryUrl.searchParams.set("lang", lang);
        window.open(
          localizedHistoryUrl.toString(),
          "_blank",
          "noopener,noreferrer"
        );
      }
    } catch (error) {
      setHistoryError(String(error instanceof Error ? error.message : error));
    } finally {
      setHistoryOpening(false);
    }
  };

  return (
    <div className="h-screen w-full overflow-hidden bg-muted/50 font-sans text-foreground dark:bg-background">
      <ScrollArea className="h-full w-full">
        <div className="flex min-h-full items-center justify-center p-4">
          <div className="relative flex w-full max-w-[560px] flex-col gap-5 rounded-2xl border border-border bg-card p-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <PinarMark />
            <div>
              <div className="font-bold text-sm tracking-tight flex items-center gap-1.5">
                {t.header_title}
                <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-mono font-normal">
                  {t.extension_version_label.replace("{version}", extensionVersion())}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{t.header_desc}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              render={<a href="https://github.com/djalmajr/pinar" rel="noopener noreferrer" target="_blank" />}
              size="icon"
              title="GitHub"
              variant="outline"
            >
              <IconGithub className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <Tabs defaultValue="storage" className="gap-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="storage">{t.tab_storage}</TabsTrigger>
            <TabsTrigger value="preferences">{t.tab_preferences}</TabsTrigger>
            <TabsTrigger value="plan">{t.tab_plan}</TabsTrigger>
          </TabsList>

          <TabsContent className="flex flex-col gap-5" value="storage">
        {/* Storage Destination Section */}
        <div className="flex flex-col gap-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {t.storage_title}
          </span>

          <div className="flex flex-col gap-2">
            {/* Local Card */}
            <div
              onClick={() => setSettings((s) => ({ ...s, storageMode: "local" }))}
              className="-mx-2 flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"
            >
              <input
                type="radio"
                name="storageMode"
                checked={settings.storageMode === "local"}
                onChange={() => setSettings((s) => ({ ...s, storageMode: "local" }))}
                className="mt-1 accent-primary"
              />
              <div className="flex-1 flex flex-col gap-1 min-w-0">
                <div className="font-semibold text-xs text-foreground">{t.local_title}</div>
                <div className="text-xs text-muted-foreground leading-relaxed">{t.local_desc}</div>

                <div className="mt-1 flex flex-col" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1.5 bg-muted/60 border border-border/80 rounded-lg p-1.5 font-mono text-[11px] select-all">
                    <ScrollArea className="min-w-0 flex-1">
                      <code className="block whitespace-nowrap px-1 pb-1 text-muted-foreground">
                        {isWindows ? WIN_CMD : MAC_LINUX_CMD}
                      </code>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                    <button
                      type="button"
                      onClick={handleCopyInstall}
                      className="p-1 rounded hover:bg-background text-muted-foreground hover:text-foreground shrink-0 transition-colors cursor-pointer"
                      title={t.btn_copy}
                    >
                      {copiedInstall ? (
                        <IconCheck className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <IconCopy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Cloud Card */}
            <div
              onClick={() => setSettings((s) => ({ ...s, storageMode: "cloud" }))}
              className="-mx-2 flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"
            >
              <input
                type="radio"
                name="storageMode"
                checked={settings.storageMode === "cloud"}
                onChange={() => setSettings((s) => ({ ...s, storageMode: "cloud" }))}
                className="mt-1 accent-primary"
              />
              <div className="flex-1 flex flex-col gap-1 min-w-0">
                <div className="font-semibold text-xs text-foreground">{t.remote_title}</div>
                <div className="text-xs text-muted-foreground leading-relaxed">{t.remote_desc}</div>

                {settings.userPlan !== "pro" && (
                  <div
                    className="mt-1 rounded-lg border bg-muted/45 p-2.5"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-foreground">{t.identity_label}</div>
                        <code className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                          {identityLoading ? "…" : installationId}
                        </code>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={identityLoading || !installationId}
                        onClick={() => {
                          setIdentityError("");
                          setIdentityDialogOpen(true);
                        }}
                      >
                        <IconRefreshCw data-icon="inline-start" />
                        {t.identity_regenerate}
                      </Button>
                    </div>
                    {identityError && <p className="mt-1.5 text-[11px] font-medium text-destructive">{identityError}</p>}
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {t.capture_destination_label}
          </span>
          <Card className="gap-3 overflow-visible rounded-none py-0 ring-0" size="sm">
            <CardContent className="grid gap-3 px-0 sm:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-semibold text-foreground">{t.project_label}</span>
                <Combobox
                  autoHighlight
                  disabled={destinationLoading || destinationProjects.length === 0}
                  itemToStringLabel={(projectId) => (
                    destinationProjects.find((project) => project.id === String(projectId))?.name
                    ?? DEFAULT_PROJECT_OPTION.label
                  )}
                  itemToStringValue={(projectId) => String(projectId)}
                  items={destinationProjectIds}
                  value={selectedDestinationProjectId}
                  onValueChange={(value) => {
                    const projectId = String(value ?? "");
                    if (destinationProjects.some((project) => project.id === projectId)) {
                      handleDestinationProjectChange(projectId);
                    }
                  }}
                >
                  <ComboboxInput
                    aria-label={t.project_label}
                    className="w-full"
                    placeholder={destinationLoading ? "…" : t.project_label}
                  />
                  <ComboboxContent>
                    <ComboboxEmpty>{t.no_projects_found}</ComboboxEmpty>
                    <ComboboxList>
                      {(projectId) => {
                        const project = destinationProjects.find((item) => item.id === String(projectId));
                        return project ? (
                          <ComboboxItem
                            disabled={project.collections.length === 0}
                            key={project.id}
                            value={project.id}
                          >
                            {project.name}
                          </ComboboxItem>
                        ) : null;
                      }}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </label>
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-semibold text-foreground">{t.collection_label}</span>
                <Select
                  disabled={destinationLoading || destinationCollections.length === 0}
                  items={destinationCollectionOptions}
                  value={selectedDestinationCollectionId}
                  onValueChange={(value) => void saveCaptureDestination(String(value))}
                >
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue placeholder={destinationLoading ? "…" : t.collection_label} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {destinationCollectionTree.length > 0 ? destinationCollectionTree.map(({ collection, depth }) => (
                          <SelectItem key={collection.id} value={collection.id}>
                            <span
                              className="flex min-w-0 items-center gap-2"
                              style={{ paddingInlineStart: `${depth * 16}px` }}
                            >
                              {collection.isProtected ? <IconInbox /> : <IconFolder />}
                              <span className="truncate">{collection.name}</span>
                            </span>
                          </SelectItem>
                        )) : (
                          <SelectItem disabled value={DEFAULT_COLLECTION_OPTION.value}>
                            <IconInbox />
                            Inbox
                          </SelectItem>
                        )}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>
              {destinationError && (
                <p className="text-xs text-destructive sm:col-span-2">{t.destination_unavailable}</p>
              )}
            </CardContent>
          </Card>
        </div>
          </TabsContent>

          <TabsContent value="plan">
          <Card className="gap-3 overflow-visible rounded-none py-0 ring-0" size="sm">
            <CardHeader className="px-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{settings.userPlan === "pro" ? t.plan_pro : t.plan_free}</CardTitle>
                  <CardDescription className="mt-1 text-xs">{t.plan_section_desc}</CardDescription>
                </div>
                <Badge variant={settings.userPlan === "pro" ? "pro" : "outline"}>
                  {settings.userPlan === "pro" ? "Pro" : t.plan_free_badge}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="px-0">
              {settings.userPlan === "pro" ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <IconCheck className="size-3.5" />
                    {t.license_activated}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      render={<a href={`${settings.cloudUrl || "https://pinar.dev"}/pricing`} rel="noopener noreferrer" target="_blank" />}
                      size="sm"
                      variant="outline"
                    >
                      {t.btn_manage_sub}
                    </Button>
                    <Button className="text-muted-foreground hover:text-destructive" size="sm" variant="ghost" onClick={handleDeactivateLicense}>
                      {t.btn_deactivate}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button render={<a href="https://pinar.dev/pricing" rel="noopener noreferrer" target="_blank" />} size="sm" variant="pro">
                      <IconSparkles data-icon="inline-start" />
                      {t.btn_upgrade_pro}
                    </Button>
                    {!showLicenseInput && (
                      <Button size="sm" variant="link" onClick={() => setShowLicenseInput(true)}>
                        {t.license_have_key}
                      </Button>
                    )}
                  </div>
                  {showLicenseInput && (
                    <div className="flex items-center gap-2 pt-1">
                      <Input
                        className="h-8"
                        placeholder={t.license_placeholder}
                        type="text"
                        value={inputKey}
                        onChange={(event) => setInputKey(event.target.value)}
                      />
                      <Button disabled={activating} size="sm" onClick={handleActivateLicense}>
                        {activating ? "…" : t.btn_activate}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          </TabsContent>

        {/* Preferences Section */}
          <TabsContent value="preferences">
          <Card className="gap-3 overflow-visible rounded-none py-0 ring-0" size="sm">
            <CardContent className="flex flex-col gap-3.5 px-0">
              {/* Language Selector (Compact Content-width select) */}
              <div className="flex flex-col gap-1.5">
                <span className="font-semibold text-xs text-foreground">{t.language_label}</span>
                <Select
                  items={LANGUAGE_OPTIONS.map((option) => ({ label: option.label, value: option.code }))}
                  value={lang}
                  onValueChange={(val) => handleLanguageChange(val as SupportedLanguage)}
                >
                  <SelectTrigger size="sm" className="min-w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {LANGUAGE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.code} value={opt.code}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              {/* Theme Selector (shadcn Tabs / Segmented Control) */}
              <div className="flex flex-col gap-1.5">
                <span className="font-semibold text-xs text-foreground">{t.theme_label}</span>
                <Tabs
                  value={settings.theme || "system"}
                  onValueChange={(val) => handleThemeChange(val as ThemeMode)}
                >
                  <TabsList>
                    <TabsTrigger value="system">
                      <IconLaptop data-icon="inline-start" />
                      {t.theme_system}
                    </TabsTrigger>
                    <TabsTrigger value="light">
                      <IconSun data-icon="inline-start" className="text-amber-500" />
                      {t.theme_light}
                    </TabsTrigger>
                    <TabsTrigger value="dark">
                      <IconMoon data-icon="inline-start" className="text-blue-400" />
                      {t.theme_dark}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              {/* History Toggle (Switch on Left) */}
              <div className="flex items-start gap-3 py-1">
                <Switch
                  checked={settings.enableHistory}
                  onCheckedChange={(val) => setSettings((s) => ({ ...s, enableHistory: val }))}
                  className="mt-0.5 shrink-0"
                />
                <div className="flex flex-col gap-0.5">
                  <div className="font-semibold text-xs text-foreground">{t.history_label}</div>
                  <div className="text-xs text-muted-foreground">{t.history_desc}</div>
                </div>
              </div>
              {/* Viewer Toggle (Switch on Left - Always available for local and remote) */}
              <div className="flex items-start gap-3 py-1">
                <Switch
                  checked={settings.includeViewer}
                  onCheckedChange={(val) => setSettings((s) => ({ ...s, includeViewer: val }))}
                  className="mt-0.5 shrink-0"
                />
                <div className="flex flex-col gap-0.5">
                  <div className="font-semibold text-xs text-foreground">{t.viewer_label}</div>
                  <div className="text-xs text-muted-foreground">{t.viewer_desc}</div>
                </div>
              </div>
              <div className="flex items-start gap-3 py-1">
                <Switch
                  aria-label={t.viewer_content_label}
                  checked={settings.copyViewerContent}
                  className="mt-0.5 shrink-0"
                  disabled={!settings.includeViewer}
                  onCheckedChange={(val) => setSettings((s) => ({ ...s, copyViewerContent: val }))}
                />
                <div className="flex flex-col gap-0.5">
                  <div className="font-semibold text-xs text-foreground">{t.viewer_content_label}</div>
                  <div className="text-xs text-muted-foreground">{t.viewer_content_desc}</div>
                </div>
              </div>
            </CardContent>
          </Card>
          </TabsContent>
        </Tabs>

        {/* Actions Bar (Left: Salvar & Histórico | Right: Coffee & Support) */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* Left Actions */}
          <div className="flex items-center gap-2">
            <Button
              disabled={!hasUnsavedChanges}
              onClick={handleSave}
              variant="default"
              size="sm"
              className="h-8 text-xs font-semibold gap-1.5 shadow-none"
            >
              <IconSave className="w-3.5 h-3.5" />
              {t.btn_save}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 shadow-none"
              disabled={historyOpening}
              onClick={handleOpenHistory}
            >
              <IconExternalLink />
              {historyOpening ? "…" : t.btn_history}
            </Button>
          </div>

          {/* Right Actions: Coffee & Support Grouped */}
          <div className="flex items-center gap-2">
            <Button
              className="h-8 text-xs shadow-none"
              render={<a href="https://buymeacoffee.com/djalmajr" rel="noopener noreferrer" target="_blank" />}
              size="sm"
              variant="coffee"
            >
              <IconCoffee />
              {t.btn_coffee}
            </Button>

            <Button
              className="h-8 text-xs shadow-none"
              render={<a href="https://github.com/sponsors/djalmajr" rel="noopener noreferrer" target="_blank" />}
              size="sm"
              variant="sponsor"
            >
              <IconHeart className="fill-current" />
              {t.btn_sponsor}
            </Button>
          </div>
        </div>
        {historyError && <p className="-mt-3 text-xs font-medium text-destructive">{historyError}</p>}
          </div>
        </div>
      </ScrollArea>

      <Toaster position="bottom-center" theme={settings.theme} />

      <AlertDialog open={identityDialogOpen} onOpenChange={setIdentityDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.identity_regenerate_title}</AlertDialogTitle>
            <AlertDialogDescription>{t.identity_regenerate_desc}</AlertDialogDescription>
            {identityError && <p className="text-sm font-medium text-destructive" role="alert">{identityError}</p>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={regeneratingIdentity}>{t.btn_cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={regeneratingIdentity}
              onClick={(event) => {
                event.preventDefault();
                void handleRegenerateIdentity();
              }}
            >
              <IconRefreshCw data-icon="inline-start" />
              {regeneratingIdentity ? "…" : t.identity_regenerate}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
