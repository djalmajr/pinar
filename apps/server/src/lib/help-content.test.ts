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
import { SUPPORTED_LANGUAGES } from "@pinar/shared";

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
});
