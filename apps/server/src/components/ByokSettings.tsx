// F5/S4: the BYOK endpoint subpanel of the Cloud AI section (F5 contract
// §0, §2 and §5). It is self-contained, like AgentAccessSettings: it reads
// GET /api/byok when open, drives the form and the delete (DELETE after an
// AlertDialog), and shows the origin of every capability — the user's
// endpoint when it passed the test (no credits), Pinar credits with the
// cause when it did not, and untested while there is no result.
//
// One action button at a time: "Test and save" (the PUT, which tests the
// typed values and saves only when a capability passed) while there is no
// saved endpoint or the form differs from it, "Test connection" (POST
// /api/byok/test on the saved endpoint) otherwise. Only the button of the
// running action shows the spinner; the other controls are just disabled.
//
// Availability (S4): with a 503 byok_unavailable the subpanel does not
// appear, not even with a "coming soon" — the BYOK is an add-on and the
// section is Pro-only, so there is nothing else to show. The key is a
// password field: after a save only its last four characters are shown and
// the draft never stays in state, so it cannot reach a log or a toast.
import { useCallback, useEffect, useRef, useState } from "react";
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
function byokCapabilitiesFrom(capabilities: Record<string, unknown>): ByokCapabilities {
  const embeddings = byokCapabilityFrom(capabilities.embeddings);
  const dims = isRecord(capabilities.embeddings) && typeof capabilities.embeddings.dims === "number"
    ? capabilities.embeddings.dims
    : null;
  return {
    chat: byokCapabilityFrom(capabilities.chat),
    embeddings: { ...embeddings, dims },
    tools: byokCapabilityFrom(capabilities.tools),
    transcription: byokCapabilityFrom(capabilities.transcription),
    vision: byokCapabilityFrom(capabilities.vision),
  };
}

export function byokViewFrom(value: unknown): ByokView | null {
  if (!isRecord(value)) return null;
  if (value.configured !== true && value.configured !== false) return null;
  if (!isRecord(value.capabilities) || !isRecord(value.models)) return null;
  const models = value.models;
  return {
    baseUrl: byokNullableString(value.baseUrl),
    capabilities: byokCapabilitiesFrom(value.capabilities),
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

/**
 * The capabilities a 422 byok_test_failed answer carries: the result of a
 * test that was not saved (no capability passed). null for anything else.
 */
export function byokTestFailedCapabilities(value: unknown): ByokCapabilities | null {
  if (!isRecord(value) || value.code !== "byok_test_failed" || !isRecord(value.capabilities)) return null;
  return byokCapabilitiesFrom(value.capabilities);
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
    case "byok_test_failed":
      return "byok.errorTestFailed";
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

/**
 * Whether the form differs from the saved endpoint: no saved endpoint yet,
 * a draft that is not the saved value, a new key typed or "Change key"
 * active. Then the action is "Test and save"; otherwise "Test connection".
 */
export function byokFormDirty(view: ByokView | null, drafts: ByokDrafts, keyDraft: string, keyEditing: boolean): boolean {
  if (view === null || keyEditing || keyDraft !== "") return true;
  const saved = byokDraftsOf(view);
  return saved.baseUrl !== drafts.baseUrl
    || saved.chatModel !== drafts.chatModel
    || saved.embeddingModel !== drafts.embeddingModel
    || saved.transcriptionModel !== drafts.transcriptionModel;
}

/** The action in progress: only its own button shows the spinner. */
export type ByokAction = "remove" | "test" | "testSave";

export interface ByokSettingsPanelProps {
  busy: ByokAction | null;
  drafts: ByokDrafts;
  /** The translated error to show (null while there is none). */
  error: string | null;
  /** The key draft while a new key is being typed (empty after a save). */
  keyDraft: string;
  keyEditing: boolean;
  language: string;
  t: Translate;
  /** The capabilities of the last test that was not saved (a 422); null otherwise. */
  unsavedCapabilities: ByokCapabilities | null;
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
  unsavedCapabilities,
  view,
}: ByokSettingsPanelProps) {
  const writeBusy = busy !== null;
  const dirty = byokFormDirty(view, drafts, keyDraft, keyEditing);
  const maskedKey = `••••${view?.keyLast4 ?? ""}`;
  const keyShown = view !== null && !keyEditing;
  // A 422 shows the result of the test that was not saved in the same list,
  // marked as such; otherwise the list is the saved endpoint's.
  const shown = unsavedCapabilities ?? view?.capabilities ?? null;
  const capabilities = shown === null ? null : (() => {
    const rows: Array<{ id: string; label: string; row: ByokCapabilityRow }> = [
      { id: "chat-tools", label: t("byok.capabilityChatTools"), row: byokCapabilityRow([shown.tools, shown.chat]) },
      { id: "vision", label: t("byok.capabilityVision"), row: byokCapabilityRow([shown.vision]) },
      { id: "embeddings", label: t("byok.capabilityEmbeddings"), row: byokCapabilityRow([shown.embeddings]) },
      { id: "transcription", label: t("byok.capabilityTranscription"), row: byokCapabilityRow([shown.transcription]) },
    ];
    const testedAt = rows.map((item) => item.row.testedAt).find((date) => date !== null);
    return (
      <div className="flex flex-col gap-2 rounded-lg border bg-card p-3" data-unsaved={unsavedCapabilities !== null || undefined}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <SectionHeading>{t("byok.capabilities")}</SectionHeading>
            {unsavedCapabilities !== null ? <Badge variant="outline">{t("byok.unsavedResult")}</Badge> : null}
          </div>
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
          if (dirty) onSave();
          else onTest();
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
            <Button aria-busy={busy === "remove" || undefined} disabled={writeBusy} size="sm" type="button" variant="destructiveOutline" onClick={onRemove}>
              {busy === "remove" ? <LoaderCircleIcon className="animate-spin" /> : <Trash2Icon />}
              {busy === "remove" ? t("byok.removing") : t("byok.remove")}
            </Button>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {dirty ? (
              <Button aria-busy={busy === "testSave" || undefined} data-action="testSave" disabled={writeBusy} type="submit">
                {busy === "testSave" ? <LoaderCircleIcon className="animate-spin" /> : null}
                {busy === "testSave" ? t("settings.aiTesting") : t("byok.testAndSave")}
              </Button>
            ) : (
              <Button aria-busy={busy === "test" || undefined} data-action="test" disabled={writeBusy} type="submit" variant="outline">
                {busy === "test" ? <LoaderCircleIcon className="animate-spin" /> : null}
                {busy === "test" ? t("settings.aiTesting") : t("settings.aiTestConnection")}
              </Button>
            )}
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
  const [busy, setBusy] = useState<ByokAction | null>(null);
  const [unsavedCapabilities, setUnsavedCapabilities] = useState<ByokCapabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  // Every open and close starts a new generation. A request that began in an
  // older one drops its answer and its finally, so a late reply never lands
  // on a reopened form.
  const generation = useRef(0);

  const load = useCallback(async (opened: number, signal?: AbortSignal) => {
    let response: Response;
    let value: unknown;
    try {
      response = await fetch("/api/byok", { cache: "no-store", signal });
      value = await response.json().catch(() => null);
    } catch {
      if (signal?.aborted || opened !== generation.current) return;
      setStatus("hidden");
      return;
    }
    if (signal?.aborted || opened !== generation.current) return;
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
    setUnsavedCapabilities(null);
    setError(null);
    setStatus("ready");
  }, []);

  useEffect(() => {
    generation.current += 1;
    if (!open) {
      setStatus("loading");
      setView(null);
      setDrafts(BYOK_DRAFTS_EMPTY);
      setKeyDraft("");
      setKeyEditing(false);
      setBusy(null);
      setUnsavedCapabilities(null);
      setError(null);
      setRemoveOpen(false);
      return;
    }
    const controller = new AbortController();
    void load(generation.current, controller.signal);
    return () => controller.abort();
  }, [load, open]);

  // A 409 byok_changed means the settings changed elsewhere: it reloads the
  // view and the drafts (carried by the answer, refetched otherwise) and
  // shows the cause. Returns false when the answer is not a 409.
  async function changedElsewhere(opened: number, value: unknown): Promise<boolean> {
    if (byokErrorKey(value) !== "byok_changed") return false;
    const carried = byokChangedView(value);
    if (carried !== null) {
      setView(carried.configured ? carried : null);
      setDrafts(byokDraftsOf(carried));
    } else {
      await load(opened);
      if (opened !== generation.current) return true;
    }
    setError(t("byok.errorChanged"));
    return true;
  }

  // The answer of POST /api/byok/test: the new view. The test runs on the
  // saved settings, so it updates the view and leaves the drafts alone.
  // Anything else than a view or a 409 shows its own error text.
  async function runTest(opened: number) {
    setBusy("test");
    setUnsavedCapabilities(null);
    setError(null);
    try {
      const response = await fetch("/api/byok/test", { method: "POST" });
      const value: unknown = await response.json().catch(() => null);
      if (opened !== generation.current) return;
      if (response.ok) {
        const parsed = byokViewFrom(value);
        if (parsed !== null) {
          setView(parsed.configured ? parsed : null);
          return;
        }
      }
      if (await changedElsewhere(opened, value)) return;
      setError(t(byokApiErrorKey(byokErrorKey(value))));
    } catch {
      if (opened !== generation.current) return;
      setError(t("byok.errorUnknown"));
    } finally {
      if (opened === generation.current) setBusy(null);
    }
  }

  // PUT /api/byok tests the typed values and saves them only when at least
  // one capability passed. A 422 byok_test_failed saved nothing: the tested
  // capabilities show as an unsaved result and the drafts and the typed key
  // stay, to fix and try again. The key is sent only when the user typed a
  // new one; it leaves the state as soon as a save lands, and it never
  // reaches an error message or a toast.
  async function save() {
    if (busy !== null) return;
    const opened = generation.current;
    setBusy("testSave");
    setUnsavedCapabilities(null);
    setError(null);
    try {
      const response = await fetch("/api/byok", {
        body: JSON.stringify({
          baseUrl: drafts.baseUrl,
          chatModel: drafts.chatModel,
          embeddingModel: drafts.embeddingModel,
          // A pasted key goes without the whitespace at its ends.
          ...(keyDraft.trim() !== "" ? { apiKey: keyDraft.trim() } : {}),
          transcriptionModel: drafts.transcriptionModel,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const value: unknown = await response.json().catch(() => null);
      if (opened !== generation.current) return;
      if (!response.ok) {
        const failed = byokTestFailedCapabilities(value);
        if (failed !== null) {
          setUnsavedCapabilities(failed);
          setError(t("byok.errorTestFailed"));
          return;
        }
        if (await changedElsewhere(opened, value)) return;
        setError(t(byokApiErrorKey(byokErrorKey(value))));
        return;
      }
      const parsed = byokViewFrom(value);
      if (parsed === null) {
        setError(t("byok.errorUnknown"));
        return;
      }
      setView(parsed.configured ? parsed : null);
      setDrafts(byokDraftsOf(parsed));
      setKeyDraft("");
      setKeyEditing(false);
    } catch {
      if (opened !== generation.current) return;
      setError(t("byok.errorUnknown"));
    } finally {
      if (opened === generation.current) setBusy(null);
    }
  }

  // DELETE /api/byok after the AlertDialog, which stays open (its action
  // button busy) until the answer lands.
  async function remove() {
    if (busy !== null) return;
    const opened = generation.current;
    setBusy("remove");
    setError(null);
    try {
      const response = await fetch("/api/byok", { method: "DELETE" });
      const value: unknown = await response.json().catch(() => null);
      if (opened !== generation.current) return;
      const parsed = byokViewFrom(value);
      if (!response.ok || parsed === null || parsed.configured) throw new Error("remove failed");
      setView(null);
      setDrafts(BYOK_DRAFTS_EMPTY);
      setKeyDraft("");
      setKeyEditing(false);
      setUnsavedCapabilities(null);
      setRemoveOpen(false);
      toast.success(t("byok.removed"));
    } catch {
      if (opened !== generation.current) return;
      setError(t("byok.removeError"));
    } finally {
      if (opened === generation.current) setBusy(null);
    }
  }

  function changeKey() {
    if (busy !== null) return;
    setKeyEditing(true);
    setKeyDraft("");
  }

  function test() {
    if (busy !== null || view === null) return;
    void runTest(generation.current);
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
        unsavedCapabilities={unsavedCapabilities}
        view={view}
      />
      <ByokRemoveDialog
        busy={busy}
        open={removeOpen}
        t={t}
        onCancel={() => setRemoveOpen(false)}
        onConfirm={() => {
          void remove();
        }}
      />
    </div>
  );
}

export interface ByokRemoveDialogProps {
  busy: ByokAction | null;
  open: boolean;
  t: Translate;
  onCancel: () => void;
  onConfirm: () => void;
}

/** The confirmation of the delete: the same busy rule as the form — only
 *  its action button shows the spinner while the DELETE runs, the cancel
 *  is just disabled, and the dialog does not close in the middle. */
export function ByokRemoveDialog({ busy, onCancel, onConfirm, open, t }: ByokRemoveDialogProps) {
  const removing = busy === "remove";
  return (
    <AlertDialog open={open} onOpenChange={(next) => {
      if (!next && busy === null) onCancel();
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("byok.removeTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("byok.removeDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy !== null}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            aria-busy={removing || undefined}
            disabled={busy !== null}
            variant="destructive"
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {removing ? <LoaderCircleIcon className="animate-spin" /> : null}
            {removing ? t("byok.removing") : t("byok.remove")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
