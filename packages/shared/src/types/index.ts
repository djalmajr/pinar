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
  domPath?: string;
  innerText?: string;
  kind?: "area" | "element";
  label?: string;
  number: number;
  path?: string;
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
}

export interface PageInfo {
  title: string;
  url: string;
  viewport?: {
    width: number;
    height: number;
  };
}

export interface Session {
  byteSize?: number;
  collectionId?: string;
  createdAt: string;
  id: string;
  isPermanent?: boolean;
  page: PageInfo;
  pinCount?: number;
  pins: Pin[];
  plan?: AccountPlan;
  position?: number;
  shotId?: string;
  shotUrl?: string | null;
  userId?: string | null;
  viewerUrl?: string | null;
}

export type AccountPlan = "free" | "lifetime" | "pro";

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
  storageMode: StorageMode;
  theme?: ThemeMode;
}
