import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  asDesignSystem,
  type DesignSystem,
  type DesignSystemExports,
  type DesignToken,
} from "@pinar/shared/design-tokens";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@pinar/ui";
import { isRecord } from "@/lib/api-data";
import { type ServerMessageKey, useServerI18n } from "@/lib/i18n";
import CheckIcon from "~icons/lucide/check";
import CopyIcon from "~icons/lucide/copy";
import DownloadIcon from "~icons/lucide/download";
import RefreshCwIcon from "~icons/lucide/refresh-cw";
import SparklesIcon from "~icons/lucide/sparkles";
import TriangleAlertIcon from "~icons/lucide/triangle-alert";

interface CollectionDesignSystemDialogProps {
  collectionId: string;
  collectionName: string;
  open: boolean;
  showAi: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ExportFile {
  contentType: string;
  fileName: string;
  key: keyof DesignSystemExports;
  labelKey: ServerMessageKey;
}

interface DesignSystemViewProps {
  designSystem: DesignSystem;
  exports: DesignSystemExports;
}

type AiRecovery = "pricing" | "retry" | "signIn" | null;

export const DESIGN_SYSTEM_CREDITS = 15;

const EXPORT_FILES: ExportFile[] = [
  { contentType: "application/json", fileName: "tokens.json", key: "tokens", labelKey: "workspace.designSystem.exportTokens" },
  { contentType: "text/css", fileName: "tokens.css", key: "css", labelKey: "workspace.designSystem.exportCss" },
  { contentType: "text/css", fileName: "theme.css", key: "tailwind", labelKey: "workspace.designSystem.exportTailwind" },
  { contentType: "text/markdown", fileName: "DESIGN.md", key: "markdown", labelKey: "workspace.designSystem.exportMarkdown" },
];

const WARNING_KEYS: Record<string, ServerMessageKey> = {
  mixed_domains: "workspace.designSystem.warningMixedDomains",
  no_styles: "workspace.designSystem.warningNoStyles",
  scattered_colors: "workspace.designSystem.warningScatteredColors",
  scattered_font_sizes: "workspace.designSystem.warningScatteredFontSizes",
  scattered_spacing: "workspace.designSystem.warningScatteredSpacing",
};

function asExports(value: unknown): DesignSystemExports | null {
  if (!isRecord(value)) return null;
  const { css, markdown, tailwind, tokens } = value;
  if (typeof css !== "string" || typeof markdown !== "string" || typeof tailwind !== "string" || typeof tokens !== "string") return null;
  return { css, markdown, tailwind, tokens };
}

function downloadText(fileName: string, contentType: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: contentType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function TokenChips({ tokens, usesLabel }: { tokens: DesignToken[]; usesLabel: (count: number) => string }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tokens.map((token) => (
        <li key={token.name}>
          <Badge className="gap-1.5 font-mono" title={usesLabel(token.count)} variant="outline">
            <span>{token.name}</span>
            <span className="text-muted-foreground">{token.value}</span>
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function DesignSystemView({ designSystem, exports }: DesignSystemViewProps) {
  const { language, t } = useServerI18n();
  const [activeExport, setActiveExport] = useState<keyof DesignSystemExports>("tokens");
  const [copiedKey, setCopiedKey] = useState("");
  const generatedAt = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(designSystem.generatedAt));
  const usesLabel = (count: number) => t("workspace.designSystem.uses", { count });

  async function copyExport(key: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((current) => (current === key ? "" : current)), 1_500);
    } catch {
      setCopiedKey("");
    }
  }

  function warningText(warning: string) {
    const separator = warning.indexOf(":");
    const code = separator > 0 ? warning.slice(0, separator) : warning;
    const detail = separator > 0 ? warning.slice(separator + 1).trim() : "";
    const key = WARNING_KEYS[code];
    return key ? t(key, { detail }) : warning;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>
          {t("workspace.designSystem.sample", {
            domain: designSystem.sample.domain,
            pages: designSystem.sample.pages,
            pins: designSystem.sample.pins,
          })}
        </span>
        <span>
          {designSystem.model
            ? t("workspace.designSystem.generatedWith", { date: generatedAt, model: designSystem.model })
            : t("workspace.designSystem.generated", { date: generatedAt })}
        </span>
      </div>
      {designSystem.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          {designSystem.warnings.map((warning) => (
            <li className="flex items-start gap-2" key={warning}>
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>{warningText(warning)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {designSystem.identity ? (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">{t("workspace.designSystem.identity")}</h3>
          <p className="text-sm leading-relaxed text-foreground">{designSystem.identity}</p>
        </section>
      ) : null}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("workspace.designSystem.colors")}</h3>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {designSystem.colors.map((token) => (
            <li className="flex items-center gap-2 rounded-md border p-2" key={token.name}>
              <span aria-hidden="true" className="size-8 shrink-0 rounded-md border" style={{ backgroundColor: token.value }} />
              <span className="flex min-w-0 flex-col font-mono text-xs">
                <span className="truncate font-semibold">{token.name}</span>
                <span className="truncate text-muted-foreground">{token.value}</span>
                <span className="text-muted-foreground">{usesLabel(token.count)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("workspace.designSystem.typography")}</h3>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">{t("workspace.designSystem.tableToken")}</th>
                <th className="px-2 py-1.5 font-medium">{t("workspace.designSystem.tableValue")}</th>
                <th className="px-2 py-1.5 font-medium">{t("workspace.designSystem.tableLineHeight")}</th>
                <th className="px-2 py-1.5 font-medium">{t("workspace.designSystem.tableWeight")}</th>
                <th className="px-2 py-1.5 text-right font-medium">{t("workspace.designSystem.tableUses")}</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {designSystem.typography.map((token) => (
                <tr className="border-t" key={token.name}>
                  <td className="px-2 py-1.5">{token.name}</td>
                  <td className="px-2 py-1.5">{token.value}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{token.lineHeight ?? "—"}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{token.weight ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">{token.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("workspace.designSystem.spacing")}</h3>
        <TokenChips tokens={designSystem.spacing} usesLabel={usesLabel} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("workspace.designSystem.radii")}</h3>
        <TokenChips tokens={designSystem.radii} usesLabel={usesLabel} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("workspace.designSystem.shadows")}</h3>
        <TokenChips tokens={designSystem.shadows} usesLabel={usesLabel} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("workspace.designSystem.fonts")}</h3>
        <ul className="flex flex-col gap-1 text-xs">
          {designSystem.fonts.map((token) => (
            <li className="flex flex-wrap items-center gap-2" key={token.name}>
              <Badge className="font-mono" variant="outline">{token.name}</Badge>
              <span className="font-medium" style={{ fontFamily: token.value }}>{token.value}</span>
              {token.weights.length > 0 ? (
                <span className="text-muted-foreground">{t("workspace.designSystem.tableWeights")}: {token.weights.join(", ")}</span>
              ) : null}
              <span className="text-muted-foreground">{usesLabel(token.count)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("workspace.designSystem.exports")}</h3>
        <Tabs
          value={activeExport}
          onValueChange={(value) => {
            const file = EXPORT_FILES.find((candidate) => candidate.key === value);
            if (file) setActiveExport(file.key);
          }}
        >
          <TabsList aria-label={t("workspace.designSystem.exports")}>
            {EXPORT_FILES.map((file) => <TabsTrigger key={file.key} value={file.key}>{t(file.labelKey)}</TabsTrigger>)}
          </TabsList>
          {EXPORT_FILES.map((file) => (
            <TabsContent className="flex flex-col gap-2" key={file.key} value={file.key}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">{file.fileName}</span>
                <div className="flex gap-1">
                  <Button size="sm" type="button" variant="ghost" onClick={() => void copyExport(file.key, exports[file.key])}>
                    {copiedKey === file.key ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
                    {copiedKey === file.key ? t("common.copied") : t("workspace.designSystem.copy")}
                  </Button>
                  <Button size="sm" type="button" variant="ghost" onClick={() => downloadText(file.fileName, file.contentType, exports[file.key])}>
                    <DownloadIcon data-icon="inline-start" />
                    {t("workspace.designSystem.download")}
                  </Button>
                </div>
              </div>
              <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
                <code>{exports[file.key]}</code>
              </pre>
            </TabsContent>
          ))}
        </Tabs>
      </section>
    </div>
  );
}

export function CollectionDesignSystemDialog({
  collectionId,
  collectionName,
  open,
  showAi,
  onOpenChange,
}: CollectionDesignSystemDialogProps) {
  const { language, t } = useServerI18n();
  const [designSystem, setDesignSystem] = useState<DesignSystem | null>(null);
  const [exports, setExports] = useState<DesignSystemExports | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiRecovery, setAiRecovery] = useState<AiRecovery>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    void (async () => {
      try {
        const response = await fetch(`/api/collections/${encodeURIComponent(collectionId)}/design-system`);
        const data: unknown = await response.json();
        if (cancelled) return;
        if (!response.ok || !isRecord(data)) {
          setLoadError(t("workspace.designSystem.loadFailed"));
          return;
        }
        setDesignSystem(asDesignSystem(data.designSystem));
        setExports(asExports(data.exports));
      } catch {
        if (!cancelled) setLoadError(t("workspace.designSystem.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collectionId, open, t]);

  async function reloadExports() {
    const response = await fetch(`/api/collections/${encodeURIComponent(collectionId)}/design-system`);
    const data: unknown = await response.json();
    if (!response.ok || !isRecord(data)) return;
    setDesignSystem(asDesignSystem(data.designSystem));
    setExports(asExports(data.exports));
  }

  async function extract() {
    if (extracting) return;
    setAiError("");
    setAiRecovery(null);
    setExtracting(true);
    requestId.current ||= `ai_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      const response = await fetch("/api/ai/design-system", {
        body: JSON.stringify({ collectionId, language, requestId: requestId.current }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const data: unknown = await response.json();
      const result = isRecord(data) ? asDesignSystem(data.result) : null;
      if (!response.ok || !result) {
        const code = isRecord(data) && typeof data.code === "string" ? data.code : "";
        if (code !== "ai_request_in_progress" && code !== "ai_refund_pending") requestId.current = null;
        if (response.status === 401) {
          setAiError(t("viewer.aiSignIn"));
          setAiRecovery("signIn");
        } else if (code === "insufficient_sample") {
          const pins = isRecord(data) && typeof data.pins === "number" ? data.pins : 0;
          const minimum = isRecord(data) && typeof data.minimum === "number" ? data.minimum : 3;
          setAiError(t("workspace.designSystem.insufficientSample", { count: pins, minimum }));
          setAiRecovery(null);
        } else if (code === "insufficient_ai_credits") {
          setAiError(t("viewer.aiNoCredits"));
          setAiRecovery("pricing");
        } else if (code === "ai_rate_limited") {
          setAiError(t("viewer.aiRateLimited"));
          setAiRecovery("retry");
        } else if (code === "ai_refund_pending") {
          setAiError(t("viewer.aiRefundPending"));
          setAiRecovery("retry");
        } else {
          setAiError(t("viewer.aiUnavailable"));
          setAiRecovery("retry");
        }
        return;
      }
      requestId.current = null;
      if (isRecord(data) && isRecord(data.aiCredits) && typeof data.aiCredits.balance === "number") {
        setCreditsRemaining(data.aiCredits.balance);
      }
      setDesignSystem(result);
      await reloadExports();
    } catch {
      setAiError(t("viewer.aiNetworkError"));
      setAiRecovery("retry");
    } finally {
      setExtracting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(46rem,calc(100dvh-2rem))] w-[min(64rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-none">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex min-w-0 flex-col">
            <DialogTitle>{t("workspace.designSystem.title")}</DialogTitle>
            <DialogDescription className="truncate text-xs text-muted-foreground">
              {t("workspace.designSystem.description", { name: collectionName })}
            </DialogDescription>
          </div>
          {showAi ? (
            <div className="flex flex-wrap items-center gap-2">
              {creditsRemaining !== null ? (
                <span className="text-xs text-muted-foreground">{t("workspace.designSystem.creditsRemaining", { count: creditsRemaining })}</span>
              ) : null}
              <Button
                disabled={extracting || loading}
                title={t("workspace.designSystem.cost", { count: DESIGN_SYSTEM_CREDITS })}
                type="button"
                variant="outline"
                onClick={() => void extract()}
              >
                {designSystem ? <RefreshCwIcon data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />}
                {extracting
                  ? t("workspace.designSystem.extracting")
                  : designSystem
                    ? t("workspace.designSystem.extractAgain")
                    : t("workspace.designSystem.extract")}
                <Badge className="ml-1" variant="secondary">{t("workspace.designSystem.cost", { count: DESIGN_SYSTEM_CREDITS })}</Badge>
              </Button>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {aiError ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <span>{aiError}</span>
              {aiRecovery === "signIn" ? (
                <Button render={<a href={`/sign-in?returnTo=${encodeURIComponent("/app")}`} />} size="sm" variant="outline">
                  {t("viewer.aiSignInAction")}
                </Button>
              ) : aiRecovery === "pricing" ? (
                <Button render={<Link preload="intent" to="/pricing" />} size="sm" variant="outline">
                  {t("viewer.aiViewPlans")}
                </Button>
              ) : aiRecovery === "retry" ? (
                <Button size="sm" type="button" variant="outline" onClick={() => void extract()}>
                  {t("viewer.aiRetry")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {loading ? (
            <div aria-busy="true" className="flex flex-col gap-3">
              <span className="sr-only">{t("workspace.designSystem.loading")}</span>
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : designSystem && exports ? (
            <DesignSystemView designSystem={designSystem} exports={exports} />
          ) : (
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <p>{t("workspace.designSystem.empty")}</p>
              <p>{t("workspace.designSystem.emptyHint")}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
