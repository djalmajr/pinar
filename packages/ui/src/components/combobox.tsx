import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import IconCheck from "~icons/lucide/check";
import IconChevronDown from "~icons/lucide/chevron-down";
import { cn } from "../lib/utils.js";

const Combobox = ComboboxPrimitive.Root;

function ComboboxInput({
  className,
  disabled = false,
  ...props
}: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.InputGroup
      className={cn(
        "flex h-7 w-full items-center overflow-hidden rounded-[min(var(--radius-md),10px)] border border-input bg-transparent transition-colors outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-50 dark:bg-input/30",
        className,
      )}
      data-slot="combobox-input"
    >
      <ComboboxPrimitive.Input
        className="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground"
        disabled={disabled}
        {...props}
      />
      <ComboboxPrimitive.Trigger
        aria-label="Toggle options"
        className="flex size-7 shrink-0 items-center justify-center text-muted-foreground outline-none"
        disabled={disabled}
      >
        <IconChevronDown />
      </ComboboxPrimitive.Trigger>
    </ComboboxPrimitive.InputGroup>
  );
}

function ComboboxContent({
  align = "start",
  alignOffset = 0,
  className,
  side = "bottom",
  sideOffset = 4,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<ComboboxPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
        side={side}
        sideOffset={sideOffset}
      >
        <ComboboxPrimitive.Popup
          className={cn(
            "group/combobox-content relative max-h-(--available-height) w-(--anchor-width) min-w-48 origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          data-slot="combobox-content"
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      className={cn("no-scrollbar max-h-72 overflow-y-auto overscroll-contain p-1 data-empty:p-0", className)}
      data-slot="combobox-list"
      {...props}
    />
  );
}

function ComboboxItem({
  children,
  className,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      data-slot="combobox-item"
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={<span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />}
      >
        <IconCheck />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      className={cn(
        "hidden w-full justify-center px-3 py-2 text-center text-sm text-muted-foreground group-data-empty/combobox-content:flex",
        className,
      )}
      data-slot="combobox-empty"
      {...props}
    />
  );
}

export {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
};
