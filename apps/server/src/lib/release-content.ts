import type { SupportedLanguage } from "@pinar/shared";
import englishReleaseLocale from "./release-locales/en";

export type ReleaseTag = (typeof releaseDefinitions)[number]["tag"];
export type ReleaseChangeId =
  (typeof releaseDefinitions)[number]["changes"][number];

export interface ReleaseChange {
  description: string;
  id: ReleaseChangeId;
  title: string;
}

export interface ProductRelease {
  changes: ReleaseChange[];
  date: string;
  summary: string;
  tag: ReleaseTag;
  title: string;
}

export interface ReleaseUi {
  allReleases: string;
  backToReleases: string;
  firstRelease: string;
  historyDescription: string;
  latestRelease: string;
  metaDescription: string;
  next: string;
  pageDescription: string;
  pageTitle: string;
  previous: string;
  releaseNavigation: string;
  releaseNotFound: string;
  releaseNotFoundDescription: string;
  viewDetails: string;
  whatChanged: string;
}

export interface ReleaseLocale {
  releases: {
    [Definition in (typeof releaseDefinitions)[number] as Definition["tag"]]: {
      changes: Record<
        Definition["changes"][number],
        { description: string; title: string }
      >;
      summary: string;
      title: string;
    };
  };
  ui: ReleaseUi;
}

export interface ReleaseContent {
  language: SupportedLanguage;
  releases: ProductRelease[];
  ui: ReleaseUi;
}

export const releaseDefinitions = [
  {
    tag: "v0.3.3",
    date: "2026-09-04",
    changes: ["local-account-menu", "free-without-ai"],
  },
  {
    tag: "v0.3.2",
    date: "2026-09-04",
    changes: ["windows-setup-zip", "windows-help-links"],
  },
  {
    tag: "v0.3.1",
    date: "2026-09-04",
    changes: ["windows-desktop-app", "unique-help-covers", "windows-first-run-help"],
  },
  {
    tag: "v0.3.0",
    date: "2026-09-02",
    changes: ["workspace-organization", "global-settings", "capture-feedback", "help-center"],
  },
  {
    tag: "v0.2.0",
    date: "2026-09-02",
    changes: ["capture-batches", "server-preferences", "localized-everywhere", "progress-toolbar", "about-and-versioning"],
  },
  {
    tag: "v0.1.5",
    date: "2026-08-28",
    changes: ["idempotent-login-setup", "preference-preserved"],
  },
  {
    tag: "v0.1.4",
    date: "2026-08-28",
    changes: ["single-app-instance", "coordinated-hooks"],
  },
  {
    tag: "v0.1.3",
    date: "2026-08-28",
    changes: [
      "nested-iframe-locators",
      "single-flight-uploads",
      "account-clarity",
      "duplicate-launch-guard",
    ],
  },
  {
    tag: "v0.1.2",
    date: "2026-08-24",
    changes: [
      "native-menu-bar-app",
      "bundled-local-helper",
      "automatic-updates",
      "unified-macos-installer",
    ],
  },
  {
    tag: "v0.1.1",
    date: "2026-08-23",
    changes: [
      "element-and-area-capture",
      "local-helper-and-agent-hooks",
      "cloud-workspace-and-sharing",
      "plans-ai-and-storage",
      "privacy-and-legal-controls",
    ],
  },
] as const;

export function createReleaseContent(
  language: SupportedLanguage,
  locale: ReleaseLocale,
): ReleaseContent {
  const releases = releaseDefinitions.map((definition) => {
    const copy = locale.releases[definition.tag];
    const changes: Partial<
      Record<ReleaseChangeId, { description: string; title: string }>
    > = copy.changes;
    return {
      date: definition.date,
      tag: definition.tag,
      title: copy.title,
      summary: copy.summary,
      changes: definition.changes.map((id) => {
        const change = changes[id];
        if (!change) {
          throw new Error(`Missing ${definition.tag} release change: ${id}`);
        }
        return { id, ...change };
      }),
    };
  });
  return { language, releases, ui: locale.ui };
}

export const defaultReleaseContent = createReleaseContent(
  "en",
  englishReleaseLocale,
);

export function findProductRelease(content: ReleaseContent, version: string) {
  const tag = version.startsWith("v") ? version : `v${version}`;
  return content.releases.find((release) => release.tag === tag) ?? null;
}

type ReleaseLocaleModule = { default: ReleaseLocale };

const releaseLocaleLoaders = {
  en: () => Promise.resolve({ default: englishReleaseLocale }),
  pt: () => import("./release-locales/pt"),
  es: () => import("./release-locales/es"),
  fr: () => import("./release-locales/fr"),
  de: () => import("./release-locales/de"),
  zh: () => import("./release-locales/zh"),
  ja: () => import("./release-locales/ja"),
} satisfies Record<SupportedLanguage, () => Promise<ReleaseLocaleModule>>;

const releaseContentPromises = new Map<
  SupportedLanguage,
  Promise<ReleaseContent>
>();

export function loadReleaseContent(language: SupportedLanguage) {
  const cached = releaseContentPromises.get(language);
  if (cached) return cached;
  const promise = releaseLocaleLoaders[language]().then((module) =>
    createReleaseContent(language, module.default),
  );
  releaseContentPromises.set(language, promise);
  return promise;
}
