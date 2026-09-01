import type { SupportedLanguage } from "@pinar/shared";
import englishHelpLocale from "./help-locales/en";

export type HelpCategoryId = (typeof helpCategoryDefinitions)[number]["id"];
export type HelpArticleId = (typeof helpArticleDefinitions)[number]["id"];
export type HelpScreenshotKey =
  (typeof helpScreenshotDefinitions)[number]["key"];

export interface HelpSection {
  bullets?: string[];
  heading: string;
  paragraphs: string[];
}

export interface HelpScreenshot {
  alt: string;
  caption: string;
  height: number;
  key: HelpScreenshotKey;
  src: `/help/screenshots/${SupportedLanguage}/${HelpScreenshotKey}.webp`;
  width: number;
}

export interface HelpArticle {
  category: HelpCategoryId;
  id: HelpArticleId;
  popular?: boolean;
  readMinutes: number;
  screenshot: HelpScreenshot;
  sections: HelpSection[];
  sourceRefs: string[];
  summary: string;
  title: string;
}

export interface HelpCategory {
  description: string;
  id: HelpCategoryId;
  title: string;
}

export interface HelpUi {
  articlesFound: string;
  articleGuide: string;
  articleNotFound: string;
  articleNotFoundDescription: string;
  backToHelp: string;
  breadcrumb: string;
  categories: string;
  categoryArticles: string;
  categoryNotFound: string;
  categoryNotFoundDescription: string;
  explore: string;
  help: string;
  helpCategories: string;
  helpNavigation: string;
  homeDescription: string;
  homeHeading: string;
  homeMetaDescription: string;
  homeMetaTitle: string;
  minutes: string;
  noArticlesFound: string;
  notFoundDescription: string;
  onThisPage: string;
  openScreenshot: string;
  pageTitleSuffix: string;
  popularArticles: string;
  popularDescription: string;
  searchLabel: string;
  searchPlaceholder: string;
  searchResults: string;
  seeAllCategory: string;
  stillNeedContext: string;
  visualExample: string;
}

export interface HelpLocale {
  articles: Record<
    HelpArticleId,
    {
      sections: HelpSection[];
      summary: string;
      title: string;
    }
  >;
  categories: Record<
    HelpCategoryId,
    {
      description: string;
      title: string;
    }
  >;
  screenshots: Record<
    HelpScreenshotKey,
    {
      alt: string;
      caption: string;
    }
  >;
  ui: HelpUi;
}

export interface HelpContent {
  articles: HelpArticle[];
  categories: HelpCategory[];
  language: SupportedLanguage;
  ui: HelpUi;
}

export const helpCategoryDefinitions = [
  {
    id: "getting-started",
  },
  {
    id: "captures",
  },
  {
    id: "agents",
  },
  {
    id: "workspace",
  },
  {
    id: "cloud",
  },
  {
    id: "privacy",
  },
] as const;

export const helpScreenshotDefinitions = [
  {
    key: "sign-in-extension",
    height: 1279,
    width: 1200,
  },
  {
    key: "capture-workspace",
    height: 900,
    width: 1280,
  },
  {
    key: "getting-started",
    height: 720,
    width: 1280,
  },
  {
    key: "help-navigation",
    height: 1000,
    width: 1440,
  },
  {
    key: "privacy",
    height: 1000,
    width: 1440,
  },
  {
    key: "workspace-table",
    height: 1000,
    width: 1440,
  },
  {
    key: "sign-in-email",
    height: 1279,
    width: 1200,
  },
  {
    key: "pricing",
    height: 720,
    width: 1280,
  },
  {
    key: "updates",
    height: 1000,
    width: 1440,
  },
] as const;

export const helpArticleDefinitions = [
  {
    id: "install-pinar",
    category: "getting-started",
    readMinutes: 4,
    screenshotKey: "sign-in-extension",
    sourceRefs: [
      "apps/server/src/lib/chrome-extension.ts",
      "README.md",
      "apps/tray/src/bun/index.ts",
      "apps/tray/src/bun/local-server.ts",
      "install.sh",
      "install.ps1",
    ],
    popular: true,
  },
  {
    id: "first-capture",
    category: "getting-started",
    readMinutes: 3,
    screenshotKey: "capture-workspace",
    sourceRefs: [
      "README.md",
      "extension/content.js",
      "extension/keyboard.js",
      "packages/shared/src/handoff/index.ts",
    ],
    popular: true,
  },
  {
    id: "local-or-cloud",
    category: "getting-started",
    readMinutes: 4,
    screenshotKey: "getting-started",
    sourceRefs: [
      "apps/cli/src/history.mjs",
      "apps/server/src/server/api.local.ts",
      "apps/server/src/server/cloud-api.ts",
      "apps/server/src/server/local-capability.ts",
    ],
  },
  {
    id: "shortcuts-and-navigation",
    category: "getting-started",
    readMinutes: 3,
    screenshotKey: "help-navigation",
    sourceRefs: ["extension/content.js", "extension/keyboard.js", "README.md"],
  },
  {
    id: "capture-types",
    category: "captures",
    readMinutes: 4,
    screenshotKey: "capture-workspace",
    sourceRefs: [
      "extension/content.js",
      "extension/full-page.js",
      "extension/frame-path.js",
      "packages/shared/src/locators/fingerprint.ts",
    ],
    popular: true,
  },
  {
    id: "pins-and-comments",
    category: "captures",
    readMinutes: 4,
    screenshotKey: "capture-workspace",
    sourceRefs: [
      "packages/shared/src/pins/colors.ts",
      "packages/shared/src/types/index.ts",
      "packages/shared/src/visual-context/index.ts",
      "extension/content.js",
    ],
  },
  {
    id: "full-page-capture",
    category: "captures",
    readMinutes: 3,
    screenshotKey: "capture-workspace",
    sourceRefs: [
      "extension/full-page.js",
      "extension/background.js",
      "extension/content.js",
    ],
  },
  {
    id: "smart-selection",
    category: "captures",
    readMinutes: 5,
    screenshotKey: "capture-workspace",
    sourceRefs: [
      "packages/shared/src/locators/fingerprint.ts",
      "packages/shared/src/locators/resolve.ts",
      "extension/locators.js",
    ],
  },
  {
    id: "privacy-masks",
    category: "captures",
    readMinutes: 3,
    screenshotKey: "privacy",
    sourceRefs: [
      "extension/content.js",
      "packages/shared/src/privacy/sanitize.ts",
      "packages/shared/src/privacy/classify.ts",
    ],
  },
  {
    id: "copy-and-reopen",
    category: "captures",
    readMinutes: 5,
    screenshotKey: "workspace-table",
    sourceRefs: [
      "apps/server/src/pages/WebViewer.tsx",
      "apps/server/src/components/ImageZoomStage.tsx",
      "packages/shared/src/session-reopen/index.ts",
      "extension/session.js",
    ],
    popular: true,
  },
  {
    id: "send-to-agent",
    category: "agents",
    readMinutes: 4,
    screenshotKey: "capture-workspace",
    sourceRefs: [
      "packages/shared/src/handoff/index.ts",
      "packages/shared/src/visual-context/index.ts",
      "AGENTS.md",
      "extension/content.js",
    ],
    popular: true,
  },
  {
    id: "handoff-formats",
    category: "agents",
    readMinutes: 4,
    screenshotKey: "help-navigation",
    sourceRefs: [
      "packages/shared/src/handoff/index.ts",
      "packages/shared/src/types/index.ts",
      "apps/extension/src/options/OptionsApp.tsx",
    ],
  },
  {
    id: "closed-loop-review",
    category: "agents",
    readMinutes: 6,
    screenshotKey: "workspace-table",
    sourceRefs: [
      "packages/shared/src/agent-results/index.ts",
      "packages/shared/src/pin-review/index.ts",
      "docs/release-closed-loop.md",
      "apps/server/src/server/closed-loop.contract.ts",
    ],
    popular: true,
  },
  {
    id: "reopen-and-relocate",
    category: "agents",
    readMinutes: 5,
    screenshotKey: "capture-workspace",
    sourceRefs: [
      "packages/shared/src/session-reopen/index.ts",
      "extension/background.js",
      "extension/content.js",
      "extension/session.js",
    ],
  },
  {
    id: "handoff-troubleshooting",
    category: "agents",
    readMinutes: 5,
    screenshotKey: "help-navigation",
    sourceRefs: [
      "extension/offscreen.js",
      "extension/content.js",
      "packages/shared/src/handoff/index.ts",
    ],
  },
  {
    id: "organize-projects",
    category: "workspace",
    readMinutes: 5,
    screenshotKey: "capture-workspace",
    sourceRefs: [
      "apps/cli/src/history.mjs",
      "apps/server/src/pages/HistoryDashboard.tsx",
      "apps/server/src/lib/workspace-dnd.ts",
      "apps/server/src/lib/session-order.ts",
    ],
    popular: true,
  },
  {
    id: "nested-collections",
    category: "workspace",
    readMinutes: 4,
    screenshotKey: "capture-workspace",
    sourceRefs: [
      "apps/server/src/lib/collection-tree.ts",
      "apps/server/src/lib/workspace-dnd.ts",
      "apps/extension/src/options/OptionsApp.tsx",
      "packages/shared/src/types/index.ts",
    ],
  },
  {
    id: "find-manage-share",
    category: "workspace",
    readMinutes: 6,
    screenshotKey: "workspace-table",
    sourceRefs: [
      "apps/server/src/lib/session-filters.ts",
      "apps/server/src/pages/HistoryDashboard.tsx",
      "apps/server/src/pages/AggregateViewer.tsx",
      "apps/server/src/server/markdown.ts",
    ],
  },
  {
    id: "account-and-sign-in",
    category: "cloud",
    readMinutes: 5,
    screenshotKey: "sign-in-email",
    sourceRefs: [
      "README.md",
      "apps/server/src/server/cloud-api.ts",
      "apps/extension/src/options/OptionsApp.tsx",
    ],
    popular: true,
  },
  {
    id: "plans-and-billing",
    category: "cloud",
    readMinutes: 6,
    screenshotKey: "pricing",
    sourceRefs: [
      "apps/server/src/lib/entitlements.ts",
      "apps/server/src/lib/retention.ts",
      "apps/server/src/lib/pricing.ts",
      "apps/server/src/server/founder-capacity-store.ts",
      "apps/server/src/server/cloud-api.ts",
    ],
    popular: true,
  },
  {
    id: "ai-credits",
    category: "cloud",
    readMinutes: 4,
    screenshotKey: "pricing",
    sourceRefs: [
      "apps/server/src/lib/entitlements.ts",
      "apps/server/src/server/cloud-api.ts",
      "apps/server/src/components/GlobalSettingsDialog.tsx",
    ],
  },
  {
    id: "storage-and-retention",
    category: "cloud",
    readMinutes: 6,
    screenshotKey: "pricing",
    sourceRefs: [
      "apps/server/src/lib/entitlements.ts",
      "apps/server/src/lib/retention.ts",
      "README.md",
      "apps/server/src/lib/legal-documents.ts",
    ],
  },
  {
    id: "sharing-links",
    category: "cloud",
    readMinutes: 5,
    screenshotKey: "workspace-table",
    sourceRefs: [
      "apps/server/src/pages/AggregateViewer.tsx",
      "apps/server/src/server/markdown.ts",
      "apps/server/src/server/cloud-api.ts",
      "apps/server/src/lib/legal-documents.ts",
    ],
  },
  {
    id: "where-data-lives",
    category: "privacy",
    readMinutes: 5,
    screenshotKey: "privacy",
    sourceRefs: [
      "apps/cli/src/history.mjs",
      "apps/server/src/server/cloud-api.ts",
      "apps/server/src/lib/legal-documents.ts",
      "apps/server/src/components/GlobalSettingsDialog.tsx",
    ],
    popular: true,
  },
  {
    id: "automatic-sanitization",
    category: "privacy",
    readMinutes: 5,
    screenshotKey: "privacy",
    sourceRefs: [
      "packages/shared/src/privacy/types.ts",
      "packages/shared/src/privacy/classify.ts",
      "packages/shared/src/privacy/sanitize.ts",
      "packages/shared/src/visual-context/index.ts",
      "packages/shared/src/handoff/index.ts",
    ],
    popular: true,
  },
  {
    id: "local-security-and-recovery",
    category: "privacy",
    readMinutes: 6,
    screenshotKey: "updates",
    sourceRefs: [
      "apps/server/src/server/local-capability.ts",
      "apps/server/src/server/local-api-policy.ts",
      "apps/tray/src/bun/instance-lock.ts",
      "apps/cli/src/history.mjs",
      "apps/cli/src/shots.mjs",
    ],
  },
  {
    id: "telemetry-and-policies",
    category: "privacy",
    readMinutes: 6,
    screenshotKey: "privacy",
    sourceRefs: [
      "packages/shared/src/loop-metrics/index.ts",
      "apps/server/src/lib/legal-documents.ts",
      "LICENSE",
      "README.md",
    ],
  },
] as const;

export function createHelpContent(
  language: SupportedLanguage,
  locale: HelpLocale,
): HelpContent {
  const categories = helpCategoryDefinitions.map((definition) => ({
    ...definition,
    ...locale.categories[definition.id],
  }));
  const articles = helpArticleDefinitions.map((definition) => {
    const copy = locale.articles[definition.id];
    const screenshotDefinition = helpScreenshotDefinitions.find(
      (screenshot) => screenshot.key === definition.screenshotKey,
    );
    if (!screenshotDefinition) {
      throw new Error(
        `Missing help screenshot definition: ${definition.screenshotKey}`,
      );
    }
    const screenshotCopy = locale.screenshots[definition.screenshotKey];
    return {
      category: definition.category,
      id: definition.id,
      ...("popular" in definition && definition.popular
        ? { popular: true }
        : {}),
      readMinutes: definition.readMinutes,
      screenshot: {
        ...screenshotDefinition,
        ...screenshotCopy,
        src: `/help/screenshots/${language}/${definition.screenshotKey}.webp` as const,
      },
      sections: copy.sections,
      sourceRefs: [...definition.sourceRefs],
      summary: copy.summary,
      title: copy.title,
    } satisfies HelpArticle;
  });
  return { articles, categories, language, ui: locale.ui };
}

export const defaultHelpContent = createHelpContent("en", englishHelpLocale);

export function findHelpCategory(content: HelpContent, categoryId: string) {
  return (
    content.categories.find((category) => category.id === categoryId) ?? null
  );
}

export function articlesInCategory(
  content: HelpContent,
  categoryId: HelpCategoryId,
) {
  return content.articles.filter((article) => article.category === categoryId);
}

export function findHelpArticle(
  content: HelpContent,
  categoryId: string,
  articleId: string,
) {
  return (
    content.articles.find(
      (article) => article.category === categoryId && article.id === articleId,
    ) ?? null
  );
}

export function searchHelpArticles(content: HelpContent, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase(content.language);
  if (!normalizedQuery) return [];
  return content.articles.filter((article) => {
    const text = [
      article.title,
      article.summary,
      article.screenshot.alt,
      article.screenshot.caption,
      ...article.sections.flatMap((section) => [
        section.heading,
        ...section.paragraphs,
        ...(section.bullets ?? []),
      ]),
    ]
      .join(" ")
      .toLocaleLowerCase(content.language);
    return text.includes(normalizedQuery);
  });
}

type HelpLocaleModule = { default: HelpLocale };

const helpLocaleLoaders = {
  en: () => Promise.resolve({ default: englishHelpLocale }),
  pt: () => import("./help-locales/pt"),
  es: () => import("./help-locales/es"),
  fr: () => import("./help-locales/fr"),
  de: () => import("./help-locales/de"),
  zh: () => import("./help-locales/zh"),
  ja: () => import("./help-locales/ja"),
} satisfies Record<SupportedLanguage, () => Promise<HelpLocaleModule>>;

const helpContentPromises = new Map<SupportedLanguage, Promise<HelpContent>>();

export function loadHelpContent(language: SupportedLanguage) {
  const cached = helpContentPromises.get(language);
  if (cached) return cached;
  const promise = helpLocaleLoaders[language]().then((module) =>
    createHelpContent(language, module.default),
  );
  helpContentPromises.set(language, promise);
  return promise;
}
