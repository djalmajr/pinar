import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SUPPORTED_LANGUAGES } from "@pinar/shared";
import { collectionDisplayName } from "./collection-display-name";
import { loadUiMessages } from "./i18n";

const inboxLabels = {
  de: "Posteingang",
  en: "Inbox",
  es: "Bandeja de entrada",
  fr: "Boîte de réception",
  ja: "受信トレイ",
  pt: "Caixa de entrada",
  zh: "收件箱",
} as const;

describe("collection display name", () => {
  test("localizes only the protected inbox and keeps a custom inbox name", () => {
    assert.equal(
      collectionDisplayName({ isProtected: true, name: "Inbox" }, inboxLabels.pt),
      "Caixa de entrada",
    );
    assert.equal(
      collectionDisplayName({ isProtected: true, name: "Inbox" }, inboxLabels.en),
      "Inbox",
    );
    assert.equal(
      collectionDisplayName({ isProtected: false, name: "Inbox" }, inboxLabels.pt),
      "Inbox",
    );
    assert.equal(
      collectionDisplayName({ isProtected: true, name: "Review" }, inboxLabels.pt),
      "Review",
    );
  });

  test("uses the localized inbox name in every language and in the settings phrases", async () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const messages = await loadUiMessages(language);
      const label = inboxLabels[language];
      assert.equal(messages["dashboard.protectedInbox"], label, language);
      assert.match(messages["settings.captureDestinationDefault"], new RegExp(label), language);
      assert.match(messages["settings.captureDestinationDescription"], new RegExp(label), language);
      assert.match(messages["dashboard.deleteContainerConfirm"], new RegExp(label), language);
      if (language !== "en") {
        assert.doesNotMatch(messages["settings.captureDestinationDefault"], /Inbox/, language);
        assert.doesNotMatch(messages["settings.captureDestinationDescription"], /Inbox/, language);
        assert.doesNotMatch(messages["dashboard.deleteContainerConfirm"], /Inbox/, language);
      }
    }
  });
});
