import type { ReactNode } from "react";
import { cn } from "@pinar/ui";
import { ServerHeader, type ServerHeaderProps } from "@/components/ServerHeader";

interface ServerShellProps extends ServerHeaderProps {
  children: ReactNode;
  className?: string;
}

export function ServerShell({ children, className, ...headerProps }: ServerShellProps) {
  return (
    <div className={cn("flex h-screen flex-col overflow-hidden bg-background text-foreground", className)}>
      <ServerHeader {...headerProps} />
      {children}
    </div>
  );
}
