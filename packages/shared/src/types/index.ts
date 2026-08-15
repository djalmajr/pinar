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
  createdAt: string;
  id: string;
  isPermanent?: boolean;
  page: PageInfo;
  pinCount?: number;
  pins: Pin[];
  plan?: "free" | "pro";
  shotId?: string;
  shotUrl?: string | null;
  userId?: string | null;
  viewerUrl?: string | null;
}

export interface UserSubscription {
  id: string;
  email: string;
  licenseKey: string;
  plan: "free" | "pro";
  status: "active" | "canceled" | "past_due";
  storageLimitMb: number;
  storageUsedBytes: number;
}

export type StorageMode = "local" | "cloud";
export type SupportedLanguage = "en" | "pt" | "es" | "fr" | "de" | "zh" | "ja";

export type ThemeMode = "dark" | "light" | "system";

export interface PinarSettings {
  cloudUrl: string;
  cloudToken: string;
  enableHistory: boolean;
  includeViewer: boolean;
  language: string;
  licenseKey: string;
  storageMode: StorageMode;
  theme?: ThemeMode;
  userPlan: "free" | "pro";
  userEmail: string;
}
