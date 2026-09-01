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

  test("documents every public repository tag and nothing untagged", async () => {
    const repositoryTags = execFileSync("git", ["tag", "--list", "v*"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean)
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

    assert.equal(english.releases[0]?.tag, `v${packageJson.version}`);
    assert.equal(
      findProductRelease(english, packageJson.version)?.tag,
      `v${packageJson.version}`,
    );
    assert.equal(
      findProductRelease(english, `v${packageJson.version}`)?.tag,
      `v${packageJson.version}`,
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
        assert.ok(release.changes.length >= 2, release.tag);
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
});
