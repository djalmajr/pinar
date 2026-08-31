import { type ComponentProps, useEffect } from "react";
import { ResizablePanel, useResizablePanelRef } from "@pinar/ui";

const SIDEBAR_COLLAPSED_WIDTH = 48;
const SIDEBAR_DEFAULT_WIDTH = 250;

interface ResizableSidebarPanelProps extends Omit<ComponentProps<typeof ResizablePanel>, "children" | "id" | "onResize"> {
  children: ComponentProps<typeof ResizablePanel>["children"];
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWidthChange?: (width: number) => void;
}

function ResizableSidebarPanel({
  children,
  className,
  id,
  open,
  onOpenChange,
  onWidthChange,
  ...props
}: ResizableSidebarPanelProps) {
  const panelRef = useResizablePanelRef();

  useEffect(() => {
    if (open) panelRef.current?.expand();
    else panelRef.current?.collapse();
  }, [open, panelRef]);

  return (
    <ResizablePanel
      className={className}
      collapsible
      collapsedSize={`${SIDEBAR_COLLAPSED_WIDTH}px`}
      defaultSize={`${SIDEBAR_DEFAULT_WIDTH}px`}
      groupResizeBehavior="preserve-pixel-size"
      id={id}
      maxSize="28rem"
      minSize="12rem"
      panelRef={panelRef}
      onResize={({ inPixels }) => {
        const collapsed = inPixels <= SIDEBAR_COLLAPSED_WIDTH + 1;
        if (!collapsed) onWidthChange?.(inPixels);
        if (collapsed === open) onOpenChange(!collapsed);
      }}
      {...props}
    >
      {children}
    </ResizablePanel>
  );
}

export {
  ResizableSidebarPanel,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
};
