import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pinar/ui";
import { pinarRuntime } from "@/lib/server-header";
import CircleHelpIcon from "~icons/lucide/circle-help";

interface AiCreditCostHintProps {
  label: string;
}

export function AiCreditCostHint({ label }: AiCreditCostHintProps) {
  if (pinarRuntime() !== "cloud") return null;

  return (
    <TooltipProvider delay={0}>
      <Tooltip>
        <TooltipTrigger
          aria-label={label}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          type="button"
        >
          <CircleHelpIcon aria-hidden="true" className="size-3" />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
