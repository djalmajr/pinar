import type { TranslationDictionary } from "@pinar/shared";
import { Button } from "@pinar/ui";
import IconCheck from "~icons/lucide/check";
import IconCopy from "~icons/lucide/copy";
import IconExternalLink from "~icons/lucide/external-link";
import IconKeyRound from "~icons/lucide/key-round";

interface AccountCodeStripProps {
  caption: string;
  copiedCode: boolean;
  expired: boolean;
  generating: boolean;
  hostedSignInHref: string;
  t: TranslationDictionary;
  temporaryCode: string;
  onCopy?: () => void;
  onGenerate?: () => void;
}

export function AccountCodeStrip({
  caption,
  copiedCode,
  expired,
  generating,
  hostedSignInHref,
  t,
  temporaryCode,
  onCopy,
  onGenerate,
}: AccountCodeStripProps) {
  const hasCode = Boolean(temporaryCode);
  const placeholder = generating ? t.account_code_generating : t.account_code_empty;
  const generateLabel = hasCode ? t.btn_generate_another_code : t.btn_generate_code;

  return (
    <div className="flex flex-col gap-1.5">
      <div className={`flex h-12 items-center gap-1 rounded-lg border bg-background pe-1.5 ps-3 ${expired ? "opacity-70" : ""}`}>
        {hasCode ? (
          <code className={`min-w-0 flex-1 text-base font-bold tracking-[0.16em] ${expired ? "text-muted-foreground" : ""}`}>
            {temporaryCode}
          </code>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm italic text-muted-foreground" title={placeholder}>{placeholder}</span>
        )}
        <Button
          aria-label={copiedCode ? t.status_copied : t.btn_copy_code}
          className="size-9 shrink-0"
          disabled={!hasCode}
          size="icon"
          type="button"
          variant="ghost"
          onClick={onCopy}
        >
          {copiedCode ? <IconCheck className="size-4 text-emerald-500" /> : <IconCopy className="size-4" />}
        </Button>
        {hasCode ? (
          <Button
            aria-label={t.btn_open_code_entry}
            className="size-9 shrink-0"
            render={<a href={hostedSignInHref} rel="noopener noreferrer" target="_blank" />}
            size="icon"
            variant="ghost"
          >
            <IconExternalLink className="size-4" />
          </Button>
        ) : (
          <Button aria-label={t.btn_open_code_entry} className="size-9 shrink-0" disabled size="icon" type="button" variant="ghost">
            <IconExternalLink className="size-4" />
          </Button>
        )}
        <Button
          aria-busy={generating || undefined}
          aria-label={generateLabel}
          className={`size-9 shrink-0 ${generating ? "ring-2 ring-ring/50" : ""}`}
          disabled={generating}
          size="icon"
          type="button"
          variant="ghost"
          onClick={onGenerate}
        >
          <IconKeyRound className="size-4" />
        </Button>
      </div>
      {caption ? (
        <p className={`ps-[var(--radius-lg)] text-[11px] leading-relaxed ${expired ? "font-medium text-destructive" : "text-muted-foreground"}`}>
          {caption}
        </p>
      ) : null}
    </div>
  );
}
