// Copiado de zommehq/shared src/ui/components/ui/spinner.tsx no commit c15fd2d (os componentes de chat da Skia), adaptado aos ícones lucide e aos tokens do Pinar.
import type React from "react";
import LoaderCircleIcon from "~icons/lucide/loader-circle";
import { cn } from "../lib/utils.js";

function Spinner({ className, ...props }: Omit<React.ComponentProps<"svg">, "strokeWidth">) {
  return <LoaderCircleIcon className={cn("size-4 animate-spin", className)} {...props} />;
}

export { Spinner };
