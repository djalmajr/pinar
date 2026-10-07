import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { ProjectTreeProject } from "@pinar/shared";
import {
  Badge,
  Button,
  cn,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SectionHeading,
  toast,
} from "@pinar/ui";
import { isRecord } from "@/lib/api-data";
import { collectionDisplayName } from "@pinar/shared";
import { flattenCollections } from "@/lib/collection-tree";
import { useServerI18n } from "@/lib/i18n";
import CopyIcon from "~icons/lucide/copy";
import KeyRoundIcon from "~icons/lucide/key-round";
import LoaderCircleIcon from "~icons/lucide/loader-circle";
import PlusIcon from "~icons/lucide/plus";
import Trash2Icon from "~icons/lucide/trash-2";

type AgentAccessPermission = "full" | "manage" | "read" | "share";
type AgentAccessScope = "account" | "batch" | "collection" | "project" | "session";
type AgentAccessStatus = "error" | "idle" | "loading" | "saving";

interface AgentAccessKey {
  createdAt: string;
  expiresAt: string;
  id: string;
  label: string;
  lastUsedAt: string | null;
  permission: AgentAccessPermission;
  prefix: string;
  resourceId: string | null;
  resourceType: AgentAccessScope;
  revokedAt: string | null;
}

interface AgentAccessSettingsProps {
  canCreate: boolean;
  open: boolean;
  projects: ProjectTreeProject[];
}

interface AgentAccessResourceOption {
  label: string;
  value: string;
}

interface AgentKeySharedSession {
  id: string;
  title: string;
}

interface AgentKeySharedCollection {
  id: string;
  name: string;
  ownerEmail?: string;
  sessions: AgentKeySharedSession[];
}

function parseSharedCollections(value: unknown): AgentKeySharedCollection[] {
  if (!isRecord(value) || !Array.isArray(value.shared)) return [];
  const list: AgentKeySharedCollection[] = [];
  for (const item of value.shared) {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0) continue;
    const sessions: AgentKeySharedSession[] = Array.isArray(item.sessions)
      ? item.sessions.flatMap((session): AgentKeySharedSession[] => {
        if (!isRecord(session) || typeof session.id !== "string" || session.id.length === 0) return [];
        return [{ id: session.id, title: typeof session.title === "string" ? session.title : "" }];
      })
      : [];
    list.push({
      id: item.id,
      name: typeof item.name === "string" && item.name ? item.name : item.id,
      ownerEmail: typeof item.ownerEmail === "string" && item.ownerEmail ? item.ownerEmail : undefined,
      sessions,
    });
  }
  return list;
}

function sharedCollectionLabel(collection: AgentKeySharedCollection) {
  return collection.ownerEmail ? `${collection.name} · ${collection.ownerEmail}` : collection.name;
}

const EXPIRATION_DAYS = [7, 30, 90] as const;
const AGENT_ACCESS_TOAST_ID = "agent-access-feedback";

function agentAccessScope(value: unknown): value is AgentAccessScope {
  return value === "account"
    || value === "batch"
    || value === "collection"
    || value === "project"
    || value === "session";
}

function agentAccessPermission(value: unknown): value is AgentAccessPermission {
  return value === "full" || value === "manage" || value === "read" || value === "share";
}

function agentAccessKey(value: unknown): AgentAccessKey | null {
  if (!isRecord(value)
    || typeof value.createdAt !== "string"
    || typeof value.expiresAt !== "string"
    || typeof value.id !== "string"
    || typeof value.label !== "string"
    || (value.lastUsedAt !== null && typeof value.lastUsedAt !== "string")
    || !agentAccessPermission(value.permission)
    || typeof value.prefix !== "string"
    || (value.resourceId !== null && typeof value.resourceId !== "string")
    || !agentAccessScope(value.resourceType)
    || (value.revokedAt !== null && typeof value.revokedAt !== "string")) return null;
  return {
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    id: value.id,
    label: value.label,
    lastUsedAt: value.lastUsedAt,
    permission: value.permission,
    prefix: value.prefix,
    resourceId: value.resourceId,
    resourceType: value.resourceType,
    revokedAt: value.revokedAt,
  };
}

function responseError(value: unknown, fallback: string) {
  return isRecord(value) && typeof value.error === "string" ? value.error : fallback;
}

function formatDate(value: string | null, language: string, empty: string) {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(date);
}

export function AgentAccessSettings({ canCreate, open, projects }: AgentAccessSettingsProps) {
  const { language, t } = useServerI18n();
  const [error, setError] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [keys, setKeys] = useState<AgentAccessKey[]>([]);
  const [label, setLabel] = useState("");
  const [permission, setPermission] = useState<AgentAccessPermission>("read");
  const [resourceId, setResourceId] = useState("");
  const [resourceType, setResourceType] = useState<AgentAccessScope>("account");
  const [expiresInDays, setExpiresInDays] = useState<(typeof EXPIRATION_DAYS)[number]>(30);
  const [status, setStatus] = useState<AgentAccessStatus>("idle");
  const [pendingRevocations, setPendingRevocations] = useState<Set<string>>(() => new Set());
  const [sharedCollections, setSharedCollections] = useState<AgentKeySharedCollection[]>([]);
  const [sharedStatus, setSharedStatus] = useState<"error" | "idle" | "loading">("idle");

  const ownCollectionOptions = useMemo<AgentAccessResourceOption[]>(
    () => projects.flatMap((project) => flattenCollections(project.collections).map(({ collection }) => ({
      label: `${project.name} / ${collectionDisplayName(collection, t("dashboard.protectedInbox"))}`,
      value: collection.id,
    }))),
    [projects, t],
  );
  const projectOptions = useMemo<AgentAccessResourceOption[]>(
    () => projects.map((project) => ({ label: project.name, value: project.id })),
    [projects],
  );
  const ownSessionOptions = useMemo<AgentAccessResourceOption[]>(
    () => projects.flatMap((project) => project.collections.flatMap((collection) => collection.sessions.map((session) => ({
      label: `${project.name} / ${collectionDisplayName(collection, t("dashboard.protectedInbox"))} / ${session.page.title}`,
      value: session.id,
    })))),
    [projects, t],
  );
  const sharedCollectionOptions = useMemo<AgentAccessResourceOption[]>(
    () => sharedCollections.map((collection) => ({
      label: sharedCollectionLabel(collection),
      value: collection.id,
    })),
    [sharedCollections],
  );
  const sharedSessionOptions = useMemo<AgentAccessResourceOption[]>(
    () => sharedCollections.flatMap((collection) => collection.sessions.map((session) => ({
      label: `${sharedCollectionLabel(collection)} / ${session.title || session.id}`,
      value: session.id,
    }))),
    [sharedCollections],
  );
  const collectionOptions = useMemo(
    () => [...ownCollectionOptions, ...sharedCollectionOptions],
    [ownCollectionOptions, sharedCollectionOptions],
  );
  const sessionOptions = useMemo(
    () => [...ownSessionOptions, ...sharedSessionOptions],
    [ownSessionOptions, sharedSessionOptions],
  );
  const batchOptions = useMemo<AgentAccessResourceOption[]>(
    () => {
      const batches = new Map<string, string>();
      for (const project of projects) {
        for (const collection of project.collections) {
          for (const session of collection.sessions) {
            const batchId = session.batchId;
            if (typeof batchId === "string" && batchId.length > 0) {
              batches.set(batchId, `${t("settings.agentAccessScopeBatch")} · ${batchId}`);
            }
          }
        }
      }
      return Array.from(batches, ([value, label]) => ({ label, value }));
    },
    [projects, t],
  );
  const resourceOptions = resourceType === "batch"
    ? batchOptions
    : resourceType === "collection"
      ? collectionOptions
      : resourceType === "project"
        ? projectOptions
        : resourceType === "session"
          ? sessionOptions
          : [];
  const selectedResource = resourceOptions.some((option) => option.value === resourceId) ? resourceId : "";
  const canSubmit = canCreate && label.trim().length > 0 && (permission !== "read" || resourceType === "account" || selectedResource.length > 0);
  const scopeOptions = permission === "read"
    ? [
        { label: t("settings.agentAccessScopeAccount"), value: "account" },
        { label: t("settings.agentAccessScopeProject"), value: "project" },
        { label: t("settings.agentAccessScopeCollection"), value: "collection" },
        { label: t("settings.agentAccessScopeSession"), value: "session" },
        { label: t("settings.agentAccessScopeBatch"), value: "batch" },
      ]
    : [{ label: t("settings.agentAccessScopeAccount"), value: "account" }];

  const loadKeys = useCallback(async (signal?: AbortSignal) => {
    setStatus("loading");
    try {
      const response = await fetch("/api/agent-keys", { cache: "no-store", signal });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(value) || !Array.isArray(value.keys)) {
        throw new Error(responseError(value, t("settings.agentAccessUnavailable")));
      }
      const nextKeys = value.keys.map(agentAccessKey).filter((key): key is AgentAccessKey => key !== null);
      setKeys(nextKeys);
      setError(null);
      setStatus("idle");
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : t("settings.agentAccessUnavailable"));
      setStatus("error");
    }
  }, [t]);

  const loadSharedResources = useCallback(async (signal?: AbortSignal) => {
    setSharedStatus("loading");
    try {
      const response = await fetch("/api/agent-key-shared-resources", { cache: "no-store", signal });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(value)) {
        throw new Error("shared_resources_unavailable");
      }
      if (signal?.aborted) return;
      setSharedCollections(parseSharedCollections(value));
      setSharedStatus("idle");
    } catch {
      if (signal?.aborted) return;
      // Drop stale shared options so a revoked collaboration is never shown;
      // own options are separate state and continue untouched. No polling.
      setSharedCollections([]);
      setSharedStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setGeneratedKey(null);
      setError(null);
      setPendingRevocations(new Set());
      return;
    }
    const controller = new AbortController();
    void loadKeys(controller.signal);
    return () => controller.abort();
  }, [loadKeys, open]);

  useEffect(() => {
    if (!open || !canCreate) return;
    const controller = new AbortController();
    void loadSharedResources(controller.signal);
    return () => controller.abort();
  }, [canCreate, loadSharedResources, open]);

  useEffect(() => {
    if (permission !== "read") {
      if (resourceType !== "account") setResourceType("account");
      if (resourceId !== "") setResourceId("");
      return;
    }
    if (resourceType === "account") {
      setResourceId("");
      return;
    }
    if (!resourceOptions.some((option) => option.value === resourceId)) {
      setResourceId(resourceOptions[0]?.value || "");
    }
  }, [permission, resourceId, resourceOptions, resourceType]);

  function scopeLabel(key: AgentAccessKey) {
    if (key.resourceType === "account") return t("settings.agentAccessScopeAccount");
    const project = projects.find((candidate) => candidate.id === key.resourceId);
    if (key.resourceType === "project") return project ? `${t("settings.agentAccessScopeProject")} · ${project.name}` : t("settings.agentAccessScopeProject");
    const collection = projects.flatMap((candidate) => candidate.collections).find((candidate) => candidate.id === key.resourceId);
    const owner = collection ? projects.find((candidate) => candidate.id === collection.projectId) : undefined;
    if (key.resourceType === "collection") {
      if (!collection) {
        const shared = sharedCollections.find((candidate) => candidate.id === key.resourceId);
        return shared
          ? `${t("settings.agentAccessScopeCollection")} · ${sharedCollectionLabel(shared)}`
          : t("settings.agentAccessScopeCollection");
      }
      const collectionName = collectionDisplayName(collection, t("dashboard.protectedInbox"));
      return owner ? `${t("settings.agentAccessScopeCollection")} · ${owner.name} / ${collectionName}` : `${t("settings.agentAccessScopeCollection")} · ${collectionName}`;
    }
    const session = projects
      .flatMap((candidate) => candidate.collections)
      .flatMap((candidate) => candidate.sessions)
      .find((candidate) => candidate.id === key.resourceId);
    if (key.resourceType === "session") {
      if (session) return `${t("settings.agentAccessScopeSession")} · ${session.page.title}`;
      const sharedSession = sharedCollections.flatMap((candidate) => candidate.sessions.map((item) => ({
        collection: candidate,
        session: item,
      }))).find((entry) => entry.session.id === key.resourceId);
      return sharedSession
        ? `${t("settings.agentAccessScopeSession")} · ${sharedCollectionLabel(sharedSession.collection)} / ${sharedSession.session.title || sharedSession.session.id}`
        : t("settings.agentAccessScopeSession");
    }
    return key.resourceId ? `${t("settings.agentAccessScopeBatch")} · ${key.resourceId}` : t("settings.agentAccessScopeBatch");
  }

  function permissionDescription(value: AgentAccessPermission) {
    if (value === "full") return t("settings.agentAccessPermissionFullDescription");
    if (value === "manage") return t("settings.agentAccessPermissionManageDescription");
    if (value === "share") return t("settings.agentAccessPermissionShareDescription");
    return t("settings.agentAccessPermissionReadDescription");
  }

  function permissionLabel(value: AgentAccessPermission) {
    if (value === "full") return t("settings.agentAccessPermissionFull");
    if (value === "manage") return t("settings.agentAccessPermissionManage");
    if (value === "share") return t("settings.agentAccessPermissionShare");
    return t("settings.agentAccessPermissionRead");
  }

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || status === "saving") return;
    setStatus("saving");
    setError(null);
    setGeneratedKey(null);
    toast.dismiss(AGENT_ACCESS_TOAST_ID);
    try {
      const response = await fetch("/api/agent-keys", {
        body: JSON.stringify({
          expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
          label: label.trim(),
          permission,
          resourceId: permission === "read" && resourceType !== "account" ? selectedResource : null,
          resourceType: permission === "read" ? resourceType : "account",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(value) || typeof value.key !== "string" || value.key.length === 0) {
        throw new Error(responseError(value, t("settings.agentAccessCreateError")));
      }
      setGeneratedKey(value.key);
      setLabel("");
      await loadKeys();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.agentAccessCreateError"));
      setStatus("error");
    }
  }

  async function revokeKey(id: string) {
    if (pendingRevocations.has(id)) return;
    setPendingRevocations((current) => new Set(current).add(id));
    setError(null);
    try {
      const response = await fetch(`/api/agent-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(value) || value.ok !== true) {
        throw new Error(responseError(value, t("settings.agentAccessRevokeError")));
      }
      await loadKeys();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.agentAccessRevokeError"));
    } finally {
      setPendingRevocations((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  async function copyGeneratedKey() {
    if (!generatedKey) return;
    try {
      await navigator.clipboard.writeText(generatedKey);
      toast.success(t("common.copied"), { id: AGENT_ACCESS_TOAST_ID });
    } catch {
      setError(t("settings.agentAccessCopyError"));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <SectionHeading>{t("settings.agentAccessHeading")}</SectionHeading>
        <p className="text-sm text-muted-foreground">{t("settings.agentAccessDescription")}</p>
        <p className="text-xs leading-5 text-muted-foreground">{t("settings.agentAccessUsage")}</p>
      </div>
      {!canCreate ? (
        <div className="flex min-h-24 flex-col items-start justify-center gap-2 rounded-lg border bg-card px-4 py-3">
          <p className="text-sm font-medium">{t("settings.agentAccessProTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("settings.agentAccessProDescription")}</p>
          <Button render={<a href="/pricing" />} size="sm" variant="pro">{t("common.upgradePro")}</Button>
        </div>
      ) : (
        <form className="flex flex-col gap-3 rounded-lg border bg-card p-4" onSubmit={createKey}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
              {t("settings.agentAccessLabel")}
              <Input
                aria-label={t("settings.agentAccessLabel")}
                autoComplete="off"
                disabled={status === "saving"}
                maxLength={80}
                placeholder={t("settings.agentAccessLabelPlaceholder")}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
              {t("settings.agentAccessExpiration")}
              <Select
                disabled={status === "saving"}
                items={EXPIRATION_DAYS.map((days) => ({ label: t("settings.agentAccessExpirationDays", { days }), value: String(days) }))}
                value={String(expiresInDays)}
                onValueChange={(value) => {
                  const days = Number(value);
                  if (days === 7 || days === 30 || days === 90) setExpiresInDays(days);
                }}
              >
                <SelectTrigger aria-label={t("settings.agentAccessExpiration")} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent align="end"><SelectGroup>{EXPIRATION_DAYS.map((days) => <SelectItem key={days} value={String(days)}>{t("settings.agentAccessExpirationDays", { days })}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
              {t("settings.agentAccessPermission")}
              <Select
                disabled={status === "saving"}
                items={[
                  { label: t("settings.agentAccessPermissionRead"), value: "read" },
                  { label: t("settings.agentAccessPermissionManage"), value: "manage" },
                  { label: t("settings.agentAccessPermissionShare"), value: "share" },
                  { label: t("settings.agentAccessPermissionFull"), value: "full" },
                ]}
                value={permission}
                onValueChange={(value) => {
                  if (!agentAccessPermission(value)) return;
                  setPermission(value);
                  if (value !== "read") {
                    setResourceType("account");
                    setResourceId("");
                  }
                }}
              >
                <SelectTrigger aria-label={t("settings.agentAccessPermission")} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent align="end"><SelectGroup>
                  <SelectItem value="read">{t("settings.agentAccessPermissionRead")}</SelectItem>
                  <SelectItem value="manage">{t("settings.agentAccessPermissionManage")}</SelectItem>
                  <SelectItem value="share">{t("settings.agentAccessPermissionShare")}</SelectItem>
                  <SelectItem value="full">{t("settings.agentAccessPermissionFull")}</SelectItem>
                </SelectGroup></SelectContent>
              </Select>
              <span className="text-xs font-normal text-muted-foreground">{permissionDescription(permission)}</span>
            </label>
            <div className="flex min-h-24 flex-col justify-end">
              <p className={cn("min-h-10 text-xs", permission === "read" ? "invisible" : "text-amber-700 dark:text-amber-300")}>
                {t("settings.agentAccessPermissionWriteWarning")}
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
              {t("settings.agentAccessScope")}
              <Select
                disabled={status === "saving"}
                items={scopeOptions}
                value={resourceType}
                onValueChange={(value) => {
                  if (agentAccessScope(value)) setResourceType(value);
                }}
              >
                <SelectTrigger aria-label={t("settings.agentAccessScope")} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent align="end"><SelectGroup>
                  <SelectItem value="account">{t("settings.agentAccessScopeAccount")}</SelectItem>
                  <SelectItem disabled={permission !== "read"} value="project">{t("settings.agentAccessScopeProject")}</SelectItem>
                  <SelectItem disabled={permission !== "read"} value="collection">{t("settings.agentAccessScopeCollection")}</SelectItem>
                  <SelectItem disabled={permission !== "read"} value="session">{t("settings.agentAccessScopeSession")}</SelectItem>
                  <SelectItem disabled={permission !== "read"} value="batch">{t("settings.agentAccessScopeBatch")}</SelectItem>
                </SelectGroup></SelectContent>
              </Select>
            </label>
            <div aria-busy={sharedStatus === "loading"} className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
              <span>{t("settings.agentAccessResource")}</span>
              <Select
                disabled={status === "saving" || resourceType === "account" || resourceOptions.length === 0}
                items={resourceOptions}
                value={selectedResource}
                onValueChange={(value) => setResourceId(value || "")}
              >
                <SelectTrigger aria-label={t("settings.agentAccessResource")} className="w-full"><SelectValue placeholder={resourceType === "account" ? t("settings.agentAccessWholeAccount") : t("settings.agentAccessChooseResource")} /></SelectTrigger>
                <SelectContent align="end"><SelectGroup>{resourceOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex min-h-7 items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{permission === "read" ? t("settings.agentAccessReadOnly") : permissionDescription(permission)}</p>
            <Button disabled={!canSubmit || status === "saving"} size="sm" type="submit">
              {status === "saving" ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
              {status === "saving" ? t("settings.agentAccessCreating") : t("settings.agentAccessCreate")}
            </Button>
          </div>
        </form>
      )}
      <div className="min-h-20" aria-live="polite">
        {generatedKey ? (
          <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-4">
            <p className="text-sm font-medium">{t("settings.agentAccessKeyShownOnce")}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-2 py-1.5 text-xs">{generatedKey}</code>
              <Button aria-label={t("settings.agentAccessCopy")} size="icon-sm" title={t("settings.agentAccessCopy")} type="button" variant="outline" onClick={() => void copyGeneratedKey()}><CopyIcon /></Button>
            </div>
          </div>
        ) : null}
        {error ? <p className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <SectionHeading>{t("settings.agentAccessExisting")}</SectionHeading>
          {status === "loading" ? <LoaderCircleIcon aria-label={t("common.loading")} className="size-4 animate-spin text-muted-foreground" /> : null}
        </div>
        {status === "error" && keys.length === 0 ? <p className="rounded-lg border bg-card px-3 py-3 text-sm text-muted-foreground">{t("settings.agentAccessUnavailable")}</p> : null}
        {status !== "error" && keys.length === 0 ? <p className="rounded-lg border bg-card px-3 py-3 text-sm text-muted-foreground">{t("settings.agentAccessEmpty")}</p> : null}
        {keys.map((key) => {
          const pending = pendingRevocations.has(key.id);
          const expired = new Date(key.expiresAt).getTime() <= Date.now();
          const revoked = key.revokedAt !== null;
          return (
            <div aria-busy={pending} className={cn("flex flex-col gap-3 rounded-lg border bg-card p-3", pending && "opacity-70")} key={key.id}>
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                  <KeyRoundIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{key.label}</p>
                    <code className="text-xs text-muted-foreground">{key.prefix}</code>
                  </div>
                </div>
                {revoked ? <Badge variant="outline">{t("settings.agentAccessRevoked")}</Badge> : expired ? <Badge variant="secondary">{t("settings.agentAccessExpired")}</Badge> : null}
              </div>
              <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-4">
                <div><dt className="text-muted-foreground">{t("settings.agentAccessScope")}</dt><dd className="truncate font-medium">{scopeLabel(key)}</dd></div>
                <div><dt className="text-muted-foreground">{t("settings.agentAccessPermission")}</dt><dd className="font-medium">{permissionLabel(key.permission)}</dd></div>
                <div><dt className="text-muted-foreground">{t("settings.agentAccessExpires")}</dt><dd className="font-medium">{formatDate(key.expiresAt, language, t("settings.agentAccessUnknownDate"))}</dd></div>
                <div><dt className="text-muted-foreground">{t("settings.agentAccessLastUsed")}</dt><dd className="font-medium">{formatDate(key.lastUsedAt, language, t("settings.agentAccessNeverUsed"))}</dd></div>
              </dl>
              <div className="flex min-h-7 items-center justify-end">
                {pending ? <span className="text-xs text-muted-foreground">{t("settings.agentAccessRevoking")}</span> : revoked ? null : <Button disabled={pending} size="sm" type="button" variant="ghost" onClick={() => void revokeKey(key.id)}><Trash2Icon />{t("settings.agentAccessRevoke")}</Button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
