import type { PinLocation, VisualFingerprint } from "../locators/types.js";
import type { PinReviewCounts } from "../pin-review/index.js";
import type { PrivacyReport } from "../privacy/types.js";

export type {
  LocateConfidence,
  LocateStrategy,
  PinLocation,
  VisualFingerprint,
} from "../locators/types.js";
export type { PrivacyReport, RedactedCategory } from "../privacy/types.js";

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Pin {
  anchor?: Point;
  areaBox?: Box;
  box?: Box;
  color?: string;
  comment: string;
  coords: Point;
  documentAnchor?: Point;
  documentBox?: Box;
  domPath?: string;
  frameId?: number;
  id?: string;
  innerText?: string;
  kind?: "area" | "element";
  label?: string;
  number: number;
  path?: string;
  pinId?: string;
  scroll?: Point;
  selector?: string;
  tag?: string;
  text?: string;
  topBox?: Box;
  type: "point" | "area";
  viewport?: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  };
  viewportAnchored?: boolean;
  fingerprint?: VisualFingerprint;
  historicalAnchor?: Point;
  historicalBox?: Box;
  location?: PinLocation;
  locationHistory?: Array<{
    at: string;
    confidence: PinLocation["confidence"];
    source: "locator" | "manual";
    strategy?: string;
  }>;
}

export interface PageInfo {
  description?: string;
  title: string;
  url: string;
  viewport?: {
    dpr?: number;
    height: number;
    width: number;
  };
}

export interface Session {
  byteSize?: number;
  captureId?: string;
  collectionId?: string;
  createdAt: string;
  id: string;
  isPermanent?: boolean;
  page: PageInfo;
  pinCount?: number;
  pins: Pin[];
  plan?: AccountPlan;
  position?: number;
  privacy?: PrivacyReport;
  reviewCounts?: PinReviewCounts;
  schemaVersion?: number;
  shotId?: string;
  shotUrl?: string | null;
  includeScreenshot?: boolean;
  userId?: string | null;
  viewerUrl?: string | null;
}

export type AccountPlan = "founder" | "free" | "lifetime" | "pro";

export interface LocalAuthSession {
  kind: "local";
  plan: "free";
}

export interface InstallationAuthSession {
  installationId: string;
  kind: "installation";
  plan: "free";
}

export interface AccountAuthSession {
  email: string;
  kind: "account";
  plan: AccountPlan;
  userId: string;
}

export type AuthSession =
  AccountAuthSession | InstallationAuthSession | LocalAuthSession;

export interface AuthSessionResponse {
  session: AuthSession | null;
}

export interface ExtensionCodeChallenge {
  code: string;
  expiresAt: string;
}

export interface DeviceSession {
  expiresAt: string;
  session: AccountAuthSession;
  token: string;
}

export type ProjectIcon = string;

export interface Project {
  createdAt: string;
  id: string;
  icon: ProjectIcon;
  isProtected: boolean;
  name: string;
  ownerId: string;
  position: number;
  updatedAt: string;
}

export interface Collection {
  createdAt: string;
  id: string;
  isProtected: boolean;
  name: string;
  ownerId: string;
  parentId: string | null;
  position: number;
  projectId: string;
  updatedAt: string;
}

export interface CollectionPlacement {
  id: string;
  parentId: string | null;
}

export interface ProjectTreeCollection extends Collection {
  sessions: Session[];
}

export interface ProjectTreeProject extends Project {
  collections: ProjectTreeCollection[];
}

export interface ProjectTree {
  projects: ProjectTreeProject[];
}

export interface CaptureDestination {
  collectionId: string;
  projectId: string;
}

export type StorageMode = "local" | "cloud";
export const SUPPORTED_LANGUAGES = [
  "en",
  "pt",
  "es",
  "fr",
  "de",
  "zh",
  "ja",
] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export type ThemeMode = "dark" | "light" | "system";
export type HandoffMode = "compact" | "full";

export interface DeliveryPreferences {
  handoffMode: HandoffMode;
  includeScreenshot: boolean;
}

export const DEFAULT_DELIVERY_PREFERENCES: DeliveryPreferences = {
  handoffMode: "compact",
  includeScreenshot: true,
};

function handoffModeValue(
  value: unknown,
  fallback: HandoffMode = "compact",
): HandoffMode {
  return value === "full" || value === "compact" ? value : fallback;
}

function includeScreenshotValue(value: unknown, fallback = true) {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === "0" || value === "false") return false;
  if (value === 1 || value === "1" || value === "true") return true;
  return fallback;
}

export function parseDeliveryPreferences(value: unknown): DeliveryPreferences {
  if (typeof value !== "object" || value === null)
    return { ...DEFAULT_DELIVERY_PREFERENCES };
  const record = value as Record<string, unknown>;
  return {
    handoffMode: handoffModeValue(record.handoffMode),
    includeScreenshot: includeScreenshotValue(record.includeScreenshot),
  };
}

export function mergeDeliveryPreferences(
  current: DeliveryPreferences,
  patch: unknown,
): DeliveryPreferences {
  if (typeof patch !== "object" || patch === null) return current;
  const record = patch as Record<string, unknown>;
  return {
    handoffMode: handoffModeValue(record.handoffMode, current.handoffMode),
    includeScreenshot: includeScreenshotValue(
      record.includeScreenshot,
      current.includeScreenshot,
    ),
  };
}

export interface PinarSettings {
  cloudUrl: string;
  copyViewerContent: boolean;
  enableHistory: boolean;
  handoffMode: HandoffMode;
  includeScreenshot: boolean;
  includeViewer: boolean;
  loopMetricsOptIn?: boolean;
  language: string;
  sensitiveQueryKeys?: string;
  storageMode: StorageMode;
  theme?: ThemeMode;
}
