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
  title,
}: {
  children?: ReactNode;
  className?: string;
  controlClassName?: string;
  description?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-6", className)} data-slot="setting-row">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className={cn("flex shrink-0 justify-end", controlClassName)}>{children}</div> : null}
    </div>
  );
}
