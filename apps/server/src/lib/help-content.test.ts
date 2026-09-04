import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, test } from "node:test";
import {
  articlesInCategory,
  defaultHelpContent,
  findHelpArticle,
  loadHelpContent,
  searchHelpArticles,
} from "./help-content";
import { SUPPORTED_LANGUAGES, translations } from "@pinar/shared";

const expectedArticleCounts = {
  agents: 5,
  captures: 6,
  cloud: 5,
  "getting-started": 4,
  privacy: 4,
  workspace: 3,
} as const;

async function loadEveryHelpLocale() {
  return Promise.all(
    SUPPORTED_LANGUAGES.map((language) => loadHelpContent(language)),
  );
}

function markdownCodeSpanCount(text: string) {
  return text.match(/`[^`]+`/g)?.length ?? 0;
}

function markdownLinkTargets(text: string) {
  return [...text.matchAll(/\[(?:[^\]]*)\]\(([^)]+)\)/g)].map(
    (match) => match[1],
  );
}

function quoteHelpUiLabel(language: string, label: string) {
  if (language === "de") return `„${label}“`;
  if (language === "fr") return `« ${label} »`;
  if (language === "ja" || language === "zh") return `「${label}」`;
  return `“${label}”`;
}

describe("help content", () => {
  test("keeps English synchronous and memoizes lazy locale loads", async () => {
    assert.equal(defaultHelpContent.language, "en");
    const frenchContent = loadHelpContent("fr");
    assert.equal(loadHelpContent("fr"), frenchContent);
    assert.equal((await frenchContent).language, "fr");
  });
  test("ships the designed six-category, 27-article catalog in every locale", async () => {
    const contents = await loadEveryHelpLocale();
    for (const content of contents) {
      assert.equal(content.categories.length, 6, content.language);
      assert.equal(content.articles.length, 27, content.language);
      for (const category of content.categories) {
        assert.equal(
          articlesInCategory(content, category.id).length,
          expectedArticleCounts[category.id],
          `${content.language}:${category.id}`,
        );
      }
    }
  });

  test("keeps every locale structurally identical and fully translated", async () => {
    const [english, ...translations] = await loadEveryHelpLocale();
    const expectedArticleIds = english.articles.map((article) => article.id);
    const expectedCategoryIds = english.categories.map(
      (category) => category.id,
    );
    const expectedShapes = english.articles.map((article) =>
      article.sections.map((section) => ({
        bullets: section.bullets?.length ?? 0,
        paragraphs: section.paragraphs.length,
      })),
    );

    for (const content of translations) {
      assert.deepEqual(
        content.articles.map((article) => article.id),
        expectedArticleIds,
        content.language,
      );
      assert.deepEqual(
        content.categories.map((category) => category.id),
        expectedCategoryIds,
        content.language,
      );
      assert.deepEqual(
        content.articles.map((article) =>
          article.sections.map((section) => ({
            bullets: section.bullets?.length ?? 0,
            paragraphs: section.paragraphs.length,
          })),
        ),
        expectedShapes,
        content.language,
      );
      assert.notEqual(
        content.ui.homeHeading,
        english.ui.homeHeading,
        content.language,
      );
      assert.notEqual(
        content.articles.map((article) => article.summary).join("\n"),
        english.articles.map((article) => article.summary).join("\n"),
        content.language,
      );
    }
  });

  test("keeps every route unique, detailed, traceable, and illustrated", async () => {
    for (const content of await loadEveryHelpLocale()) {
      const routes = new Set<string>();
      for (const article of content.articles) {
        const route = `${article.category}/${article.id}`;
        assert.equal(
          routes.has(route),
          false,
          `duplicate help route: ${route}`,
        );
        routes.add(route);

        assert.ok(article.title.length > 2, `${content.language}:${route}`);
        assert.ok(article.summary.length > 10, `${content.language}:${route}`);
        assert.ok(article.sections.length >= 2, `${content.language}:${route}`);
        const guidanceItems = article.sections.reduce(
          (total, section) =>
            total + section.paragraphs.length + (section.bullets?.length ?? 0),
          0,
        );
        assert.ok(guidanceItems >= 7, `${content.language}:${route}`);
        assert.ok(article.sourceRefs.length > 0, route);
        assert.match(
          article.screenshot.src,
          new RegExp(`^/help/screenshots/${content.language}/[a-z-]+\\.webp$`),
        );
        assert.ok(
          article.screenshot.alt.length > 8,
          `${content.language}:${route}`,
        );
        assert.ok(
          article.screenshot.caption.length > 12,
          `${content.language}:${route}`,
        );
        assert.ok(article.screenshot.width >= 1200);
        assert.ok(article.screenshot.height >= 720);
        assert.equal(
          existsSync(
            new URL(`../../public${article.screenshot.src}`, import.meta.url),
          ),
          true,
          `missing help screenshot: ${article.screenshot.src}`,
        );
        for (const section of article.sections) {
          for (const screenshot of section.screenshots ?? []) {
            assert.equal(
              existsSync(
                new URL(`../../public${screenshot.src}`, import.meta.url),
              ),
              true,
              `missing help screenshot: ${screenshot.src}`,
            );
          }
        }
        assert.equal(
          findHelpArticle(content, article.category, article.id),
          article,
        );
      }
    }
  });

  test("searches the active locale without an English fallback", async () => {
    for (const content of await loadEveryHelpLocale()) {
      const article = content.articles.find(
        (candidate) => candidate.id === "first-capture",
      );
      assert.ok(article);
      const localizedQuery = article.title.slice(
        0,
        Math.min(article.title.length, 8),
      );
      assert.ok(
        searchHelpArticles(content, localizedQuery).some(
          (candidate) => candidate.id === article.id,
        ),
        content.language,
      );
      assert.deepEqual(searchHelpArticles(content, "   "), []);
    }

    const english = await loadHelpContent("en");
    const portuguese = await loadHelpContent("pt");
    assert.ok(
      searchHelpArticles(english, "screenshot_missing").some(
        (article) => article.id === "send-to-agent",
      ),
    );
    assert.ok(
      searchHelpArticles(portuguese, "captureId").some(
        (article) => article.id === "pins-and-comments",
      ),
    );
  });

  test("keeps published help copy free of internal implementation details", async () => {
    const forbidden = [
      /127\.0\.0\.1/i,
      /1737[0-9]/,
      /\/api\//,
      /tray\.pid/i,
      /local-capability/i,
      /0o600/,
      /\b0600\b/,
      /untrusted_app/,
      /session_mismatch/,
      /PINAR_PORT/,
      /PINAR_HOME/,
      /PINAR_CAPABILITY/,
      /FOUNDER_SALES/,
      /FOUNDER_CAPACITY/,
      /x-pinar-capability/i,
      /idempotency_conflict/,
      /legal_acceptance_required/,
      /retention_expires_at/,
      /\bD1\b/,
      /\bR2\b/,
      /pinar ensure/,
      /install-hooks/,
      /LaunchAgent/,
      /launchctl/,
      /SqliteHistoryDb/,
      /history\.db/,
      /history\.json/,
      /localStorage/,
      /Cache-Control/,
      /Authorization Bearer/i,
      /chrome-extension:\/\//,
      /readOrCreateLocalCapability/,
      /humanActionsForStatus/,
      /forbidden_fields/,
      /ai_request_in_progress/,
      /ai_refund_pending/,
      /insufficient_ai_credits/,
      /ai_unavailable/,
      /owner_preferences/,
      /email_challenges/,
      /@cf\//,
      /stripeCustomerId/,
      /founderState/,
      /~\/\.pinar/,
      /Workers AI/,
      /Pinar\.app/,
      /Pinar-App/,
      /install\.ps1/,
      /\bapp Pinar\b/i,
      /aplicativo Pinar/i,
    ];

    for (const content of await loadEveryHelpLocale()) {
      const published: string[] = [
        content.ui.homeHeading,
        content.ui.homeDescription,
        content.ui.homeMetaTitle,
        content.ui.homeMetaDescription,
      ];
      for (const category of content.categories) {
        published.push(category.title, category.description);
      }
      for (const article of content.articles) {
        published.push(
          article.title,
          article.summary,
          article.screenshot.alt,
          article.screenshot.caption,
        );
        for (const section of article.sections) {
          published.push(section.heading, ...section.paragraphs);
          if (section.bullets) published.push(...section.bullets);
        }
      }

      for (const text of published) {
        for (const pattern of forbidden) {
          assert.equal(
            pattern.test(text),
            false,
            `${content.language} leaked ${pattern}: ${text.slice(0, 180)}`,
          );
        }
      }
    }
  });

  test("keeps Markdown code spans and link targets identical across locales", async () => {
    const [english, ...translations] = await loadEveryHelpLocale();

    for (const content of translations) {
      for (const [articleIndex, article] of content.articles.entries()) {
        const englishArticle = english.articles[articleIndex];
        for (const [sectionIndex, section] of article.sections.entries()) {
          const englishSection = englishArticle.sections[sectionIndex];
          for (const [
            paragraphIndex,
            paragraph,
          ] of section.paragraphs.entries()) {
            const path = `${content.language}:${article.id}:section ${sectionIndex}:paragraph ${paragraphIndex}`;
            assert.equal(
              markdownCodeSpanCount(paragraph),
              markdownCodeSpanCount(englishSection.paragraphs[paragraphIndex]),
              path,
            );
            assert.deepEqual(
              markdownLinkTargets(paragraph),
              markdownLinkTargets(englishSection.paragraphs[paragraphIndex]),
              path,
            );
          }
          const bullets = section.bullets ?? [];
          const englishBullets = englishSection.bullets ?? [];
          for (const [bulletIndex, bullet] of bullets.entries()) {
            const path = `${content.language}:${article.id}:section ${sectionIndex}:bullet ${bulletIndex}`;
            assert.equal(
              markdownCodeSpanCount(bullet),
              markdownCodeSpanCount(englishBullets[bulletIndex]),
              path,
            );
            assert.deepEqual(
              markdownLinkTargets(bullet),
              markdownLinkTargets(englishBullets[bulletIndex]),
              path,
            );
          }
        }
      }
    }
  });

  test("wraps keyboard shortcuts in code spans in every article", async () => {
    const shortcutKeys = [
      "Command/Ctrl+Enter",
      "Command+Enter",
      "Ctrl+Enter",
      "Shift+Enter",
      "Alt+Shift+P",
      "Arrow Up",
      "Arrow Down",
      "Escape",
      "Enter",
    ];
    const localizedShortcutKeys: Record<string, string[]> = {
      pt: ["Seta para cima", "Seta para baixo"],
    };

    function textOutsideCodeSpans(text: string) {
      return text.replace(/`[^`]+`/g, " ");
    }

    for (const content of await loadEveryHelpLocale()) {
      const firstCapture = findHelpArticle(
        content,
        "getting-started",
        "first-capture",
      );
      assert.ok(firstCapture);
      const firstCaptureText = firstCapture.sections
        .flatMap((section) => [
          ...section.paragraphs,
          ...(section.bullets ?? []),
        ])
        .join("\n");
      assert.match(firstCaptureText, /`Command\/Ctrl\+Enter`/);
      assert.match(firstCaptureText, /`Command\+Enter`/);
      assert.match(firstCaptureText, /`Ctrl\+Enter`/);
      assert.match(firstCaptureText, /`Shift\+Enter`/);
      assert.match(firstCaptureText, /`Escape`/);
      assert.match(firstCaptureText, /`Enter`/);

      const keys = [
        ...shortcutKeys,
        ...(localizedShortcutKeys[content.language] ?? []),
      ];
      for (const article of content.articles) {
        const published = article.sections.flatMap((section) => [
          ...section.paragraphs,
          ...(section.bullets ?? []),
        ]);
        for (const text of published) {
          const leftover = textOutsideCodeSpans(text);
          for (const key of keys) {
            assert.equal(
              leftover.includes(key),
              false,
              `${content.language}:${article.id} left ${key} outside a code span: ${text.slice(0, 180)}`,
            );
          }
        }
      }
    }
  });

  test("install-pinar tells Windows users how to continue past the first-run block", async () => {
    const expected = {
      de: [
        "Windows hat Ihren PC geschützt",
        "Weitere Informationen",
        "Trotzdem ausführen",
      ],
      en: ["Windows protected your PC", "More info", "Run anyway"],
      es: ["Windows protegió tu PC", "Más información", "Ejecutar de todas formas"],
      fr: ["Windows a protégé votre PC", "Plus d’infos", "Exécuter quand même"],
      ja: [
        "Windows によって PC が保護されました",
        "詳細情報",
        "実行する",
      ],
      pt: [
        "O Windows protegeu seu PC",
        "Mais informações",
        "Executar mesmo assim",
      ],
      zh: ["Windows 已保护你的电脑", "更多信息", "仍要运行"],
    } as const;

    for (const content of await loadEveryHelpLocale()) {
      const article = findHelpArticle(
        content,
        "getting-started",
        "install-pinar",
      );
      assert.ok(article);
      const published = article.sections
        .flatMap((section) => [
          ...section.paragraphs,
          ...(section.bullets ?? []),
        ])
        .join("\n");
      for (const label of expected[content.language]) {
        assert.match(
          published,
          new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
          `${content.language}:${label}`,
        );
      }
    }
  });

  test("install-pinar downloads a Windows exe installer like the macOS disk image", async () => {
    for (const content of await loadEveryHelpLocale()) {
      const article = findHelpArticle(
        content,
        "getting-started",
        "install-pinar",
      );
      assert.ok(article);
      const published = article.sections
        .flatMap((section) => [
          ...section.paragraphs,
          ...(section.bullets ?? []),
        ])
        .join("\n");
      assert.match(published, /win-x64-Pinar-Setup\.zip/);
      assert.match(published, /Pinar-Setup\.exe/);
      assert.match(published, /\.installer/);
      assert.doesNotMatch(published, /install\.ps1/);
      assert.doesNotMatch(published, /win-x64-Pinar-Setup\.exe/);
    }
  });

  test("gives every article its own cover file", async () => {
    for (const content of await loadEveryHelpLocale()) {
      const keys = content.articles.map((article) => article.screenshot.key);
      assert.equal(keys.length, 27, content.language);
      assert.equal(new Set(keys).size, 27, content.language);
    }
  });

  test("illustrates overlay articles with the matching overlay cover", async () => {
    const overlayArticles = {
      "capture-types": "capture-types",
      "first-capture": "capture-toolbar",
      "full-page-capture": "capture-full-page",
      "handoff-troubleshooting": "capture-copy-failed",
      "pins-and-comments": "capture-pins",
      "privacy-masks": "capture-masks",
      "reopen-and-relocate": "capture-review",
      "send-to-agent": "capture-copied",
      "smart-selection": "capture-selection",
    } as const;

    for (const content of await loadEveryHelpLocale()) {
      for (const [articleId, screenshotKey] of Object.entries(overlayArticles)) {
        const article = content.articles.find((item) => item.id === articleId);
        assert.ok(article, `${content.language}:${articleId}`);
        assert.match(
          article.screenshot.src,
          new RegExp(`/${screenshotKey}\\.webp$`),
          `${content.language}:${articleId}`,
        );
      }
      const formats = findHelpArticle(content, "agents", "handoff-formats");
      assert.ok(formats);
      assert.match(formats.screenshot.src, /\/extension-preferences\.webp$/);
    }
  });

  test("pairs every article hero with a screenshot of the UI that article describes", async () => {
    const expected = {
      "account-and-sign-in": "sign-in-email",
      "ai-credits": "pricing-credits",
      "automatic-sanitization": "preferences-privacy",
      "capture-types": "capture-types",
      "closed-loop-review": "workspace-review",
      "copy-and-reopen": "capture-viewer",
      "find-manage-share": "workspace-table",
      "first-capture": "capture-toolbar",
      "full-page-capture": "capture-full-page",
      "handoff-formats": "extension-preferences",
      "handoff-troubleshooting": "capture-copy-failed",
      "install-pinar": "install-pinar",
      "local-or-cloud": "extension-options",
      "local-security-and-recovery": "workspace-security",
      "nested-collections": "workspace-nested",
      "organize-projects": "capture-workspace",
      "pins-and-comments": "capture-pins",
      "plans-and-billing": "pricing",
      "privacy-masks": "capture-masks",
      "reopen-and-relocate": "capture-review",
      "send-to-agent": "capture-copied",
      "sharing-links": "sharing-markdown",
      "shortcuts-and-navigation": "capture-shortcuts",
      "smart-selection": "capture-selection",
      "storage-and-retention": "legal-retention",
      "telemetry-and-policies": "privacy",
      "where-data-lives": "options-local",
    } as const;

    for (const content of await loadEveryHelpLocale()) {
      assert.deepEqual(
        Object.fromEntries(
          content.articles.map((article) => [article.id, article.screenshot.key]),
        ),
        expected,
        content.language,
      );
    }
  });

  test("illustrates local-or-cloud with extension options and sign-in screenshots", async () => {
    for (const content of await loadEveryHelpLocale()) {
      const article = findHelpArticle(
        content,
        "getting-started",
        "local-or-cloud",
      );
      assert.ok(article);
      assert.match(article.screenshot.src, /\/extension-options\.webp$/);
      const sectionScreenshots = article.sections.flatMap(
        (section) => section.screenshots ?? [],
      );
      assert.deepEqual(
        sectionScreenshots.map((screenshot) => screenshot.key),
        ["sign-in-extension", "sign-in-email"],
        content.language,
      );
    }
  });

  test("quotes workspace and legal UI labels in local-or-cloud", async () => {
    for (const content of await loadEveryHelpLocale()) {
      const article = findHelpArticle(
        content,
        "getting-started",
        "local-or-cloud",
      );
      assert.ok(article);
      const published = article.sections
        .flatMap((section) => [
          ...section.paragraphs,
          ...(section.bullets ?? []),
        ])
        .join("\n");
      const catalog = translations[content.language];
      for (const label of [
        "Personal",
        "Inbox",
        "Free",
        catalog.legal_terms,
        catalog.legal_privacy,
        catalog.legal_acceptable_use,
      ]) {
        const quoted = quoteHelpUiLabel(content.language, label);
        assert.ok(
          published.includes(quoted),
          `${content.language} missing quoted ${label}: ${quoted}`,
        );
      }
    }
  });

  test("quotes overlay UI labels as citations in every locale", async () => {
    const keys = [
      "overlay_add_pin_first",
      "overlay_copied",
      "overlay_copy_failed",
      "overlay_copying",
      "overlay_helper_unavailable",
      "overlay_no_screenshot",
      "overlay_no_viewer",
      "overlay_origin_mismatch",
      "overlay_write_comment",
    ] as const;

    for (const content of await loadEveryHelpLocale()) {
      const published = content.articles
        .flatMap((article) =>
          article.sections.flatMap((section) => [
            ...section.paragraphs,
            ...(section.bullets ?? []),
          ]),
        )
        .join("\n");
      const catalog = translations[content.language];
      for (const key of keys) {
        const quoted = quoteHelpUiLabel(content.language, catalog[key]);
        assert.ok(
          published.includes(quoted),
          `${content.language} missing quoted ${key}: ${quoted}`,
        );
      }
    }
  });
});
