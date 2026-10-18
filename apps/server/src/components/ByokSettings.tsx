// F5/S4: the BYOK endpoint subpanel of the Cloud AI section (F5 contract
// §0, §2 and §5). It is self-contained, like AgentAccessSettings: it reads
// GET /api/byok when open, drives the form (PUT and the POST /api/byok/test
// the save triggers) and the delete (DELETE after an AlertDialog), and
// shows the origin of every capability — the user's endpoint when it
// passed the test (no credits), Pinar credits with the cause when it did
// not, and untested while there is no result.
//
// Availability (S4): with a 503 byok_unavailable the subpanel does not
// appear, not even with a "coming soon" — the BYOK is an add-on and the
// section is Pro-only, so there is nothing else to show. The key is a
// password field: after a save only its last four characters are shown and
// the draft never stays in state, so it cannot reach a log or a toast.
import { useCallback, useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Input,
  SectionHeading,
  toast,
} from "@pinar/ui";
import { isRecord } from "@/lib/api-data";
import { byokCauseMessageKey } from "@/lib/ai-error-presentation";
import { useServerI18n, type ServerMessageKey, type Translate } from "@/lib/i18n";
import LoaderCircleIcon from "~icons/lucide/loader-circle";
import Trash2Icon from "~icons/lucide/trash-2";

// F5/S1: the view of GET /api/byok and of the PUT/DELETE answers: the
// configured endpoint without the key (at most its last four characters).
export interface ByokCapability {
  error: string | null;
  ok: boolean | null;
  testedAt: string | null;
}

export interface ByokCapabilities {
  chat: ByokCapability;
  embeddings: ByokCapability & { dims: number | null };
  tools: ByokCapability;
  transcription: ByokCapability;
  vision: ByokCapability;
}

export interface ByokView {
  baseUrl: string | null;
  capabilities: ByokCapabilities;
  configured: boolean;
  keyLast4: string | null;
  models: { chat: string | null; embedding: string | null; transcription: string | null };
  updatedAt: string | null;
}

export interface ByokDrafts {
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  transcriptionModel: string;
}

export const BYOK_DRAFTS_EMPTY: ByokDrafts = { baseUrl: "", chatModel: "", embeddingModel: "", transcriptionModel: "" };

function byokCapabilityFrom(value: unknown): ByokCapability {
  if (!isRecord(value)) return { error: null, ok: null, testedAt: null };
  return {
    error: typeof value.error === "string" ? value.error : null,
    ok: typeof value.ok === "boolean" ? value.ok : null,
    testedAt: typeof value.testedAt === "string" ? value.testedAt : null,
  };
}

function byokNullableString(value: unknown): string | null {
  return value === null || typeof value === "string" ? value : null;
}

/**
 * The view shape the UI trusts: anything else (a 4xx error body, a partial
 * or malformed answer) is null, so the subpanel degrades to hidden/empty
 * instead of rendering a wrong state.
 */
export function byokViewFrom(value: unknown): ByokView | null {
  if (!isRecord(value)) return null;
  if (value.configured !== true && value.configured !== false) return null;
  if (!isRecord(value.capabilities) || !isRecord(value.models)) return null;
  const capabilities = value.capabilities;
  const embeddings = byokCapabilityFrom(capabilities.embeddings);
  const dims = isRecord(capabilities.embeddings) && typeof capabilities.embeddings.dims === "number"
    ? capabilities.embeddings.dims
    : null;
  const models = value.models;
  return {
    baseUrl: byokNullableString(value.baseUrl),
    capabilities: {
      chat: byokCapabilityFrom(capabilities.chat),
      embeddings: { ...embeddings, dims },
      tools: byokCapabilityFrom(capabilities.tools),
      transcription: byokCapabilityFrom(capabilities.transcription),
      vision: byokCapabilityFrom(capabilities.vision),
    },
    configured: value.configured === true,
    keyLast4: byokNullableString(value.keyLast4),
    models: {
      chat: byokNullableString(models.chat),
      embedding: byokNullableString(models.embedding),
      transcription: byokNullableString(models.transcription),
    },
    updatedAt: byokNullableString(value.updatedAt),
  };
}

export type ByokCapabilitySource = "credits" | "endpoint" | "untested";

export interface ByokCapabilityRow {
  /** The short cause code when the capability rides the Pinar credits. */
  cause: string | null;
  source: ByokCapabilitySource;
  testedAt: string | null;
}

/**
 * The origin the UI shows for a capability (F5 contract §0): the user's
 * endpoint when every part is tested ok, Pinar credits when a part failed
 * (with the first cause that explains it), and untested while no part has a
 * result. "Chat with tools" passes the parts [tools, chat]: the routing
 * requires both (byokAssistantBaseOf), and the detection probes them with
 * the same call, so a failure keeps the same cause on both.
 */
export function byokCapabilityRow(
  parts: ReadonlyArray<Pick<ByokCapability, "error" | "ok" | "testedAt">>,
): ByokCapabilityRow {
  const testedAt = parts.find((part) => part.testedAt !== null)?.testedAt ?? null;
  const failed = parts.find((part) => part.ok === false);
  if (failed !== undefined) {
    const cause = failed.error ?? parts.find((part) => part.error !== null)?.error ?? null;
    return { cause, source: "credits", testedAt };
  }
  if (parts.every((part) => part.ok === true)) {
    return { cause: null, source: "endpoint", testedAt };
  }
  return { cause: null, source: "untested", testedAt };
}

/**
 * A read that did not land hides the subpanel (S4): the 503
 * byok_unavailable, any other failed answer and a body the shape check
 * rejects. The rest of the AI section keeps working.
 */
export function byokHidden(response: Response, value: unknown): boolean {
  if (!response.ok) return true;
  return byokViewFrom(value) === null;
}

/** The current view a 409 byok_changed answer carries (it reloads the subpanel). */
export function byokChangedView(value: unknown): ByokView | null {
  if (!isRecord(value) || value.code !== "byok_changed") return null;
  return byokViewFrom(value.view);
}

/** Each /api/byok error code has its own text (S4); the unknown codes fall back. */
export function byokApiErrorKey(code: string | null | undefined): ServerMessageKey {
  switch (code) {
    case "api_key_required":
      return "byok.errorApiKeyRequired";
    case "byok_changed":
      return "byok.errorChanged";
    case "byok_not_configured":
      return "byok.errorNotConfigured";
    case "byok_requires_pro":
      return "byok.errorRequiresPro";
    case "byok_test_limited":
      return "byok.errorTestLimited";
    case "byok_unavailable":
      return "byok.errorUnavailable";
    case "invalid_api_key":
      return "byok.errorInvalidApiKey";
    case "invalid_base_url":
      return "byok.errorInvalidBaseUrl";
    case "invalid_model":
      return "byok.errorInvalidModel";
    default:
      return "byok.errorUnknown";
  }
}

function byokErrorKey(value: unknown): string | null {
  return isRecord(value) && typeof value.code === "string" ? value.code : null;
}

function byokDraftsOf(view: ByokView): ByokDrafts {
  return {
    baseUrl: view.baseUrl ?? "",
    chatModel: view.models.chat ?? "",
    embeddingModel: view.models.embedding ?? "",
    transcriptionModel: view.models.transcription ?? "",
  };
}

export type ByokBusy = "idle" | "removing" | "saving" | "testing";

export interface ByokSettingsPanelProps {
  busy: ByokBusy;
  drafts: ByokDrafts;
  /** The translated error to show (null while there is none). */
  error: string | null;
  /** The key draft while a new key is being typed (empty after a save). */
  keyDraft: string;
  keyEditing: boolean;
  language: string;
  t: Translate;
  /** null = not configured yet. */
  view: ByokView | null;
  onChangeKey: () => void;
  onDraftsChange: (drafts: ByokDrafts) => void;
  onKeyDraftChange: (value: string) => void;
  onRemove: () => void;
  onSave: () => void;
  onTest: () => void;
}

/**
 * The presentational body of the subpanel: the heading and the two
 * contract sentences, the capabilities (with the tested date) when there is
 * a configured endpoint, and the form. Every state the brief names — empty,
 * saved with the masked key, testing, mixed capabilities and each error —
 * is a render of this component.
 */
export function ByokSettingsPanel({
  busy,
  drafts,
  error,
  keyDraft,
  keyEditing,
  language,
  onChangeKey,
  onDraftsChange,
  onKeyDraftChange,
  onRemove,
  onSave,
  onTest,
  t,
  view,
}: ByokSettingsPanelProps) {
  const writeBusy = busy !== "idle";
  const maskedKey = `••••${view?.keyLast4 ?? ""}`;
  const keyShown = view !== null && !keyEditing;
  const capabilities = view === null ? null : (() => {
    const rows: Array<{ id: string; label: string; row: ByokCapabilityRow }> = [
      { id: "chat-tools", label: t("byok.capabilityChatTools"), row: byokCapabilityRow([view.capabilities.tools, view.capabilities.chat]) },
      { id: "vision", label: t("byok.capabilityVision"), row: byokCapabilityRow([view.capabilities.vision]) },
      { id: "embeddings", label: t("byok.capabilityEmbeddings"), row: byokCapabilityRow([view.capabilities.embeddings]) },
      { id: "transcription", label: t("byok.capabilityTranscription"), row: byokCapabilityRow([view.capabilities.transcription]) },
    ];
    const testedAt = rows.map((item) => item.row.testedAt).find((date) => date !== null);
    return (
      <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <SectionHeading>{t("byok.capabilities")}</SectionHeading>
          {testedAt !== undefined ? (
            <span className="text-xs text-muted-foreground">
              {t("byok.lastTested", { date: new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(testedAt)) })}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col divide-y">
          {rows.map(({ id, label, row }) => (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2" key={id}>
              <div className="min-w-0">
                <p className="text-sm font-medium">{label}</p>
                {row.cause !== null ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{t(byokCauseMessageKey(row.cause))}</p>
                ) : null}
              </div>
              <Badge
                variant={row.source === "endpoint" ? "successSoft" : row.source === "credits" ? "outline" : "secondary"}
              >
                {row.source === "endpoint"
                  ? t("byok.sourceEndpoint")
                  : row.source === "credits"
                    ? t("byok.sourceCredits")
                    : t("byok.sourceUntested")}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    );
  })();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <SectionHeading>{t("byok.heading")}</SectionHeading>
        <p className="text-sm text-muted-foreground">{t("byok.description")}</p>
        <p className="text-xs leading-5 text-muted-foreground">{t("byok.providerNote")}</p>
      </div>
      {view === null ? <p className="text-sm text-muted-foreground">{t("byok.empty")}</p> : null}
      {capabilities}
      <form
        className="flex flex-col gap-3 rounded-lg border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
          {t("settings.aiEndpoint")}
          <Input
            aria-label={t("settings.aiEndpoint")}
            autoComplete="url"
            disabled={writeBusy}
            placeholder="https://provider.example.com/v1"
            value={drafts.baseUrl}
            onChange={(event) => onDraftsChange({ ...drafts, baseUrl: event.target.value })}
          />
          <span className="text-xs font-normal text-muted-foreground">{t("settings.aiEndpointDescription")}</span>
        </label>
        <div className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
          <span>{t("settings.aiKey")}</span>
          <div className="flex items-center gap-2">
            <Input
              aria-label={t("settings.aiKey")}
              autoComplete="new-password"
              className="min-w-0 flex-1"
              disabled={writeBusy || keyShown}
              placeholder={keyShown ? maskedKey : "sk-…"}
              // The saved key is only its masked tail, so it renders as text.
              type={keyShown ? "text" : "password"}
              value={keyShown ? maskedKey : keyDraft}
              onChange={(event) => onKeyDraftChange(event.target.value)}
            />
            {keyShown ? (
              <Button disabled={writeBusy} size="sm" type="button" variant="outline" onClick={onChangeKey}>
                {t("byok.changeKey")}
              </Button>
            ) : null}
          </div>
          <span className="text-xs font-normal text-muted-foreground">{t("byok.apiKeyDescription")}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
            {t("byok.chatModel")}
            <Input
              aria-label={t("byok.chatModel")}
              disabled={writeBusy}
              value={drafts.chatModel}
              onChange={(event) => onDraftsChange({ ...drafts, chatModel: event.target.value })}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
            {t("byok.embeddingModel")}
            <Input
              aria-label={t("byok.embeddingModel")}
              disabled={writeBusy}
              value={drafts.embeddingModel}
              onChange={(event) => onDraftsChange({ ...drafts, embeddingModel: event.target.value })}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium sm:col-span-2">
            {t("settings.aiTranscriptionModel")}
            <Input
              aria-label={t("settings.aiTranscriptionModel")}
              disabled={writeBusy}
              value={drafts.transcriptionModel}
              onChange={(event) => onDraftsChange({ ...drafts, transcriptionModel: event.target.value })}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{t("byok.modelDescription")}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {view !== null ? (
            <Button disabled={writeBusy} size="sm" type="button" variant="destructiveOutline" onClick={onRemove}>
              <Trash2Icon />
              {t("byok.remove")}
            </Button>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={writeBusy || view === null} type="button" variant="outline" onClick={onTest}>
              {busy === "testing" ? <LoaderCircleIcon className="animate-spin" /> : null}
              {busy === "testing" ? t("settings.aiTesting") : t("settings.aiTestConnection")}
            </Button>
            <Button disabled={writeBusy} type="submit">
              {busy === "saving" || busy === "testing" ? <LoaderCircleIcon className="animate-spin" /> : null}
              {busy === "saving" || busy === "testing" ? t("settings.aiTesting") : t("settings.aiSave")}
            </Button>
          </div>
        </div>
      </form>
      <div aria-live="polite">
        {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

/** The subpanel: reads /api/byok when open and keeps the view, the drafts,
 *  the key draft and the request state. It renders nothing until a valid
 *  view arrived — a 503 byok_unavailable (or any other failed read) keeps it
 *  hidden, not even with a "coming soon" (S4). */
export function ByokSettings({ open }: { open: boolean }) {
  const { language, t } = useServerI18n();
  const [status, setStatus] = useState<"hidden" | "loading" | "ready">("loading");
  const [view, setView] = useState<ByokView | null>(null);
  const [drafts, setDrafts] = useState<ByokDrafts>(BYOK_DRAFTS_EMPTY);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyEditing, setKeyEditing] = useState(false);
  const [busy, setBusy] = useState<ByokBusy>("idle");
  const [error, setError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    let response: Response;
    let value: unknown;
    try {
      response = await fetch("/api/byok", { cache: "no-store", signal });
      value = await response.json().catch(() => null);
    } catch {
      if (signal?.aborted) return;
      setStatus("hidden");
      return;
    }
    if (signal?.aborted) return;
    // S4: the subpanel does not appear when the view cannot be read — no
    // "coming soon", and the section is Pro-only anyway.
    if (byokHidden(response, value)) {
      setStatus("hidden");
      return;
    }
    const parsed = byokViewFrom(value);
    setView(parsed === null || !parsed.configured ? null : parsed);
    setDrafts(parsed === null ? BYOK_DRAFTS_EMPTY : byokDraftsOf(parsed));
    setKeyDraft("");
    setKeyEditing(false);
    setError(null);
    setStatus("ready");
  }, []);

  useEffect(() => {
    if (!open) {
      setStatus("loading");
      setView(null);
      setDrafts(BYOK_DRAFTS_EMPTY);
      setKeyDraft("");
      setKeyEditing(false);
      setBusy("idle");
      setError(null);
      setRemoveOpen(false);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, open]);

  // The answer of POST /api/byok/test: the new view; a 409 byok_changed
  // reloads the current view (carried by the answer, refetched otherwise)
  // and shows the cause; anything else shows its own error text.
  async function runTest() {
    setBusy("testing");
    setError(null);
    try {
      const response = await fetch("/api/byok/test", { method: "POST" });
      const value: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const parsed = byokViewFrom(value);
        if (parsed !== null) {
          setView(parsed.configured ? parsed : null);
          setDrafts(byokDraftsOf(parsed));
          return;
        }
      }
      const code = byokErrorKey(value);
      if (code === "byok_changed") {
        const carried = byokChangedView(value);
        if (carried !== null) {
          setView(carried.configured ? carried : null);
          setDrafts(byokDraftsOf(carried));
        } else {
          await load();
        }
        setError(t("byok.errorChanged"));
        return;
      }
      setError(t(byokApiErrorKey(code)));
    } catch {
      setError(t("byok.errorUnknown"));
    } finally {
      setBusy("idle");
    }
  }

  // PUT /api/byok, then the test (the save zeroes the capabilities, so the
  // test is what records the new results — F5/S1). The key is sent only
  // when the user typed a new one; it leaves the state as soon as the save
  // lands, and it never reaches an error message or a toast.
  async function save() {
    if (busy !== "idle") return;
    setBusy("saving");
    setError(null);
    try {
      const response = await fetch("/api/byok", {
        body: JSON.stringify({
          baseUrl: drafts.baseUrl,
          chatModel: drafts.chatModel,
          embeddingModel: drafts.embeddingModel,
          ...(keyDraft !== "" ? { apiKey: keyDraft } : {}),
          transcriptionModel: drafts.transcriptionModel,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(t(byokApiErrorKey(byokErrorKey(value))));
        setBusy("idle");
        return;
      }
      const parsed = byokViewFrom(value);
      if (parsed === null) {
        setError(t("byok.errorUnknown"));
        setBusy("idle");
        return;
      }
      setView(parsed.configured ? parsed : null);
      setDrafts(byokDraftsOf(parsed));
      setKeyDraft("");
      setKeyEditing(false);
      await runTest();
    } catch {
      setError(t("byok.errorUnknown"));
      setBusy("idle");
    }
  }

  // DELETE /api/byok after the AlertDialog.
  async function remove() {
    if (busy !== "idle") return;
    setBusy("removing");
    setError(null);
    try {
      const response = await fetch("/api/byok", { method: "DELETE" });
      const value: unknown = await response.json().catch(() => null);
      const parsed = byokViewFrom(value);
      if (!response.ok || parsed === null || parsed.configured) throw new Error("remove failed");
      setView(null);
      setDrafts(BYOK_DRAFTS_EMPTY);
      setKeyDraft("");
      setKeyEditing(false);
      setRemoveOpen(false);
      toast.success(t("byok.removed"));
    } catch {
      setError(t("byok.removeError"));
    } finally {
      setBusy("idle");
    }
  }

  function changeKey() {
    if (busy !== "idle") return;
    setKeyEditing(true);
    setKeyDraft("");
  }

  function test() {
    if (busy !== "idle" || view === null) return;
    void runTest();
  }

  if (!open || status !== "ready") return null;
  return (
    <div className="flex flex-col gap-4">
      <ByokSettingsPanel
        busy={busy}
        drafts={drafts}
        error={error}
        keyDraft={keyDraft}
        keyEditing={keyEditing}
        language={language}
        onChangeKey={changeKey}
        onDraftsChange={setDrafts}
        onKeyDraftChange={setKeyDraft}
        onRemove={() => setRemoveOpen(true)}
        onSave={() => {
          void save();
        }}
        onTest={test}
        t={t}
        view={view}
      />
      <AlertDialog open={removeOpen} onOpenChange={(next) => {
        if (!next) setRemoveOpen(false);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("byok.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("byok.removeDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => {
              void remove();
            }}>
              {t("byok.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
