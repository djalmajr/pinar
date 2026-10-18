import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, test } from "node:test";
import {
  articlesInCategory,
  defaultHelpContent,
  findHelpArticle,
  type HelpArticle,
  loadHelpContent,
  searchHelpArticles,
} from "./help-content";
import {
  findProductRelease,
  loadReleaseContent,
} from "./release-content";
import { SUPPORTED_LANGUAGES, translations } from "@pinar/shared";

const expectedArticleCounts = {
  agents: 6,
  captures: 6,
  cloud: 6,
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
  test("ships the designed six-category, 29-article catalog in every locale", async () => {
    const contents = await loadEveryHelpLocale();
    for (const content of contents) {
      assert.equal(content.categories.length, 6, content.language);
      assert.equal(content.articles.length, 29, content.language);
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

  test("attributes AI credit consumption to Pinar Cloud in every locale", async () => {
    const creditTerms = /credit|cr[eé]dito|crédit|guthaben|クレジット|积分/i;
    const costTerms = /\b(?:1|3|5|10|15)\b/;

    for (const content of await loadEveryHelpLocale()) {
      const creditArticle = content.articles.find((article) => article.id === "ai-credits");
      assert.ok(creditArticle, `${content.language}:ai-credits`);
      assert.match(creditArticle.summary, /Pinar Cloud/, `${content.language}:ai-credits:summary`);
      assert.match(
        creditArticle.sections[0]?.paragraphs[0] ?? "",
        /Pinar Cloud/,
        `${content.language}:ai-credits:cost`,
      );

      for (const article of content.articles) {
        if (article.id === "ai-credits" || article.id === "plans-and-billing") continue;
        for (const section of article.sections) {
          for (const paragraph of section.paragraphs) {
            if (!creditTerms.test(paragraph) || !costTerms.test(paragraph)) continue;
            assert.match(
              paragraph,
              /Pinar Cloud/,
              `${content.language}:${article.id}:${section.heading}`,
            );
          }
        }
      }
    }
  });

  test("describes hosted Cloud by current offer instead of a permanent Free quota", async () => {
    const banned = /250\s*(?:MB|Mo)|armazenamento base na nuvem|almacenamiento base en la nube|stockage cloud de base|Basis-Cloud-Speicher|基本クラウドストレージは 250|基础云存储/;
    const required = {
      en: /temporary evaluation.*legacy eligibility.*voice transcription stays a Pro benefit.*Plans page.*account entitlements/s,
      pt: /avaliação temporária.*elegibilidade legada.*benefício Pro.*página Planos.*direitos da conta/s,
      es: /evaluación temporal.*elegibilidad heredada.*beneficio de Pro.*página Planes.*derechos de la cuenta/s,
      fr: /évaluation temporaire.*éligibilité héritée.*avantage Pro.*page Plans.*droits du compte/s,
      de: /zeitlich begrenzte Evaluierung.*bestehende Berechtigung.*Pro-Vorteil.*Plans-Seite.*Kontoberechtigungen/s,
      ja: /一時的な評価.*従来の対象条件.*Pro の特典.*プランページ.*アカウントの権利/s,
      zh: /临时评估.*原有资格.*Pro 权益.*定价页.*账户权益/s,
    } as const;

    for (const content of await loadEveryHelpLocale()) {
      const plans = content.articles.find((article) => article.id === "plans-and-billing");
      const storage = content.articles.find((article) => article.id === "storage-and-retention");
      assert.ok(plans, content.language);
      assert.ok(storage, content.language);
      const plansText = plans.sections.flatMap((section) => section.paragraphs).join(" ");
      const storageText = [
        ...storage.sections.flatMap((section) => section.paragraphs),
        ...storage.sections.flatMap((section) => section.bullets ?? []),
      ].join(" ");
      const catalog = [plansText, storageText].join(" ");
      assert.doesNotMatch(catalog, banned, content.language);
      assert.match(plansText, required[content.language], content.language);
      assert.match(storageText, /30/, `${content.language}:retention`);
      assert.match(storageText, /90/, `${content.language}:recovery`);
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
      "Command+Enter",
      "Alt+Enter",
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
      assert.match(firstCaptureText, /`Command\+Enter`/);
      assert.match(firstCaptureText, /`Alt\+Enter`/);
      assert.doesNotMatch(firstCaptureText, /Ctrl\+Enter/);
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
      assert.equal(keys.length, 29, content.language);
      assert.equal(new Set(keys).size, 29, content.language);
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
      "ai-features": "capture-review",
      "ai-credits": "pricing-credits",
      assistant: "assistant",
      "automatic-sanitization": "preferences-privacy",
      "capture-types": "capture-types",
      "closed-loop-review": "workspace-review",
      "copy-and-view": "capture-viewer",
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
      "own-ai-endpoint": "own-ai-endpoint",
      "pins-and-comments": "capture-pins",
      "plans-and-billing": "pricing",
      "privacy-masks": "capture-masks",
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
        ["sign-in-email"],
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

  test("publishes the assistant article in all seven locales, translated and linked", async () => {
    const contents = await loadEveryHelpLocale();
    assert.deepEqual(
      contents.map((content) => content.language).sort(),
      ["de", "en", "es", "fr", "ja", "pt", "zh"],
    );
    const english = findHelpArticle(contents[0], "agents", "assistant");
    assert.ok(english);
    const englishTexts = articleTexts(english);

    for (const content of contents) {
      const article = findHelpArticle(content, "agents", "assistant");
      assert.ok(article, `${content.language}:agents/assistant`);
      assert.match(article.screenshot.src, /\/assistant\.webp$/, content.language);

      // Every link out of the article reaches a published help route: the
      // credit guide is linked twice (the Pro/credits section and the
      // automatic collection choice section), plus the data-location guide.
      const targets = article.sections.flatMap((section) =>
        [...section.paragraphs, ...(section.bullets ?? [])].flatMap(markdownLinkTargets),
      );
      assert.deepEqual(
        targets,
        [
          "/help/cloud/ai-credits",
          "/help/cloud/ai-credits",
          "/help/privacy/where-data-lives",
        ],
        content.language,
      );
      for (const target of targets) {
        const [, , categoryId, articleId] = target.split("/");
        assert.ok(
          findHelpArticle(content, categoryId, articleId),
          `${content.language}: ${target} does not resolve`,
        );
      }

      if (content.language === "en") continue;
      const texts = articleTexts(article);
      assert.equal(texts.length, englishTexts.length, content.language);
      for (const [index, text] of texts.entries()) {
        assert.notEqual(
          text,
          englishTexts[index],
          `${content.language}:assistant left English copy: ${text.slice(0, 120)}`,
        );
      }
    }
  });

  test("prices assistant messages next to voice in the Pinar Cloud credit guide", async () => {
    // The guide used to call voice the only feature that spends credits.
    const onlyVoice = {
      de: /einzige Pinar-Funktion/,
      en: /only Pinar feature/,
      es: /única función de Pinar/,
      fr: /seule fonction Pinar/,
      ja: /唯一のPinar機能/,
      pt: /única funcionalidade do Pinar/,
      zh: /唯一消耗/,
    } as const;
    const packsNeedPro = {
      de: /nur mit Pro gekauft werden/,
      en: /can only be bought with Pro/,
      es: /solo se pueden comprar con Pro/,
      fr: /ne peuvent être achetés qu’avec Pro/,
      ja: /パックは Pro でのみ購入できます/,
      pt: /só podem ser comprados com o Pro/,
      zh: /只能在拥有 Pro 时购买/,
    } as const;

    for (const content of await loadEveryHelpLocale()) {
      const credits = findHelpArticle(content, "cloud", "ai-credits");
      assert.ok(credits, content.language);
      const text = articleTexts(credits).join("\n");
      assert.doesNotMatch(text, onlyVoice[content.language], content.language);
      const assistantCost = credits.sections[0]?.paragraphs[1] ?? "";
      assert.match(assistantCost, /Pinar Cloud/, `${content.language}:assistant cost`);
      assert.match(assistantCost, /\b3\b/, `${content.language}:assistant cost`);
      assert.match(
        credits.sections[1]?.paragraphs[0] ?? "",
        packsNeedPro[content.language],
        `${content.language}:packs need Pro`,
      );
    }
  });

  test("says where new captures go while the automatic destination stays on without AI (A45)", async () => {
    const inboxWithoutAi = {
      de: /ohne verfügbare KI eingeschaltet.*Posteingang.*schalte (?:die Option|sie) aus\./s,
      en: /stays on (?:while AI is not available|without AI available), new captures go to the “?Inbox”?; to choose the destination yourself, turn (?:the option|it) off\./,
      es: /activada sin la IA disponible, las capturas nuevas van a la “?Bandeja de entrada”?; para elegir el destino a mano, desact[ií]v(?:a la opción|ala)\./,
      fr: /reste activée sans IA disponible, les nouvelles captures vont dans la (?:« )?Boîte de réception(?: »)? ; pour choisir vous-même la destination, désactivez(?: l’option|-la)\./,
      ja: /AI を利用できない.*新しいキャプチャは「?受信トレイ」?に入ります。保存先を自分で選ぶには、オプションをオフにしてください。/,
      pt: /ligada sem a IA disponível, as capturas novas vão para a “?Caixa de entrada”?; para escolher o destino à mão, desligue a opção\./,
      zh: /AI 不可用时此选项仍保持开启，新捕获会进入「?收件箱」?；要自己选择目标，请关闭此选项。/,
    } as const;

    for (const content of await loadEveryHelpLocale()) {
      const article = findHelpArticle(content, "agents", "assistant");
      assert.ok(article, content.language);
      assert.match(article.sections[6]?.paragraphs[0] ?? "", inboxWithoutAi[content.language], `${content.language}:help`);
      const release = await loadReleaseContent(content.language);
      const note = findProductRelease(release, "v0.8.0")?.changes.find((change) => change.id === "automatic-capture-destination");
      assert.ok(note, `${content.language}:note`);
      assert.match(note.description, inboxWithoutAi[content.language], `${content.language}:note`);
    }
  });

  test("no locale keeps the free-reproduction claim in Pinar Cloud (A53)", async () => {
    // The guide used to say that reproduction in Pinar Cloud does not debit
    // AI credits; the section now prices the generation and links the credit
    // guide, the automatic collection choice does the same, and the credit
    // guide no longer calls reproduction free.
    const reproHeading = {
      de: "Reproduktion in Pinar Cloud",
      en: "Reproduction in Pinar Cloud",
      es: "Reproducción en Pinar Cloud",
      fr: "La reproduction dans Pinar Cloud",
      ja: "Pinar Cloud での再現",
      pt: "Reprodução no Pinar Cloud",
      zh: "Pinar Cloud 中的复现",
    } as const;
    const filingHeading = {
      de: "Pinar die Sammlung wählen lassen",
      en: "Let Pinar choose the collection",
      es: "Deja que Pinar elija la colección",
      fr: "Laisser Pinar choisir la collection",
      ja: "Pinar にコレクションを選ばせる",
      pt: "Deixe o Pinar escolher a coleção",
      zh: "让 Pinar 选择集合",
    } as const;
    const freeClaim = {
      de: /ohne KI-Guthaben|zieht keine KI-Credits/,
      en: /without debiting|do not debit/,
      es: /sin descontar|no descuenta/,
      fr: /sans débiter|ne débite/,
      ja: /クレジットを消費せず|クレジットを消費しません/,
      pt: /sem debitar|não debita/,
      zh: /不会扣除|不扣除/,
    } as const;

    for (const content of await loadEveryHelpLocale()) {
      const features = findHelpArticle(content, "agents", "ai-features");
      assert.ok(features, `${content.language}:ai-features`);
      const repro = features.sections.find(
        (section) => section.heading === reproHeading[content.language],
      );
      assert.ok(repro, `${content.language}:reproduction section`);
      const reproText = repro.paragraphs.join("\n");
      assert.doesNotMatch(reproText, freeClaim[content.language], `${content.language}:reproduction free`);
      assert.match(reproText, /Pinar Cloud/, `${content.language}:reproduction cost`);
      assert.match(reproText, /\b1\b/, `${content.language}:reproduction cost`);
      assert.deepEqual(
        markdownLinkTargets(reproText),
        ["/help/cloud/ai-credits"],
        `${content.language}:reproduction link`,
      );

      const assistant = findHelpArticle(content, "agents", "assistant");
      assert.ok(assistant, `${content.language}:assistant`);
      const filing = assistant.sections.find(
        (section) => section.heading === filingHeading[content.language],
      );
      assert.ok(filing, `${content.language}:filing section`);
      const filingText = filing.paragraphs.join("\n");
      assert.doesNotMatch(filingText, freeClaim[content.language], `${content.language}:filing free`);
      assert.match(filingText, /Pinar Cloud/, `${content.language}:filing cost`);
      assert.match(filingText, /\b1\b/, `${content.language}:filing cost`);

      const credits = findHelpArticle(content, "cloud", "ai-credits");
      assert.ok(credits, `${content.language}:ai-credits`);
      assert.doesNotMatch(
        articleTexts(credits).join("\n"),
        freeClaim[content.language],
        `${content.language}:credit guide free`,
      );
    }
  });

  test("keeps the assistant, AI and credit guides and upcoming notes free of internal terms", async () => {
    // Internal component names, retrieval jargon, and model or vendor names
    // never reach these user texts, in any locale. "Semantic search model"
    // stays allowed: it is the plain way to explain the local text search.
    const internalTerms = [
      /gateway|ゲートウェイ|网关/i,
      /appliance/i,
      /\bcadeia\b|\bchain\b|\bcadena\b|\bchaîne\b|\bKette\b|チェーン|模型链/i,
      /embedding|Einbettung|埋め込み|嵌入/i,
      /\bdecisions?\b/i,
      /similarit|similitud|Ähnlichkeit|類似度|相似度/i,
      /fallback|\brepli\b|respaldo|フォールバック|回退/i,
      /\btokens?\b|トークン|令牌|词元/i,
      /language model|modelo de linguagem|modelo de lenguaje|modèle de langage|Sprachmodell|言語モデル|语言模型|\bLLM\b/i,
      // Vendor and model names in any case, a version suffix included
      // ("qwen3", "GPT-4o"), but not a longer word ("llamada", "coherente").
      /\b(?:openai|anthropic|claude|gpt|gemini|gemma|llama|qwen|mistral|deepseek|ollama|lm studio|whisper|cloudflare|workers ai|kimi|grok|groq|cohere|hugging ?face)(?![a-z])/i,
    ];
    // The AI settings field asks for an endpoint compatible with this API and
    // its own label names it, so the AI features guide may quote the phrase,
    // exactly as written there.
    const protocolPhrases = [
      /OpenAI-compatible/g,
      /compatível com a OpenAI/g,
      /compatible con OpenAI/g,
      /compatible OpenAI/g,
      /OpenAI-kompatible(?:r|n)?/g,
      /OpenAI 互換/g,
      /OpenAI 兼容/g,
    ];
    // The BYOK settings and the own-ai-endpoint guide quote the embedding
    // capability and model labels exactly as the UI shows them ("Embeddings",
    // "Modelo de embedding", "嵌入", …): the scan strips those exact labels,
    // per language, not the word in general. The boundaries keep the strip
    // from eating a longer word that only starts with the label ("Embedding
    // models"): the lookarounds test ASCII word characters only, so they
    // still hold in zh and ja, where words are not space-separated.
    const embeddingUiLabels: Record<string, string[]> = {
      de: ["Embedding-Modell", "Embeddings"],
      en: ["Embedding model", "Embeddings"],
      es: ["Modelo de embedding", "Embeddings"],
      fr: ["Modèle d’embedding", "Embeddings"],
      ja: ["embedding モデル", "embedding"],
      pt: ["Modelo de embedding", "Embeddings"],
      zh: ["嵌入模型", "嵌入"],
    };
    const asWholeLabel = (label: string) =>
      new RegExp(
        `(?<![A-Za-z0-9])${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`,
        "g",
      );
    const withoutUiLabels = (text: string, language: string) =>
      protocolPhrases
        .concat((embeddingUiLabels[language] ?? []).map(asWholeLabel))
        .reduce((rest, phrase) => rest.replace(phrase, " "), text);
    const leaks = (text: string, language = "en") =>
      internalTerms.filter((pattern) =>
        pattern.test(withoutUiLabels(text, language)),
      );

    // The list catches each banned term and lets the allowed wording through.
    for (const sample of [
      "an AI gateway",
      "the appliance",
      "a cadeia de modelos",
      "an embedding model",
      "the decisions extra",
      "cosine similarity",
      "no silent fallback",
      "1,000 tokens",
      "um modelo de linguagem",
      "an OpenAI key",
      "Qwen",
      "O fornecedor openai.",
      "a key from anthropic",
      "deepseek answers",
      "qwen3 on this computer",
      "GPT-4o",
      "an openai-compatible endpoint",
      "Embedding models",
    ]) {
      assert.equal(leaks(sample).length, 1, sample);
    }
    for (const allowed of [
      "Sem um modelo de busca semântica, o assistente procura pelo texto.",
      "your own OpenAI-compatible endpoint",
      "Responde a la llamada con un texto coherente.",
    ]) {
      assert.deepEqual(leaks(allowed), [], allowed);
    }
    // The embedding UI labels pass the scan in their own language only,
    // alone and embedded in the surrounding script (zh and ja have no
    // word spaces, so the boundaries must not rely on them).
    const embeddedLabelSamples: Record<string, string[]> = {
      de: ["das Embedding-Modell", "Embeddings"],
      en: ["the Embedding model", "Embeddings"],
      es: ["el Modelo de embedding", "Embeddings"],
      fr: ["le Modèle d’embedding", "Embeddings"],
      ja: ["embedding モデルを指定します", "embedding"],
      pt: ["o Modelo de embedding", "Embeddings"],
      zh: ["使用嵌入模型进行索引", "嵌入"],
    };
    for (const [language, samples] of Object.entries(embeddingUiLabels)) {
      for (const sample of samples) {
        assert.equal(
          leaks(sample, language).length,
          0,
          `${language}:${sample}`,
        );
      }
    }
    for (const [language, samples] of Object.entries(embeddedLabelSamples)) {
      for (const sample of samples) {
        assert.equal(
          leaks(sample, language).length,
          0,
          `${language}:${sample}`,
        );
      }
    }

    const releases = await Promise.all(
      SUPPORTED_LANGUAGES.map((language) => loadReleaseContent(language)),
    );
    for (const content of await loadEveryHelpLocale()) {
      const texts: string[] = [];
      for (const id of ["assistant", "ai-features", "ai-credits", "own-ai-endpoint"]) {
        const article = content.articles.find((candidate) => candidate.id === id);
        assert.ok(article, `${content.language}:${id}`);
        texts.push(...articleTexts(article));
      }
      const release = releases.find((candidate) => candidate.language === content.language);
      assert.ok(release, `${content.language}:release`);
      const v080 = findProductRelease(release, "v0.8.0");
      assert.ok(v080, `${content.language}:v0.8.0`);
      // The section label ships with the upcoming mechanism, and the notes
      // for the changes that were upcoming before v0.8.0 must stay free of
      // internal terms now that they ship as released notes. The legal-update
      // note mirrors the legal documents, which legitimately name the
      // Vercel AI Gateway, so it is not scanned here.
      texts.push(
        release.ui.upcomingRelease ?? "",
        v080.title,
        v080.summary,
        ...v080.changes
          .filter((change) => change.id !== "legal-update")
          .flatMap((change) => [change.title, change.description]),
      );
      // The unreleased block, when present, is published copy too and keeps
      // the same internal-term discipline.
      if (release.upcoming) {
        texts.push(
          release.upcoming.title,
          release.upcoming.summary,
          ...release.upcoming.changes.flatMap((change) => [
            change.title,
            change.description,
          ]),
        );
      }
      for (const text of texts) {
        assert.deepEqual(
          leaks(text, content.language),
          [],
          `${content.language} shows an internal term: ${text.slice(0, 160)}`,
        );
      }
    }
  });
});

function articleTexts(article: HelpArticle) {
  return [
    article.title,
    article.summary,
    article.screenshot.alt,
    article.screenshot.caption,
    ...article.sections.flatMap((section) => [
      section.heading,
      ...section.paragraphs,
      ...(section.bullets ?? []),
    ]),
  ];
}
