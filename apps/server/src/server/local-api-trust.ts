export const LOCAL_HEALTH_DISCOVERY_KEYS = ["ok", "runtime", "service"] as const;

export function localHealthDiscoveryBody() {
  return {
    ok: true,
    runtime: "local" as const,
    service: "pinar",
  };
}

export const LOCAL_HEALTH_FORBIDDEN_KEYS = [
  "history",
  "port",
  "hasAdminAuth",
  "hasAi",
  "hasAuthPepper",
  "hasBucket",
  "hasDb",
  "hasEmail",
  "hasExtensionOrigin",
  "hasStripe",
  "hasStripeWebhook",
] as const;

export type LocalApiTrustClass =
  | "local-public-projection"
  | "mutable"
  | "public-min"
  | "sensitive-read";

export interface LocalApiTrustEntry {
  class: LocalApiTrustClass;
  intendedClients: readonly string[];
  methods: readonly string[];
  notes?: string;
  path: string;
  pattern: RegExp;
}

export const LOCAL_API_TRUST_MATRIX: readonly LocalApiTrustEntry[] = [
  {
    class: "public-min",
    intendedClients: ["cli", "extension-discovery", "tray"],
    methods: ["GET"],
    notes: "Discovery only. Body is ok/runtime/service.",
    path: "/api/health",
    pattern: /^\/api\/health$/,
  },
  {
    class: "public-min",
    intendedClients: ["extension"],
    methods: ["GET"],
    notes: "Origin-gated pairing. Hostile origins are denied before the handler.",
    path: "/api/local/capability",
    pattern: /^\/api\/local\/capability$/,
  },
  {
    class: "mutable",
    intendedClients: ["extension", "workspace"],
    methods: ["POST"],
    notes: "Requires the current or grace-window capability.",
    path: "/api/local/capability/rotate",
    pattern: /^\/api\/local\/capability\/rotate$/,
  },
  {
    class: "mutable",
    intendedClients: ["extension", "workspace"],
    methods: ["POST"],
    notes: "Requires a valid capability. Next bootstrap mints a new secret.",
    path: "/api/local/capability/revoke",
    pattern: /^\/api\/local\/capability\/revoke$/,
  },
  {
    class: "sensitive-read",
    intendedClients: ["cli", "tray", "workspace"],
    methods: ["GET"],
    path: "/api/auth/session",
    pattern: /^\/api\/auth\/session$/,
  },
  {
    class: "mutable",
    intendedClients: ["workspace"],
    methods: ["POST"],
    path: "/api/auth/logout",
    pattern: /^\/api\/auth\/logout$/,
  },
  {
    class: "sensitive-read",
    intendedClients: ["cli", "extension", "workspace"],
    methods: ["GET"],
    notes: "Live delivery preference for agent copy and public .md URLs.",
    path: "/api/preferences",
    pattern: /^\/api\/preferences$/,
  },
  {
    class: "mutable",
    intendedClients: ["cli", "extension", "workspace"],
    methods: ["PATCH"],
    notes: "Updates the live delivery preference for this helper.",
    path: "/api/preferences",
    pattern: /^\/api\/preferences$/,
  },
  {
    class: "mutable",
    intendedClients: ["cli", "extension", "workspace"],
    methods: ["POST"],
    path: "/api/shots",
    pattern: /^\/api\/shots$/,
  },
  {
    class: "mutable",
    intendedClients: ["cli", "extension", "workspace"],
    methods: ["POST"],
    path: "/api/history",
    pattern: /^\/api\/history$/,
  },
  {
    class: "mutable",
    intendedClients: ["cli", "extension", "workspace"],
    methods: ["POST"],
    notes: "Requires a valid capability. Publishes idempotent per-pin agent results.",
    path: "/api/agent-executions",
    pattern: /^\/api\/agent-executions$/,
  },
  {
    class: "mutable",
    intendedClients: ["cli", "extension", "workspace"],
    methods: ["POST"],
    notes: "Requires a valid capability. Opt-in funnel metrics only; never stores comments, URLs, selectors, or screenshots.",
    path: "/api/loop-metrics",
    pattern: /^\/api\/loop-metrics$/,
  },
  {
    class: "sensitive-read",
    intendedClients: ["cli", "workspace"],
    methods: ["GET"],
    notes: "Returns allowlisted funnel events only.",
    path: "/api/loop-metrics",
    pattern: /^\/api\/loop-metrics$/,
  },
  {
    class: "sensitive-read",
    intendedClients: ["cli", "workspace"],
    methods: ["GET"],
    notes: "Named public, but returns local project/session data.",
    path: "/api/public/projects/:id",
    pattern: /^\/api\/public\/projects\/[^/]+$/,
  },
  {
    class: "sensitive-read",
    intendedClients: ["cli", "workspace"],
    methods: ["GET"],
    notes: "Named public, but returns local collection/session data.",
    path: "/api/public/collections/:id",
    pattern: /^\/api\/public\/collections\/[^/]+$/,
  },
  {
    class: "sensitive-read",
    intendedClients: ["cli", "tray", "workspace"],
    methods: ["GET"],
    path: "/api/project-tree",
    pattern: /^\/api\/project-tree$/,
  },
  {
    class: "sensitive-read",
    intendedClients: ["cli", "workspace"],
    methods: ["GET"],
    path: "/api/projects",
    pattern: /^\/api\/projects$/,
  },
  {
    class: "mutable",
    intendedClients: ["cli", "workspace"],
    methods: ["POST"],
    path: "/api/projects",
    pattern: /^\/api\/projects$/,
  },
  {
    class: "mutable",
    intendedClients: ["cli", "workspace"],
    methods: ["POST"],
    path: "/api/projects/reorder",
    pattern: /^\/api\/projects\/reorder$/,
  },
  {
    class: "sensitive-read",
    intendedClients: ["cli", "workspace"],
    methods: ["GET"],
    path: "/api/projects/:id/collections",
    pattern: /^\/api\/projects\/[^/]+\/collections$/,
  },
  {
    class: "mutable",
    intendedClients: ["cli", "workspace"],
    methods: ["POST"],
    path: "/api/projects/:id/collections",
    pattern: /^\/api\/projects\/[^/]+\/collections$/,
  },
  {
    class: "mutable",
    intendedClients: ["cli", "workspace"],
    methods: ["POST"],
    path: "/api/projects/:id/collections/reorder",
    pattern: /^\/api\/projects\/[^/]+\/collections\/reorder$/,
  },
  {
    class: "mutable",
    intendedClients: ["cli", "workspace"],
    methods: ["PATCH", "DELETE"],
    path: "/api/projects/:id",
    pattern: /^\/api\/projects\/[^/]+$/,
  },
  {
    class: "mutable",
    intendedClients: ["cli", "workspace"],
    methods: ["PATCH", "DELETE"],
    path: "/api/collections/:id",
    pattern: /^\/api\/collections\/[^/]+$/,
  },
  {
    class: "mutable",
    intendedClients: ["cli", "workspace"],
    methods: ["POST"],
    path: "/api/sessions/:id/move",
    pattern: /^\/api\/sessions\/[^/]+\/move$/,
  },
  {
    class: "mutable",
    intendedClients: ["cli", "workspace"],
    methods: ["POST"],
    notes: "Human accept/reopen only. Never auto-accepts from agent results.",
    path: "/api/sessions/:id/pins/:pinId/review",
    pattern: /^\/api\/sessions\/[^/]+\/pins\/[^/]+\/review$/,
  },
  {
    class: "mutable",
    intendedClients: ["cli", "workspace"],
    methods: ["POST"],
    path: "/api/collections/:id/sessions/reorder",
    pattern: /^\/api\/collections\/[^/]+\/sessions\/reorder$/,
  },
  {
    class: "sensitive-read",
    intendedClients: ["cli", "tray", "workspace"],
    methods: ["GET"],
    path: "/api/history",
    pattern: /^\/api\/history$/,
  },
  {
    class: "sensitive-read",
    intendedClients: ["cli", "extension", "workspace"],
    methods: ["GET"],
    path: "/api/sessions/:id",
    pattern: /^\/api\/sessions\/[^/]+$/,
  },
  {
    class: "sensitive-read",
    intendedClients: ["cli", "workspace"],
    methods: ["GET"],
    path: "/api/history/:id",
    pattern: /^\/api\/history\/[^/]+$/,
  },
  {
    class: "mutable",
    intendedClients: ["cli", "workspace"],
    methods: ["DELETE"],
    path: "/api/history/:id",
    pattern: /^\/api\/history\/[^/]+$/,
  },
];

export const LOCAL_PUBLIC_PROJECTIONS: readonly LocalApiTrustEntry[] = [
  {
    class: "local-public-projection",
    intendedClients: ["browser-viewer", "clipboard-handoff"],
    methods: ["GET"],
    notes: "Loopback viewer/shot/installer. Not the mutation path.",
    path: "/shots/:id",
    pattern: /^\/shots\//,
  },
  {
    class: "local-public-projection",
    intendedClients: ["browser-viewer", "clipboard-handoff"],
    methods: ["GET"],
    path: "/v/:id.md",
    pattern: /^\/v\//,
  },
  {
    class: "local-public-projection",
    intendedClients: ["browser-viewer"],
    methods: ["GET"],
    path: "/p/:id.md",
    pattern: /^\/p\//,
  },
  {
    class: "local-public-projection",
    intendedClients: ["browser-viewer"],
    methods: ["GET"],
    path: "/c/:id.md",
    pattern: /^\/c\//,
  },
  {
    class: "local-public-projection",
    intendedClients: ["cli-install"],
    methods: ["GET"],
    path: "/install.sh",
    pattern: /^\/install\.sh$/,
  },
  {
    class: "local-public-projection",
    intendedClients: ["cli-install"],
    methods: ["GET"],
    path: "/install.ps1",
    pattern: /^\/install\.ps1$/,
  },
];

export const LOCAL_CORS_ALLOWED_ORIGIN_KINDS = ["chrome-extension", "loopback"] as const;

export const INTENDED_LOCAL_TRUST = {
  capability: {
    "local-public-projection": "none on loopback viewer",
    mutable: "required unless loopback Origin or non-browser client",
    "public-min": "none, except pairing GET which is origin-gated",
    "sensitive-read": "required unless loopback Origin or non-browser client",
  },
  corsAllowOrigin: "chrome-extension origin and loopback workspace only",
  notes: "Enforced by local-api-policy.ts before business handlers.",
} as const;

export const CLOUD_HEALTH_OUT_OF_SCOPE = {
  path: "/api/health",
  runtime: "cloud",
  notes: "Cloud health currently reports config presence flags. Out of scope for DJA-155.",
} as const;

export function classifyLocalApiRequest(method: string, path: string): LocalApiTrustEntry | null {
  const haystack = [...LOCAL_API_TRUST_MATRIX, ...LOCAL_PUBLIC_PROJECTIONS];
  for (const entry of haystack) {
    if (entry.methods.includes(method) && entry.pattern.test(path)) return entry;
  }
  return null;
}
