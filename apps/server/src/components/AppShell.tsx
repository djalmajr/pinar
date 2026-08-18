import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  SidebarProvider,
  SidebarTrigger,
  useResizablePanelRef,
  useSidebar,
} from "@pinar/ui";
import { SERVER_LANGUAGES, useServerI18n } from "@/lib/i18n";
import CheckIcon from "~icons/lucide/check";
import ChevronRightIcon from "~icons/lucide/chevron-right";
import LanguagesIcon from "~icons/lucide/languages";
import MoonIcon from "~icons/lucide/moon";
import SunIcon from "~icons/lucide/sun";

interface AppShellProps {
  children: ReactNode;
  className?: string;
  projectActions?: ReactNode;
  projectSelector: (compact: boolean) => ReactNode;
  sidebar: ReactNode;
  workspace?: string;
}

const SIDEBAR_COLLAPSED_WIDTH = 48;
const SIDEBAR_DEFAULT_WIDTH = 250;

function AppHeader({
  projectActions,
  projectSelector,
  workspace,
}: Pick<AppShellProps, "projectActions" | "projectSelector" | "workspace">) {
  const { language, languageName, setLanguage, t } = useServerI18n();
  const { isMobile, state } = useSidebar();
  const [isDark, setIsDark] = useState(false);
  const compact = !isMobile && state === "collapsed";

  useEffect(() => setIsDark(document.documentElement.classList.contains("dark")), []);

  function toggleTheme() {
    const nextDark = !isDark;
    setIsDark(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
    document.documentElement.dataset.theme = nextDark ? "dark" : "light";
    localStorage.setItem("pinar-theme", nextDark ? "dark" : "light");
  }

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center border-b bg-card/95 backdrop-blur">
      <div
        className={cn(
          "flex h-full shrink-0 items-center border-r border-sidebar-border bg-sidebar px-2 text-sidebar-foreground transition-none",
          isMobile
            ? "min-w-0 flex-1"
            : compact
              ? "w-[calc(var(--sidebar-width-icon)+1px)]"
              : "w-[calc(var(--sidebar-width)+1px)]",
        )}
      >
        {projectSelector(compact)}
      </div>
      <div className="hidden min-w-0 flex-1 items-center gap-3 px-3 md:flex">
        <SidebarTrigger aria-label={t("dashboard.collections")} title={t("dashboard.collections")} />
        <Link
          aria-label={t("common.pinarHome")}
          className="shrink-0"
          preload="intent"
          to="/app"
        >
          <span className="text-sm font-semibold">Pinar</span>
        </Link>
        {workspace && (
          <>
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm">{workspace}</span>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 px-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button aria-label={t("common.language")} size="icon-sm" title={`${t("common.language")}: ${languageName(language)}`} variant="ghost" />}>
            <LanguagesIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuGroup>
              {SERVER_LANGUAGES.map((candidate) => (
                <DropdownMenuItem key={candidate} onClick={() => setLanguage(candidate)}>
                  <span className="flex-1">{languageName(candidate)}</span>
                  {candidate === language && <CheckIcon />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button aria-label={t("common.toggleTheme")} size="icon-sm" title={t("common.toggleTheme")} variant="ghost" onClick={toggleTheme}>
          {isDark ? <SunIcon /> : <MoonIcon />}
        </Button>
        {projectActions}
      </div>
    </header>
  );
}

function AppWorkspace({
  children,
  sidebar,
  onSidebarWidthChange,
}: Pick<AppShellProps, "children" | "sidebar"> & {
  onSidebarWidthChange: (width: number) => void;
}) {
  const { isMobile, open, setOpen } = useSidebar();
  const sidebarPanelRef = useResizablePanelRef();

  useEffect(() => {
    if (isMobile) return;
    if (open) sidebarPanelRef.current?.expand();
    else sidebarPanelRef.current?.collapse();
  }, [isMobile, open, sidebarPanelRef]);

  if (isMobile) {
    return <div className="flex min-h-0 flex-1">{sidebar}{children}</div>;
  }

  return (
    <ResizablePanelGroup className="min-h-0 flex-1" orientation="horizontal">
      <ResizablePanel
        className="h-full min-w-0"
        collapsible
        collapsedSize={`${SIDEBAR_COLLAPSED_WIDTH}px`}
        defaultSize={`${SIDEBAR_DEFAULT_WIDTH}px`}
        groupResizeBehavior="preserve-pixel-size"
        id="app-sidebar"
        maxSize="28rem"
        minSize="12rem"
        panelRef={sidebarPanelRef}
        onResize={({ inPixels }) => {
          const collapsed = inPixels <= SIDEBAR_COLLAPSED_WIDTH + 1;
          if (!collapsed) onSidebarWidthChange(inPixels);
          if (collapsed === open) setOpen(!collapsed);
        }}
      >
        {sidebar}
      </ResizablePanel>
      <ResizableHandle className="bg-sidebar-border" withHandle />
      <ResizablePanel className="flex min-h-0 min-w-0" id="app-content" minSize="20rem">
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export function AppShell({
  children,
  className,
  projectActions,
  projectSelector,
  sidebar,
  workspace,
}: AppShellProps) {
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const sidebarStyle = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties;

  return (
    <SidebarProvider
      className={cn("h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground", className)}
      style={sidebarStyle}
    >
      <AppHeader
        projectActions={projectActions}
        projectSelector={projectSelector}
        workspace={workspace}
      />
      <AppWorkspace sidebar={sidebar} onSidebarWidthChange={setSidebarWidth}>
        {children}
      </AppWorkspace>
    </SidebarProvider>
  );
}
