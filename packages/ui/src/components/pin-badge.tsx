import { cn } from "../lib/utils.js";

interface PinBadgeProps {
  className?: string;
  color?: string;
  number: number;
}

function PinBadge({ className, color = "var(--primary)", number }: PinBadgeProps) {
  return (
    <span
      aria-label={`Pin ${number}`}
      className={cn("relative inline-flex size-7 min-h-7 min-w-7 shrink-0 items-center justify-center", className)}
      style={{ color }}
    >
      <svg aria-hidden="true" className="absolute inset-0 size-full fill-current" viewBox="0 0 28 28">
        <path d="M14 2.5c-6.35 0-11.5 4.7-11.5 10.5 0 2.38.87 4.58 2.34 6.34l-1.1 4.42a1 1 0 0 0 1.2 1.2l4.54-1.14A12.3 12.3 0 0 0 14 24.5c6.35 0 11.5-4.7 11.5-10.5S20.35 2.5 14 2.5Z" />
      </svg>
      <span className="relative -translate-y-px text-[11px] font-bold leading-none text-white">{number}</span>
    </span>
  );
}

export { PinBadge, type PinBadgeProps };
