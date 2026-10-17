import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ASSISTANT_MESSAGE_ID_PATTERN,
  ASSISTANT_PROPOSAL_ID_PATTERN,
  ASSISTANT_THREAD_ID_PATTERN,
  ASSISTANT_TITLE_MAX,
  assistantThreadTitle,
  newAssistantMessageId,
  newAssistantProposalId,
  newAssistantThreadId,
} from "./store";

describe("assistant store helpers", () => {
  test("assistantThreadTitle collapses whitespace, trims, and cuts at 80 characters", () => {
    assert.equal(assistantThreadTitle("  fix   the   header  "), "fix the header");
    assert.equal(assistantThreadTitle(""), "…");
    assert.equal(assistantThreadTitle("  \n\t  "), "…");

    const exact = "a".repeat(ASSISTANT_TITLE_MAX);
    assert.equal(assistantThreadTitle(exact), exact);

    const long = `${"b".repeat(ASSISTANT_TITLE_MAX)}cd`;
    const expected = `${"b".repeat(ASSISTANT_TITLE_MAX - 1)}…`;
    assert.equal(assistantThreadTitle(long), expected);
    assert.equal(expected.length, ASSISTANT_TITLE_MAX);
  });

  test("cuts the title by grapheme without splitting a surrogate pair or a combining mark", () => {
    // 78 a's + one emoji grapheme + xyz: the cut must keep the emoji whole.
    const emojiTitle = assistantThreadTitle(`a${"a".repeat(77)}😀xyz`);
    assert.equal(emojiTitle, `a${"a".repeat(77)}😀…`);
    assert.ok(emojiTitle.isWellFormed(), "no isolated surrogate after the cut");

    // 78 a's + é written as e + combining acute (one grapheme) + xyz: the
    // combining mark must stay attached to its base at the limit.
    const combiningTitle = assistantThreadTitle(`a${"a".repeat(77)}e\u0301xyz`);
    assert.equal(combiningTitle, `a${"a".repeat(77)}e\u0301…`);

    // A single emoji alone is one grapheme, far below the ceiling.
    assert.equal(assistantThreadTitle("😀"), "😀");
  });

  test("without Intl.Segmenter the title cut still keeps accents, ZWJ emoji and flags whole", () => {
    const intl = Intl as { Segmenter?: unknown };
    const segmenter = intl.Segmenter;
    delete intl.Segmenter;
    try {
      assert.equal(typeof (Intl as { Segmenter?: unknown }).Segmenter, "undefined");
      const prefix = "a".repeat(78);
      assert.equal(assistantThreadTitle(`${prefix}e\u0301xyz`), `${prefix}e\u0301…`);
      assert.equal(assistantThreadTitle(`${prefix}\u{1F469}\u200D\u{1F4BB}xyz`), `${prefix}\u{1F469}\u200D\u{1F4BB}…`);
      assert.equal(assistantThreadTitle(`${prefix}\u{1F1E7}\u{1F1F7}\u{1F1FA}\u{1F1F8}x`), `${prefix}\u{1F1E7}\u{1F1F7}…`);
      assert.equal(assistantThreadTitle(`${prefix}\u{1F44D}\u{1F3FD}xyz`), `${prefix}\u{1F44D}\u{1F3FD}…`);
      assert.equal(assistantThreadTitle("e\u0301"), "e\u0301");
    } finally {
      intl.Segmenter = segmenter;
    }
  });

  test("id generators produce the contract shapes", () => {
    assert.match(newAssistantThreadId(), ASSISTANT_THREAD_ID_PATTERN);
    assert.match(newAssistantMessageId(), ASSISTANT_MESSAGE_ID_PATTERN);
    assert.match(newAssistantProposalId(), ASSISTANT_PROPOSAL_ID_PATTERN);
    assert.notEqual(newAssistantThreadId(), newAssistantThreadId());
    assert.notEqual(newAssistantMessageId(), newAssistantMessageId());
    assert.notEqual(newAssistantProposalId(), newAssistantProposalId());
  });

  test("the proposal id pattern accepts only apr_ ids with a 24-character nanoid", () => {
    assert.ok(ASSISTANT_PROPOSAL_ID_PATTERN.test("apr_0123456789abcdefghijklmn"));
    assert.ok(!ASSISTANT_PROPOSAL_ID_PATTERN.test("apr_0123456789abcdefghijklmno")); // 25 chars
    assert.ok(!ASSISTANT_PROPOSAL_ID_PATTERN.test("apr_0123456789abcdefghijklm")); // 23 chars
    assert.ok(!ASSISTANT_PROPOSAL_ID_PATTERN.test("ath_0123456789abcdefghijklmn")); // wrong prefix
    assert.ok(!ASSISTANT_PROPOSAL_ID_PATTERN.test("apr_0123456789abcdefghijklm!")); // bad char
  });
});
