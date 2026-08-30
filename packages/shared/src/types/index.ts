import type { PinLocation, VisualFingerprint } from "../locators/types.js";
import type { PinReviewCounts } from "../pin-review/index.js";
import type { PrivacyReport } from "../privacy/types.js";

export type { LocateConfidence, LocateStrategy, PinLocation, VisualFingerprint } from "../locators/types.js";
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

export type AuthSession = AccountAuthSession | InstallationAuthSession | LocalAuthSession;

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
export type SupportedLanguage = "en" | "pt" | "es" | "fr" | "de" | "zh" | "ja";

export type ThemeMode = "dark" | "light" | "system";

export interface PinarSettings {
  cloudUrl: string;
  copyViewerContent: boolean;
  enableHistory: boolean;
  includeViewer: boolean;
  language: string;
  sensitiveQueryKeys?: string;
  storageMode: StorageMode;
  theme?: ThemeMode;
}
