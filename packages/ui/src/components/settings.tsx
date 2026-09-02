import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/utils";

/**
 * The one anatomy for a settings surface, shared by the workspace dialog and
 * the extension Options: a muted uppercase section heading, then rows made of
 * a title, a regular-size description and a control on the right.
 */
export function SectionHeading({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn("text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", className)}
      data-slot="section-heading"
      {...props}
    />
  );
}

export function SettingRow({
  children,
  className,
  controlClassName,
  description,
  layout = "inline",
  size = "sm",
  title,
}: {
  children?: ReactNode;
  className?: string;
  controlClassName?: string;
  description?: ReactNode;
  layout?: "inline" | "stack";
  size?: "sm" | "xs";
  title: ReactNode;
}) {
  const compact = size === "xs";
  const stacked = layout === "stack";
  return (
    <div
      className={cn(
        "flex",
        stacked ? "flex-col gap-2" : cn("items-center", compact ? "gap-4" : "gap-6"),
        className,
      )}
      data-layout={layout}
      data-slot="setting-row"
    >
      <div className={stacked ? "min-w-0" : "min-w-0 flex-1"}>
        <p className={compact ? "text-xs font-semibold" : "text-sm font-medium"}>{title}</p>
        {description ? (
          <p className={cn("text-muted-foreground", compact ? "mt-0.5 text-xs" : "mt-0.5 text-sm leading-5")}>{description}</p>
        ) : null}
      </div>
      {children ? (
        <div className={cn(stacked ? "w-full" : "flex shrink-0 justify-end", controlClassName)}>{children}</div>
      ) : null}
    </div>
  );
}
