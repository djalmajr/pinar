import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  asPinComponent,
  COMPONENT_TARGETS,
  type ComponentTarget,
  type Pin,
  type PinComponent,
  type Session,
} from "@pinar/shared";
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@pinar/ui";
import { isRecord } from "@/lib/api-data";
import { COMPONENT_EXPORT_CREDITS, componentBundleFiles, stackblitzForm, storeZip } from "@/lib/component-export";
import { type ServerMessageKey, useServerI18n } from "@/lib/i18n";
import CheckIcon from "~icons/lucide/check";
import CopyIcon from "~icons/lucide/copy";
import DownloadIcon from "~icons/lucide/download";
import ExternalLinkIcon from "~icons/lucide/external-link";
import RefreshCwIcon from "~icons/lucide/refresh-cw";
import SparklesIcon from "~icons/lucide/sparkles";

interface PinComponentPanelProps {
  canEdit: boolean;
  pin: Pin;
  preferredTarget: ComponentTarget | null;
  session: Session;
  sessionId: string;
  showAi: boolean;
  onPersist: (fields: Record<string, unknown>) => Promise<boolean>;
}

interface OriginalCropProps {
  box: Pin["box"];
  dpr: number;
  shotUrl: string;
  title: string;
}

interface ComponentResultProps {
  busy: boolean;
  canEdit: boolean;
  component: PinComponent;
  pin: Pin;
  session: Session;
  onRegenerate: () => void;
}

type AiRecovery = "pricing" | "retry" | "signIn" | null;

const STACKBLITZ_RUN_URL = "https://stackblitz.com/run";

const TARGET_LABEL_KEYS: Record<ComponentTarget, ServerMessageKey> = {
  html: "viewer.componentTargetHtml",
  "preact-htm": "viewer.componentTargetPreactHtm",
  "react-tailwind": "viewer.componentTargetReactTailwind",
};

function newRequestId() {
  return `ai_${crypto.randomUUID().replaceAll("-", "")}`;
}

function zipFileName(pin: Pin, component: PinComponent) {
  return `pinar-pin-${pin.number}-${component.target}.zip`;
}

function openInStackblitz(component: PinComponent) {
  const form = document.createElement("form");
  form.action = STACKBLITZ_RUN_URL;
  form.method = "post";
  form.target = "_blank";
  form.hidden = true;
  for (const [name, value] of Object.entries(stackblitzForm(component))) {
    const field = document.createElement("textarea");
    field.name = name;
    field.value = value;
    form.appendChild(field);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

function downloadZip(pin: Pin, component: PinComponent) {
  const blob = new Blob([storeZip(componentBundleFiles(component))], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = zipFileName(pin, component);
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** The captured element cut out of the page screenshot, scaled to the column width. */
function OriginalCrop({ box, dpr, shotUrl, title }: OriginalCropProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [scale, setScale] = useState(1);
  const cropWidth = box ? box.width : 0;
  const cropHeight = box ? box.height : 0;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !box) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const available = entry?.contentRect.width ?? frame.clientWidth;
      setScale(box.width > 0 ? Math.min(1, available / box.width) : 1);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [box]);

  if (!box) {
    return <img alt={title} className="w-full rounded-md border bg-muted/30" src={shotUrl} />;
  }
  return (
    <div className="w-full overflow-hidden rounded-md border bg-muted/30" ref={frameRef} style={{ height: cropHeight * scale }}>
      <div
        className="relative overflow-hidden"
        style={{ height: cropHeight, transform: `scale(${scale})`, transformOrigin: "top left", width: cropWidth }}
      >
        <img
          alt={title}
          className="absolute max-w-none"
          src={shotUrl}
          style={{
            left: -box.x,
            top: -box.y,
            width: naturalWidth ? naturalWidth / dpr : undefined,
          }}
          onLoad={(event) => setNaturalWidth(event.currentTarget.naturalWidth)}
        />
      </div>
    </div>
  );
}

function ComponentResult({ busy, canEdit, component, pin, session, onRegenerate }: ComponentResultProps) {
  const { t } = useServerI18n();
  const files = componentBundleFiles(component);
  const [activeFile, setActiveFile] = useState(files[0]?.path ?? "");
  const [copiedPath, setCopiedPath] = useState("");
  const dpr = session.page.viewport?.dpr ?? 1;
  const title = t("viewer.componentOriginal");

  async function copyFile(path: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath((current) => (current === path ? "" : current)), 1_500);
    } catch {
      setCopiedPath("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{t(TARGET_LABEL_KEYS[component.target])}</Badge>
          {component.model ? (
            <span className="text-xs text-muted-foreground">{t("viewer.componentGeneratedWith", { model: component.model })}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" type="button" variant="outline" onClick={() => downloadZip(pin, component)}>
            <DownloadIcon data-icon="inline-start" />
            {t("viewer.componentDownloadZip")}
          </Button>
          <Button size="sm" type="button" variant="outline" onClick={() => openInStackblitz(component)}>
            <ExternalLinkIcon data-icon="inline-start" />
            {t("viewer.componentOpenStackblitz")}
          </Button>
          {canEdit ? (
            <Button disabled={busy} size="sm" type="button" variant="outline" onClick={onRegenerate}>
              <RefreshCwIcon data-icon="inline-start" />
              {t("viewer.componentRegenerate")}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <figure className="flex min-w-0 flex-col gap-1">
          <figcaption className="text-xs font-medium text-muted-foreground">{title}</figcaption>
          {session.shotUrl ? (
            <OriginalCrop box={pin.box} dpr={dpr} shotUrl={session.shotUrl} title={title} />
          ) : (
            <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">{t("viewer.componentOriginalMissing")}</p>
          )}
        </figure>
        <figure className="flex min-w-0 flex-col gap-1">
          <figcaption className="text-xs font-medium text-muted-foreground">{t("viewer.componentPreview")}</figcaption>
          {component.preview ? (
            <iframe
              className="min-h-48 w-full rounded-md border bg-white"
              sandbox=""
              srcDoc={component.preview}
              title={t("viewer.componentPreview")}
            />
          ) : (
            <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">{t("viewer.componentPreviewMissing")}</p>
          )}
        </figure>
      </div>
      <Tabs value={activeFile} onValueChange={(value) => setActiveFile(String(value))}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList aria-label={t("viewer.componentFiles")}>
            {files.map((file) => <TabsTrigger key={file.path} value={file.path}>{file.path}</TabsTrigger>)}
          </TabsList>
        </div>
        {files.map((file) => (
          <TabsContent className="flex flex-col gap-2" key={file.path} value={file.path}>
            <div className="flex justify-end">
              <Button size="sm" type="button" variant="ghost" onClick={() => void copyFile(file.path, file.content)}>
                {copiedPath === file.path ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
                {copiedPath === file.path ? t("viewer.componentCopied") : t("viewer.componentCopy")}
              </Button>
            </div>
            <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
              <code>{file.content}</code>
            </pre>
          </TabsContent>
        ))}
      </Tabs>
      {component.dependencies.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">{t("viewer.componentDependencies")}</p>
          <ul className="flex flex-wrap gap-1.5">
            {component.dependencies.map((dependency) => (
              <li key={dependency}><Badge className="font-mono" variant="outline">{dependency}</Badge></li>
            ))}
          </ul>
        </div>
      ) : null}
      {component.notes.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">{t("viewer.componentNotes")}</p>
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {component.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function PinComponentPanel({ canEdit, pin, preferredTarget, session, sessionId, showAi, onPersist }: PinComponentPanelProps) {
  const { t } = useServerI18n();
  const requestId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<PinComponent | null>(null);
  const [recovery, setRecovery] = useState<AiRecovery>(null);
  const [target, setTarget] = useState<ComponentTarget>(preferredTarget ?? "html");
  const pinId = pin.pinId || pin.id || "";
  const component = pin.component ?? fresh;

  async function generate() {
    if (busy) return;
    setError("");
    setRecovery(null);
    setBusy(true);
    requestId.current ||= newRequestId();
    try {
      const response = await fetch("/api/ai/component-export", {
        body: JSON.stringify({ pinId, requestId: requestId.current, sessionId, target }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const data: unknown = await response.json();
      const result = isRecord(data) ? asPinComponent(data.result) : undefined;
      if (!response.ok || !result) {
        const code = isRecord(data) && typeof data.code === "string" ? data.code : "";
        if (code !== "ai_request_in_progress" && code !== "ai_refund_pending") requestId.current = null;
        if (response.status === 401) {
          setError(t("viewer.aiSignIn"));
          setRecovery("signIn");
        } else if (code === "snapshot_required") {
          setError(t("viewer.componentSnapshotRequired"));
        } else if (code === "insufficient_ai_credits") {
          setError(t("viewer.aiNoCredits"));
          setRecovery("pricing");
        } else if (code === "ai_rate_limited") {
          setError(t("viewer.aiRateLimited"));
          setRecovery("retry");
        } else if (code === "ai_refund_pending") {
          setError(t("viewer.aiRefundPending"));
          setRecovery("retry");
        } else {
          setError(t("viewer.aiUnavailable"));
          setRecovery("retry");
        }
        return;
      }
      if (isRecord(data) && isRecord(data.aiCredits) && typeof data.aiCredits.balance === "number") {
        setCreditsRemaining(data.aiCredits.balance);
      }
      requestId.current = null;
      setFresh(result);
      await onPersist({});
    } catch {
      setError(t("viewer.aiNetworkError"));
      setRecovery("retry");
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    if (busy) return;
    setBusy(true);
    try {
      const cleared = await onPersist({ component: null });
      if (cleared) {
        setFresh(null);
        setError("");
        setRecovery(null);
      }
    } finally {
      setBusy(false);
    }
  }

  if (component) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4">
        <ComponentResult busy={busy} canEdit={canEdit} component={component} pin={pin} session={session} onRegenerate={() => void regenerate()} />
      </div>
    );
  }

  if (!showAi) return null;

  if (!pin.snapshot) {
    return (
      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        {t("viewer.componentSnapshotRequired")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t("viewer.componentTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("viewer.componentDescription")}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("viewer.componentTarget")}
          <Select
            disabled={busy}
            items={COMPONENT_TARGETS.map((candidate) => ({ label: t(TARGET_LABEL_KEYS[candidate]), value: candidate }))}
            value={target}
            onValueChange={(value) => {
              if (value === "html" || value === "react-tailwind" || value === "preact-htm") setTarget(value);
            }}
          >
            <SelectTrigger aria-label={t("viewer.componentTarget")} className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {COMPONENT_TARGETS.map((candidate) => (
                  <SelectItem key={candidate} value={candidate}>{t(TARGET_LABEL_KEYS[candidate])}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </label>
        <Button disabled={busy} type="button" onClick={() => void generate()}>
          <SparklesIcon data-icon="inline-start" />
          {busy ? t("viewer.componentGenerating") : t("viewer.componentGenerate")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {creditsRemaining === null
            ? t("viewer.componentCost", { count: COMPONENT_EXPORT_CREDITS })
            : t("viewer.aiCreditsRemaining", { count: creditsRemaining })}
        </span>
      </div>
      {error ? (
        <div className="flex flex-col items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <p>{error}</p>
          {recovery === "signIn" ? (
            <Button
              render={<a href={`/sign-in?returnTo=${encodeURIComponent(`/v/${sessionId}`)}`} />}
              size="sm"
              variant="outline"
            >
              {t("viewer.aiSignInAction")}
            </Button>
          ) : recovery === "pricing" ? (
            <Button render={<Link preload="intent" to="/pricing" />} size="sm" variant="outline">
              {t("viewer.aiViewPlans")}
            </Button>
          ) : recovery === "retry" ? (
            <Button size="sm" type="button" variant="outline" onClick={() => void generate()}>
              {t("viewer.aiRetry")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
