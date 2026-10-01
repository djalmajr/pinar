import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { SUPPORTED_LANGUAGES } from "@pinar/shared";
import {
  defaultReleaseContent,
  findProductRelease,
  loadReleaseContent,
} from "./release-content";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

async function loadEveryReleaseLocale() {
  return Promise.all(
    SUPPORTED_LANGUAGES.map((language) => loadReleaseContent(language)),
  );
}

describe("tagged release content", () => {
  test("keeps English synchronous and memoizes lazy locale loads", async () => {
    assert.equal(defaultReleaseContent.language, "en");
    const frenchContent = loadReleaseContent("fr");
    assert.equal(loadReleaseContent("fr"), frenchContent);
    assert.equal((await frenchContent).language, "fr");
  });

  test("documents every closed public release without listing prerelease tags", async () => {
    const repositoryTags = execFileSync("git", ["tag", "--list", "v*"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
      .sort();
    const english = await loadReleaseContent("en");
    const documentedTags = english.releases
      .map((release) => release.tag)
      .sort();

    assert.deepEqual(documentedTags, repositoryTags);
  });

  test("keeps the newest release aligned with the product package version", async () => {
    const packageJson = JSON.parse(
      readFileSync(
        new URL("../../../../package.json", import.meta.url),
        "utf8",
      ),
    ) as { version: string };
    const english = await loadReleaseContent("en");

    const isPrerelease = packageJson.version.includes("-");
    const expectedReleaseTag = isPrerelease
      ? execFileSync("git", ["tag", "--list", "--sort=-version:refname", "v*"], {
          cwd: repositoryRoot,
          encoding: "utf8",
        })
          .split("\n")
          .find((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
      : `v${packageJson.version}`;

    assert.ok(expectedReleaseTag);
    assert.equal(english.releases[0]?.tag, expectedReleaseTag);
    assert.equal(
      findProductRelease(english, expectedReleaseTag)?.tag,
      expectedReleaseTag,
    );
    if (isPrerelease) {
      assert.equal(findProductRelease(english, `v${packageJson.version}`), null);
    }
    assert.equal(
      findProductRelease(english, expectedReleaseTag.slice(1))?.tag,
      expectedReleaseTag,
    );
  });

  test("ships structurally complete notes in all seven locales", async () => {
    const [english, ...translations] = await loadEveryReleaseLocale();
    const expectedTags = english.releases.map((release) => release.tag);
    const expectedChanges = english.releases.map((release) =>
      release.changes.map((change) => change.id),
    );

    for (const content of [english, ...translations]) {
      assert.deepEqual(
        content.releases.map((release) => release.tag),
        expectedTags,
        content.language,
      );
      assert.deepEqual(
        content.releases.map((release) =>
          release.changes.map((change) => change.id),
        ),
        expectedChanges,
        content.language,
      );
      for (const release of content.releases) {
        assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(
          release.title.length > 2,
          `${content.language}:${release.tag}`,
        );
        assert.ok(
          release.summary.length > 10,
          `${content.language}:${release.tag}`,
        );
        assert.ok(release.changes.length >= 1, release.tag);
        for (const change of release.changes) {
          assert.ok(
            change.title.length > 2,
            `${content.language}:${change.id}`,
          );
          assert.ok(
            change.description.length > 10,
            `${content.language}:${change.id}`,
          );
        }
      }
    }

    for (const content of translations) {
      assert.notEqual(
        content.ui.pageTitle,
        english.ui.pageTitle,
        content.language,
      );
      assert.notEqual(
        content.releases.map((release) => release.summary).join("\n"),
        english.releases.map((release) => release.summary).join("\n"),
        content.language,
      );
    }
  });

  test("qualifies AI credit costs as Pinar Cloud usage in every locale", async () => {
    const aiChangeIds = new Set([
      "pin-diagnosis",
      "save-as-component",
      "collection-design-system",
    ]);

    for (const content of await loadEveryReleaseLocale()) {
      const release = findProductRelease(content, "v0.4.0");
      assert.ok(release, content.language);

      for (const change of release.changes) {
        if (!aiChangeIds.has(change.id)) continue;
        assert.match(
          change.title,
          /Pinar Cloud/,
          `${content.language}:${change.id}`,
        );
      }
    }
  });
});

describe("upcoming release content", () => {
  test("keeps upcoming out of the published tag list and lookup", async () => {
    const english = await loadReleaseContent("en");

    // Shipped or not, the upcoming block carries no tag or date, so the
    // tag-based routes can never reach it.
    const upcoming = english.upcoming;
    if (upcoming) {
      assert.deepEqual(
        upcoming.changes.map((change) => change.id),
        ["mcp-crud", "focused-handoff"],
      );
    }
    assert.equal("tag" in (upcoming ?? {}), false);
    assert.equal("date" in (upcoming ?? {}), false);

    // The published list and the tag lookup stay tag-only.
    for (const release of english.releases) {
      assert.match(release.tag, /^v\d+\.\d+\.\d+$/);
      assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
    }
    assert.equal(findProductRelease(english, "upcoming"), null);
    assert.equal(findProductRelease(english, "mcp-crud"), null);
    assert.equal(findProductRelease(english, "focused-handoff"), null);
    assert.equal(findProductRelease(english, "v0.5.1")?.tag, "v0.5.1");
  });

  test("ships upcoming content, when present, in all seven locales", async () => {
    const [english, ...translations] = await loadEveryReleaseLocale();
    const contents = [english, ...translations];
    const present = contents.map(
      (content) => content.upcoming !== undefined,
    );

    // Upcoming is all-or-nothing: it ships in every locale or in none, so a
    // released version is never left marked as upcoming in one language.
    assert.equal(new Set(present).size, 1, "upcoming present in some locales only");

    if (!present[0]) {
      for (const content of contents) {
        assert.equal(
          "upcomingRelease" in content.ui,
          false,
          content.language,
        );
      }
      return;
    }

    const expectedIds = english.upcoming!.changes.map((change) => change.id);
    for (const content of contents) {
      const block = content.upcoming!;
      assert.deepEqual(
        block.changes.map((change) => change.id),
        expectedIds,
        content.language,
      );
      assert.ok(block.title.length > 2, content.language);
      assert.ok(block.summary.length > 10, content.language);
      for (const change of block.changes) {
        assert.ok(change.title.length > 2, `${content.language}:${change.id}`);
        assert.ok(
          change.description.length > 10,
          `${content.language}:${change.id}`,
        );
        // Shipped upcoming wording never names a date or a release number.
        for (const text of [change.title, change.description]) {
          assert.doesNotMatch(text, /v?\d+\.\d+\.\d+/, `${content.language}:${change.id}`);
          assert.doesNotMatch(text, /\b\d{4}-\d{2}-\d{2}\b/, `${content.language}:${change.id}`);
        }
      }
    }

    // Translations are real equivalents, not copies of the English wording.
    for (const content of translations) {
      assert.notEqual(
        content.upcoming!.title,
        english.upcoming!.title,
        content.language,
      );
      assert.notEqual(
        content.upcoming!.changes.map((change) => change.description).join("\n"),
        english.upcoming!.changes.map((change) => change.description).join("\n"),
        content.language,
      );
    }

    // The section label explicitly says the content is not published yet.
    const unreleasedLabel: Record<string, RegExp> = {
      en: /not (yet )?(released|published)/i,
      pt: /a?nda n[ãa]o (publicad|lan[çc]ad)/i,
      de: /noch nicht (ver[öo]ffentlicht|publiziert)/i,
      es: /a[úu]n no publicada/i,
      fr: /pas encore publi[ée]/i,
      zh: /尚未发布/,
      ja: /公開前/,
    };
    for (const content of contents) {
      const label = content.ui.upcomingRelease;
      assert.ok(label, content.language);
      assert.match(label, unreleasedLabel[content.language], content.language);
    }
  });
});
