import { type CSSProperties, type ReactNode, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  cn,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@pinar/ui";
import { GlobalSettingsProvider } from "@/components/GlobalSettingsDialog";
import {
  ResizableSidebarPanel,
  SIDEBAR_DEFAULT_WIDTH,
} from "@/components/ResizableSidebarPanel";
import { DeliveryPreferencesProvider } from "@/lib/delivery-preferences";
import { useServerI18n } from "@/lib/i18n";
import ChevronRightIcon from "~icons/lucide/chevron-right";

export interface WorkspaceCrumb {
  id: string | null;
  name: string;
}

interface AppShellProps {
  children: ReactNode;
  className?: string;
  onSelectWorkspace?: (id: string | null) => void;
  projectActions?: ReactNode;
  projectSelector: (compact: boolean) => ReactNode;
  sidebar: ReactNode;
  workspaceCrumbs?: WorkspaceCrumb[];
}

function AppHeader({
  onSelectWorkspace,
  projectActions,
  projectSelector,
  workspaceCrumbs = [],
}: Pick<AppShellProps, "onSelectWorkspace" | "projectActions" | "projectSelector" | "workspaceCrumbs">) {
  const { t } = useServerI18n();
  const { isMobile, state } = useSidebar();
  const compact = !isMobile && state === "collapsed";

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center border-b bg-card/95 backdrop-blur">
      <div
        className={cn(
          "flex h-full shrink-0 items-center border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-none",
          isMobile
            ? "w-auto max-w-[min(60vw,14rem)] shrink-0 px-4"
            : compact
              ? "w-[calc(var(--sidebar-width-icon)+1px)] px-2"
              : "w-[calc(var(--sidebar-width)+1px)] px-2",
        )}
      >
        {projectSelector(compact)}
      </div>
      <div className="hidden min-w-0 flex-1 items-center gap-3 px-4 md:flex">
        <SidebarTrigger aria-label={t("dashboard.collections")} title={t("dashboard.collections")} />
        <nav aria-label={t("dashboard.breadcrumb")} className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-3">
            <li className="shrink-0">
              <Link
                aria-label={t("common.pinarHome")}
                className="text-sm font-semibold"
                preload="intent"
                search={{ session: undefined }}
                to="/app"
              >
                Pinar
              </Link>
            </li>
            {workspaceCrumbs.map((crumb, index) => {
              const current = index === workspaceCrumbs.length - 1;
              return (
                <li key={crumb.id ?? "all-sessions"} className="flex min-w-0 items-center gap-3">
                  <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  {current ? (
                    <span aria-current="page" className="truncate text-sm">{crumb.name}</span>
                  ) : (
                    <Link
                      className="truncate text-sm hover:underline"
                      preload="intent"
                      search={{ session: undefined }}
                      to="/app"
                      onClick={() => onSelectWorkspace?.(crumb.id)}
                    >
                      {crumb.name}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-1 px-4">
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

  if (isMobile) {
    return <div className="flex min-h-0 flex-1">{sidebar}{children}</div>;
  }

  return (
    <ResizablePanelGroup className="min-h-0 flex-1" orientation="horizontal">
      <ResizableSidebarPanel
        className="h-full min-w-0"
        id="app-sidebar"
        open={open}
        onOpenChange={setOpen}
        onWidthChange={onSidebarWidthChange}
      >
        {sidebar}
      </ResizableSidebarPanel>
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
  onSelectWorkspace,
  projectActions,
  projectSelector,
  sidebar,
  workspaceCrumbs,
}: AppShellProps) {
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const sidebarStyle = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties;

  return (
    <DeliveryPreferencesProvider>
      <GlobalSettingsProvider>
        <SidebarProvider
          className={cn("h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground", className)}
          style={sidebarStyle}
        >
          <AppHeader
            onSelectWorkspace={onSelectWorkspace}
            projectActions={projectActions}
            projectSelector={projectSelector}
            workspaceCrumbs={workspaceCrumbs}
          />
          <AppWorkspace sidebar={sidebar} onSidebarWidthChange={setSidebarWidth}>
            {children}
          </AppWorkspace>
        </SidebarProvider>
      </GlobalSettingsProvider>
    </DeliveryPreferencesProvider>
  );
}
